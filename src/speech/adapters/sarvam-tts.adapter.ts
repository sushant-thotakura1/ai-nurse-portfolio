import axios, { AxiosInstance } from 'axios';
import { TTSProvider, VoiceOption } from '../interfaces';
import { logger } from '../../core/logger';

interface SarvamTTSConfig {
  apiKey: string;
  baseUrl?: string;
}

export class SarvamTTSAdapter implements TTSProvider {
  private client: AxiosInstance;
  private config: SarvamTTSConfig;

  constructor(config: SarvamTTSConfig) {
    this.config = config;
    const baseUrl = config.baseUrl || 'https://api.sarvam.ai';

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'api-subscription-key': config.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async synthesize(
    text: string,
    locale: string,
    voiceProfile?: string
  ): Promise<Buffer> {
    try {
      logger.info('Synthesizing speech with Sarvam.AI', {
        locale,
        textLength: text.length,
        voiceProfile: voiceProfile || 'default',
      });

      const response = await this.client.post('/text-to-speech', {
        text,
        target_language_code: this.mapLocaleToSarvamLanguage(locale),
        speaker: voiceProfile || this.getDefaultVoice(locale),
        model: 'bulbul:v3',
        pace: 1.0,
        speech_sample_rate: 8000,
      });

      // Convert base64 audio to buffer (response returns audios array)
      const audioBuffer = Buffer.from(response.data.audios[0], 'base64');

      logger.info('Speech synthesis successful', {
        locale,
        audioSize: audioBuffer.length,
      });

      return audioBuffer;
    } catch (error: any) {
      logger.error('Sarvam TTS synthesis failed', {
        error: error.message,
        locale,
      });
      throw new Error(`Sarvam TTS failed: ${error.message}`);
    }
  }

  async getVoiceOptions(locale: string): Promise<VoiceOption[]> {
    try {
      logger.info('Fetching voice options for locale', { locale });

      const response = await this.client.get('/voices', {
        params: {
          language: this.mapLocaleToSarvamLanguage(locale),
        },
      });

      const voices: VoiceOption[] = response.data.voices.map((voice: any) => ({
        id: voice.id,
        name: voice.name,
        gender: voice.gender,
        locale: locale,
      }));

      logger.info('Voice options fetched', {
        locale,
        count: voices.length,
      });

      return voices;
    } catch (error: any) {
      logger.error('Failed to fetch voice options', {
        error: error.message,
        locale,
      });
      throw new Error(`Failed to fetch voices: ${error.message}`);
    }
  }

  /**
   * Map locale codes to Sarvam.AI language identifiers
   */
  private mapLocaleToSarvamLanguage(locale: string): string {
    const localeMap: Record<string, string> = {
      'hi-IN': 'hi-IN',  // Hindi
      'te-IN': 'te-IN',  // Telugu
      'ta-IN': 'ta-IN',  // Tamil
      'kn-IN': 'kn-IN',  // Kannada
      'ml-IN': 'ml-IN',  // Malayalam
      'mr-IN': 'mr-IN',  // Marathi
      'gu-IN': 'gu-IN',  // Gujarati
      'bn-IN': 'bn-IN',  // Bengali
      'pa-IN': 'pa-IN',  // Punjabi
      'en-IN': 'en-IN',  // Indian English
    };

    return localeMap[locale] ?? locale; // Pass through unknown locales as-is
  }

  /**
   * Get default voice for each language
   */
  private getDefaultVoice(locale: string): string {
    const defaultVoices: Record<string, string> = {
      'hi-IN': 'simran',    // Female Hindi voice
      'te-IN': 'simran',    // Female Telugu voice
      'ta-IN': 'simran',    // Female Tamil voice
      'kn-IN': 'simran',    // Female Kannada voice
      'ml-IN': 'simran',    // Female Malayalam voice
      'mr-IN': 'simran',    // Female Marathi voice
      'gu-IN': 'simran',    // Female Gujarati voice
      'bn-IN': 'simran',    // Female Bengali voice
      'pa-IN': 'simran',    // Female Punjabi voice
      'en-IN': 'simran',    // Female Indian English voice
    };

    return defaultVoices[locale] || 'simran';
  }
}
