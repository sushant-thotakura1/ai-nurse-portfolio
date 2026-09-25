import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { STTProvider, Transcript } from '../interfaces';
import { logger } from '../../core/logger';

interface SarvamSTTConfig {
  apiKey: string;
  baseUrl?: string;
}

export class SarvamSTTAdapter implements STTProvider {
  private client: AxiosInstance;

  constructor(config: SarvamSTTConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.sarvam.ai',
      headers: { 'api-subscription-key': config.apiKey },
    });
  }

  async transcribe(audio: Buffer, locale?: string, hints?: string[]): Promise<Transcript> {
    const languageCode = locale ? this.mapLocaleToSarvamLanguage(locale) : 'unknown';

    logger.info('Transcribing audio with Sarvam.AI', {
      languageCode,
      audioSize: audio.length,
      autoDetect: !locale,
    });

    const form = new FormData();
    form.append('file', audio, { filename: 'audio.wav', contentType: 'audio/wav' });
    form.append('language_code', languageCode);
    form.append('model', 'saarika:v2.5');

    const response = await this.client.post('/speech-to-text', form, {
      headers: form.getHeaders(),
    });

    // Use the locale returned by the API (auto-detected or confirmed).
    // Fall back to the caller's requested locale if the API returns nothing.
    const detectedLocale: string =
      response.data.language_code || locale || 'en-IN';

    logger.info('Sarvam transcription complete', {
      detectedLocale,
      requestedLocale: locale,
      confidence: response.data.confidence,
    });

    return {
      text: response.data.transcript,
      confidence: response.data.confidence,
      locale: detectedLocale,
      timestamp: new Date(),
    };
  }

  async *streamTranscribe(_audioStream: ReadableStream, _locale: string): AsyncIterator<Transcript> {
    throw new Error('Stream transcription not yet implemented for Sarvam.AI');
  }

  private mapLocaleToSarvamLanguage(locale: string): string {
    const localeMap: Record<string, string> = {
      'hi-IN': 'hi-IN',
      'te-IN': 'te-IN',
      'ta-IN': 'ta-IN',
      'kn-IN': 'kn-IN',
      'ml-IN': 'ml-IN',
      'mr-IN': 'mr-IN',
      'gu-IN': 'gu-IN',
      'bn-IN': 'bn-IN',
      'pa-IN': 'pa-IN',
      'en-IN': 'en-IN',
    };
    // Return the locale as-is if not in the map — do not silently coerce to hi-IN
    return localeMap[locale] ?? locale;
  }
}
