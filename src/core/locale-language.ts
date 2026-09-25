/**
 * Maps a BCP-47 locale to the human-readable language name and the prompt
 * instruction the LLM needs to actually respond in that language.
 *
 * Passing a bare code like `ha-NG` to an LLM is unreliable — GPT-4o-mini reads
 * the `NG` and guesses Yoruba, not Hausa. Every prompt that steers response
 * language must use the NAME ("Hausa"), not the code. This is the single place
 * that knows the mapping.
 */
export interface LanguageDirective {
  /** Human-readable language name, e.g. "Hausa". */
  name: string;
  /** Drop-in instruction for a system/user prompt. */
  instruction: string;
  /** A short "good / bad" example for few-shot steering. */
  example: string;
}

const ENGLISH: LanguageDirective = {
  name: 'English',
  instruction: 'Speak in clear, simple English.',
  example: 'Good: "How are you feeling today?"',
};

const DIRECTIVES: Record<string, LanguageDirective> = {
  'hi-IN': {
    name: 'Hindi',
    instruction: 'You MUST speak ONLY in Hindi (Devanagari script). Never mix English, Telugu or other languages.',
    example: 'Good: "आप कैसा महसूस कर रहे हैं?" | Bad: "आप कैसे हैं? Are you feeling better?"',
  },
  'te-IN': {
    name: 'Telugu',
    instruction: 'You MUST speak ONLY in Telugu (Telugu script). Never mix Hindi, English or other languages.',
    example: 'Good: "మీరు ఎలా ఉన్నారు?" | Bad: "మీరు ఎలా ఉన్నారు? क्या आप ठीक हैं?"',
  },
  'ha-NG': {
    name: 'Hausa',
    instruction: 'You MUST respond ONLY in Hausa (Latin/Boko script). Do not mix in English or any other language.',
    example: 'Good: "Yaya kake ji yau?" | Bad: "Yaya kake ji? Are you feeling better?"',
  },
  'ig-NG': {
    name: 'Igbo',
    instruction: 'You MUST respond ONLY in Igbo. Do not mix in English or any other language.',
    example: 'Good: "Kedu ka ị na-adị taa?" | Bad: "Kedu? Are you feeling better?"',
  },
  'sw-KE': {
    name: 'Swahili',
    instruction: 'You MUST respond ONLY in Swahili. Do not mix in English or any other language.',
    example: 'Good: "Unajisikiaje leo?" | Bad: "Unajisikiaje? Are you feeling better?"',
  },
  // English variants — Indian, African, and generic
  'en-IN': { ...ENGLISH, instruction: 'Speak in clear, simple English suitable for an Indian context.' },
  'en-NG': ENGLISH,
  'en-KE': ENGLISH,
  'en-ZA': ENGLISH,
  'en-GH': ENGLISH,
  'en-US': ENGLISH,
  'en-GB': ENGLISH,
};

/** The language directive for a locale. Unknown / missing locales → English. */
export function languageDirective(locale: string | null | undefined): LanguageDirective {
  if (!locale) return ENGLISH;
  if (DIRECTIVES[locale]) return DIRECTIVES[locale];
  // Any other English variant (`en-XX`) → generic English.
  if (locale.toLowerCase().startsWith('en-') || locale.toLowerCase() === 'en') return ENGLISH;
  return ENGLISH;
}

/** Just the language name, e.g. "Hausa". Unknown / missing → "English". */
export function localeDisplayName(locale: string | null | undefined): string {
  return languageDirective(locale).name;
}
