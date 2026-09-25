/**
 * Single source of truth for the language strings the Intron Voice API expects.
 *
 * Verified against https://docs.voice.intron.io (2026-09-07):
 *  - STT `/file/v1/upload/sync` takes `use_language_asr_input` as an ISO 639-1
 *    code (`ha`, `ig`, `sw`, `en`); all four are code-switched with English.
 *  - TTS `/tts/v1/generate` takes `voice_language` = the language of the text
 *    (`ha`/`ig`/`sw` for the native languages, `en` for English) and
 *    `voice_accent` = the accent name.
 *
 * `en-NG` = English spoken with a Nigerian-language accent. The docs list no
 * dedicated "nigerian" accent; `yoruba` is the working choice pending
 * confirmation from the Intron team.
 */
export interface IntronLocale {
  /** Human-readable name shown in the WhatsApp language-selection list. */
  displayName: string;
  /** → `use_language_asr_input` on `/file/v1/upload/sync`. */
  sttCode: string;
  /** → `voice_language` on `/tts/v1/generate`. */
  ttsLanguage: string;
  /** → `voice_accent` on `/tts/v1/generate`. */
  ttsAccent: string;
}

/** Keyed by BCP-47 locale — matches `LanguagePack.localeCode` and `patient.preferredLocale`. */
export const INTRON_LOCALES: Record<string, IntronLocale> = {
  'ha-NG': { displayName: 'Hausa',                     sttCode: 'ha', ttsLanguage: 'ha', ttsAccent: 'hausa'   },
  'ig-NG': { displayName: 'Igbo',                      sttCode: 'ig', ttsLanguage: 'ig', ttsAccent: 'igbo'    },
  'sw-KE': { displayName: 'Swahili',                   sttCode: 'sw', ttsLanguage: 'sw', ttsAccent: 'swahili' },
  'en-NG': { displayName: 'English (Nigerian accent)', sttCode: 'en', ttsLanguage: 'en', ttsAccent: 'yoruba'  },
};

export function intronLocale(locale: string | null | undefined): IntronLocale | null {
  return locale ? INTRON_LOCALES[locale] ?? null : null;
}
