import { LLMProvider } from '../ai-agent/interfaces';
import { logger } from '../core/logger';
import { languageDirective } from '../core/locale-language';

export interface RenderedTurn {
  acknowledgment: string;
  qaAnswer: string | null;
  question: string;
}

const QUESTION_MARKS = /[?？؟]/;
const SENTENCE_SPLIT = /(?<=[.!।？?؟])\s+/;
const QUESTION_WORDS = /^\s*(what|why|how|when|where|who|which|is|are|do|does|can|could|should|would|will|kya|kaisa|kaise|kab|kahan|kaun|kitna|kyun|क्या|कैसे|कब|कहां|कौन|कितना|क्यों)\b/i;

/** Cheap heuristic — decides only whether to RETRIEVE documents. */
export function looksLikeAQuestion(text: string): boolean {
  return QUESTION_MARKS.test(text) || QUESTION_WORDS.test(text);
}

function stripQuestions(s: string | null): string {
  if (!s) return '';
  return s
    .split(SENTENCE_SPLIT)
    .filter(seg => !QUESTION_MARKS.test(seg))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The KG question is the only question in the message. */
export function assemble(qaAnswer: string | null, acknowledgment: string | null, question: string): string {
  const parts = [stripQuestions(qaAnswer), stripQuestions(acknowledgment), question.trim()].filter(Boolean);
  return parts.join('\n\n');
}

export class ClinicalTurnRenderer {
  constructor(private readonly llm: LLMProvider) {}

  async renderTurn(input: {
    patientText: string;
    locale: string;
    ragSnippets: string | null;
    questionEn: string;
  }): Promise<RenderedTurn> {
    const { patientText, locale, ragSnippets, questionEn } = input;
    const lang = languageDirective(locale);

    const prompt = `You are a warm, caring nurse on a post-operative follow-up call. ${lang.instruction}

The patient just said: "${patientText}"
${ragSnippets ? `\nReference material for answering any question they asked:\n${ragSnippets}\n` : ''}
Produce a JSON object with three fields, every value written in ${lang.name}:
- "acknowledgment": one short empathetic sentence responding to what they said. No question.
- "qaAnswer": if the patient asked a question, a brief plain-language answer using the reference material (say so if it is not covered). No question. Otherwise null.
- "question": a faithful translation of EXACTLY this question into ${lang.name}, keeping its answer options and clinical meaning, adding nothing:
"${questionEn}"

Respond with ONLY the JSON object:
{"acknowledgment": "...", "qaAnswer": "..." | null, "question": "..."}`;

    let raw: string;
    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: 'You return only the JSON object. Never put a question in "acknowledgment" or "qaAnswer".' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.4, maxTokens: 400 },
      );
      raw = response.content;
    } catch (err) {
      logger.warn('renderTurn: LLM call failed', { error: err instanceof Error ? err.message : String(err) });
      return { acknowledgment: '', qaAnswer: null, question: '' };
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { acknowledgment: '', qaAnswer: null, question: '' };
    try {
      const parsed = JSON.parse(match[0]) as { acknowledgment?: unknown; qaAnswer?: unknown; question?: unknown };
      return {
        acknowledgment: typeof parsed.acknowledgment === 'string' ? parsed.acknowledgment : '',
        qaAnswer: typeof parsed.qaAnswer === 'string' && parsed.qaAnswer.trim() ? parsed.qaAnswer : null,
        question: typeof parsed.question === 'string' ? parsed.question : '',
      };
    } catch {
      return { acknowledgment: '', qaAnswer: null, question: '' };
    }
  }

  /**
   * Faithfully translate a single KB-authored sentence (e.g. an escalation
   * note) into the patient's locale. Unlike renderTurn, this has no JSON
   * structure to parse — it returns plain translated text, or the original
   * English text untouched (skipped for English, or on any LLM failure).
   */
  async translateNote(text: string, locale: string): Promise<string> {
    const lang = languageDirective(locale);
    if (lang.name === 'English') return text;

    const prompt = `Translate the following sentence into ${lang.name}, completely and faithfully. Preserve any phone numbers, email addresses, or web links EXACTLY as written — do not translate, reformat, or alter them in any way.

"${text}"

Respond with ONLY the translated sentence, nothing else.`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: 'You return only the translated sentence, nothing else.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 200 },
      );
      const translated = response.content.trim().replace(/^"(.*)"$/s, '$1').trim();
      return translated || text;
    } catch (err) {
      logger.warn('translateNote: LLM call failed, falling back to English', {
        error: err instanceof Error ? err.message : String(err),
      });
      return text;
    }
  }
}
