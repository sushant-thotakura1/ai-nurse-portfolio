import { z } from 'zod';
import { LLMProvider, ChatMessage } from '../ai-agent/interfaces';
import { MessageState } from './session';
import { MessageChannel, MessageContent } from './interfaces';
import { logger } from '../core/logger';
import { localeDisplayName } from '../core/locale-language';

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ButtonOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(20),
});

const SectionRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const InteractiveContentSchema = z.object({
  type: z.enum(['button', 'list']),
  body: z.string().min(1),
  // button type
  buttons: z.array(ButtonOptionSchema).min(1).max(3).optional(),
  // list type
  listButtonLabel: z.string().optional(),
  sections: z.array(z.object({
    title: z.string(),
    rows: z.array(SectionRowSchema).min(1).max(10),
  })).optional(),
});

const TemplateContentSchema = z.object({
  name: z.string().min(1),
  languageCode: z.string().min(2),
  parameters: z.array(z.string()),
});

const MessageContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }),
  z.object({ type: z.literal('interactive'), interactive: InteractiveContentSchema }),
  z.object({ type: z.literal('template'), template: TemplateContentSchema }),
]);

const FormatterOutputSchema = z.array(MessageContentSchema).min(1);

// ── Channel capability descriptions (compact — not full API docs) ─────────────

const CHANNEL_CAPS: Record<MessageChannel, string> = {
  whatsapp: `
Supported types:
- { "type": "text", "text": "<string>" }
- { "type": "interactive", "interactive": { "type": "button", "body": "<string>", "buttons": [{ "id": "<string>", "title": "<string max 20 chars>" }] } }  (max 3 buttons)
- { "type": "template", "template": { "name": "<string>", "languageCode": "<string>", "parameters": ["<string>"] } }
Return the whole response as ONE text item — do NOT split it into multiple text messages. Max text length: 4096 chars.`,
  telegram: `
Supported types:
- { "type": "text", "text": "<string>" }
- { "type": "interactive", "interactive": { "type": "button", "body": "<string>", "buttons": [{ "id": "<string>", "title": "<string>" }] } }
Return the whole response as ONE text item — do NOT split it into multiple text messages.
No template type on Telegram — use text instead.`,
};

// ── Deterministic consolidation ──────────────────────────────────────────────

const MAX_TEXT_LENGTH = 4096;

/**
 * Merge consecutive `text` items into a single message so the response arrives
 * as one bubble on WhatsApp/Telegram rather than several. Non-text items
 * (interactive, template, audio) are boundaries — text runs on either side are
 * merged independently, and CONSENT_CHECK's interactive button item is never
 * folded into surrounding text. A merged block longer than the hard 4096-char
 * cap is split back apart on a whitespace boundary as a safety net.
 *
 * This does not rely on the formatter LLM obeying the "one item" instruction.
 */
export function coalesceTextContent(
  content: MessageContent[],
  maxLen: number = MAX_TEXT_LENGTH,
): MessageContent[] {
  const result: MessageContent[] = [];
  let run: string[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const merged = run.join('\n\n');
    run = [];
    for (const chunk of splitOnLength(merged, maxLen)) {
      result.push({ type: 'text', text: chunk });
    }
  };

  for (const item of content) {
    if (item.type === 'text') {
      // Drop empty text items rather than emitting blank bubbles.
      if (typeof item.text === 'string' && item.text.length > 0) run.push(item.text);
    } else {
      flushRun();
      result.push(item);
    }
  }
  flushRun();

  return result;
}

/** Split on the last newline/space before `maxLen`; hard-cut only if there is none. */
function splitOnLength(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// ── Main formatter function ───────────────────────────────────────────────────

const PLAIN_TEXT_FALLBACK = (text: string): MessageContent[] => [{ type: 'text', text }];

export async function formatForChannel(
  llm: LLMProvider,
  clinicalText: string,
  state: MessageState,
  channel: MessageChannel,
  locale: string,
): Promise<MessageContent[]> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a clinical messaging formatter. Format clinical text for delivery on ${channel}.
${CHANNEL_CAPS[channel]}
Respond with ONLY a JSON array of message content objects. No markdown, no explanation.`,
    },
    {
      role: 'user',
      content: `State: ${state}\nLanguage: ${localeDisplayName(locale)} (the clinical text below is ALREADY in this language — format it, do not translate or rewrite it)\nClinical text to format:\n${clinicalText}

Formatting hints by state:
- CONSENT_CHECK: Use interactive buttons with exactly two options: "Yes, I consent" and "No, I don't". Do NOT use plain text.
- CONVERSATION / ENDING: Use plain text only. NEVER add interactive language selection buttons or any other interactive element unless the clinical text explicitly poses a multiple-choice question with distinct answer options.`,
    },
  ];

  try {
    const response = await llm.complete(messages, { temperature: 0.1, maxTokens: 512 });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      logger.warn('Formatter LLM returned non-JSON — using plain text fallback', { state, channel });
      return coalesceTextContent(PLAIN_TEXT_FALLBACK(clinicalText));
    }

    const validation = FormatterOutputSchema.safeParse(parsed);
    if (!validation.success) {
      logger.warn('Formatter output failed Zod validation — using plain text fallback', {
        state,
        channel,
        errors: validation.error.issues,
      });
      return coalesceTextContent(PLAIN_TEXT_FALLBACK(clinicalText));
    }

    const content = coalesceTextContent(validation.data as MessageContent[]);
    logger.info('Formatter output', {
      state, channel, rawCount: validation.data.length, contentCount: content.length,
    });
    return content;
  } catch (err: any) {
    logger.error('Formatter LLM call failed — using plain text fallback', {
      state, channel, error: err.message,
    });
    return coalesceTextContent(PLAIN_TEXT_FALLBACK(clinicalText));
  }
}
