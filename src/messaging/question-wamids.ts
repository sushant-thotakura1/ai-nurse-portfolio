// Quote-reply attribution (issue #141)
//
// When the bot sends a question on WhatsApp, we remember the outbound message's
// wamid alongside the question text. If the patient swipe-replies (quote-reply)
// to that specific bubble, the inbound webhook carries `context.id` — the same
// wamid — and we can attribute their answer to the exact question it addresses
// rather than assuming it answers the most recent question.
//
// The map lives on `MessageSession.questionWamids` (within-session only) and is
// capped so a long conversation cannot grow it without bound.

const MAX_TRACKED_QUESTIONS = 20;

type WamidMap = Record<string, string>;

function asWamidMap(value: unknown): WamidMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as WamidMap;
}

/**
 * Return a new map with `wamid -> questionText` recorded, keeping only the most
 * recently added `MAX_TRACKED_QUESTIONS` entries.
 */
export function mergeQuestionWamid(
  existing: unknown,
  wamid: string,
  questionText: string,
): WamidMap {
  const merged: WamidMap = { ...asWamidMap(existing), [wamid]: questionText };

  const keys = Object.keys(merged);
  if (keys.length <= MAX_TRACKED_QUESTIONS) return merged;

  const kept: WamidMap = {};
  for (const key of keys.slice(keys.length - MAX_TRACKED_QUESTIONS)) {
    kept[key] = merged[key];
  }
  return kept;
}

/**
 * Resolve the question a quote-reply is answering, or `undefined` when the
 * quoted wamid is unknown/expired or there is no quote context at all.
 */
export function resolveQuotedQuestion(
  questionWamids: unknown,
  contextMessageId: string | undefined | null,
): string | undefined {
  if (!contextMessageId) return undefined;
  const text = asWamidMap(questionWamids)[contextMessageId];
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}
