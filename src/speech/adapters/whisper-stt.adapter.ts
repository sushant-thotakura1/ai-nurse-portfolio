import OpenAI, { toFile } from 'openai';
import { STTProvider, Transcript } from '../interfaces';
import { logger } from '../../core/logger';

interface WhisperSTTConfig {
  baseUrl: string;
  model: string;
}

// ISO 639-1 codes returned by Whisper → BCP-47
// Indian languages default to -IN; African languages default to their primary country.
const ISO639_TO_BCP47: Record<string, string> = {
  // Indian
  en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN',
  kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', gu: 'gu-IN',
  bn: 'bn-IN', pa: 'pa-IN',
  // African — mapped to the primary country for TTS voice selection
  sw: 'sw-KE',  // Swahili   → Kenya  (sw-KE-ZuriNeural)
  ha: 'ha-NG',  // Hausa     → Nigeria
  yo: 'yo-NG',  // Yoruba    → Nigeria
  af: 'af-ZA',  // Afrikaans → South Africa
  am: 'am-ET',  // Amharic   → Ethiopia
  so: 'so-SO',  // Somali    → Somalia
  zu: 'zu-ZA',  // Zulu      → South Africa
};

export class WhisperSTTAdapter implements STTProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: WhisperSTTConfig) {
    this.client = new OpenAI({ apiKey: 'not-needed', baseURL: config.baseUrl });
    this.model = config.model;
  }

  async transcribe(audio: Buffer, locale?: string, _hints?: string[]): Promise<Transcript> {
    logger.info('Transcribing audio with Whisper (speaches)', {
      model: this.model,
      locale,
      audioSize: audio.length,
      autoDetect: !locale,
    });

    const requestParams = {
      file: await toFile(audio, 'audio.ogg', { type: 'audio/ogg' }),
      model: this.model,
      language: locale ? this.mapLocaleToIso639(locale) : undefined,
      response_format: 'verbose_json',  // required to get `language` field back from Whisper
    } as Parameters<typeof this.client.audio.transcriptions.create>[0];

    const transcription = await this.client.audio.transcriptions.create(requestParams) as any;

    // Normalise Whisper's ISO 639-1 response to BCP-47
    const rawLang: string = (transcription as any).language ?? '';
    const detectedLocale = this.normaliseToBcp47(rawLang) || locale || 'en-IN';

    logger.info('Whisper transcription complete', {
      rawLanguage: rawLang,
      detectedLocale,
      requestedLocale: locale,
    });

    return {
      text: transcription.text,
      confidence: 0,
      locale: detectedLocale,
      timestamp: new Date(),
    };
  }

  async *streamTranscribe(_audioStream: ReadableStream, _locale: string): AsyncIterator<Transcript> {
    throw new Error('Stream transcription not implemented for Whisper');
  }

  private mapLocaleToIso639(locale: string): string {
    const map: Record<string, string> = {
      // Indian
      'hi-IN': 'hi', 'te-IN': 'te', 'ta-IN': 'ta', 'kn-IN': 'kn',
      'ml-IN': 'ml', 'mr-IN': 'mr', 'gu-IN': 'gu', 'bn-IN': 'bn',
      'pa-IN': 'pa', 'en-IN': 'en',
      // African
      'sw-KE': 'sw', 'sw-TZ': 'sw',
      'ha-NG': 'ha', 'yo-NG': 'yo',
      'af-ZA': 'af', 'am-ET': 'am',
      'so-SO': 'so', 'zu-ZA': 'zu',
    };
    // Return locale as-is if not in map — do not silently coerce to another language
    return map[locale] ?? locale;
  }

  private normaliseToBcp47(iso639: string): string | null {
    if (!iso639) return null;
    const mapped = ISO639_TO_BCP47[iso639];
    if (!mapped) {
      logger.warn('Whisper returned unmapped language code — passing through', { iso639 });
      return iso639;   // pass through unknown codes (e.g. 'fr', 'de')
    }
    return mapped;
  }
}
