import OpenAI from 'openai';
import { TTSProvider, VoiceOption } from '../interfaces';
import { logger } from '../../core/logger';

export interface WhisperTTSConfig {
  baseUrl: string;
  model?: string;
}

// Known Kokoro voice IDs served by speaches
const KOKORO_VOICES: VoiceOption[] = [
  { id: 'af_heart', name: 'Heart (Female, EN)', gender: 'female', locale: 'en-IN' },
  { id: 'af_bella', name: 'Bella (Female, EN)', gender: 'female', locale: 'en-IN' },
  { id: 'am_adam',  name: 'Adam (Male, EN)',   gender: 'male',   locale: 'en-IN' },
  { id: 'hf_alpha', name: 'Alpha (Female, HI)', gender: 'female', locale: 'hi-IN' },
  { id: 'hf_beta',  name: 'Beta (Female, HI)',  gender: 'female', locale: 'hi-IN' },
  { id: 'hm_omega', name: 'Omega (Male, HI)',   gender: 'male',   locale: 'hi-IN' },
];

// Best default Kokoro voice per locale
const LOCALE_TO_VOICE: Record<string, string> = {
  'hi-IN': 'hf_alpha',
  'en-IN': 'af_heart',
};

export class WhisperTTSAdapter implements TTSProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: WhisperTTSConfig) {
    this.client = new OpenAI({ apiKey: 'not-needed', baseURL: config.baseUrl });
    this.model = config.model ?? 'speaches-ai/Kokoro-82M-v1.0-ONNX-fp16';
  }

  async synthesize(text: string, locale: string, voiceProfile?: string): Promise<Buffer> {
    const voice = voiceProfile ?? LOCALE_TO_VOICE[locale] ?? 'af_heart';

    logger.info('Synthesizing speech with Kokoro (speaches)', {
      locale,
      textLength: text.length,
      voice,
      model: this.model,
    });

    try {
      const response = await this.client.audio.speech.create({
        model: this.model,
        voice: voice as any,
        input: text,
        response_format: 'mp3',
      });

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      logger.info('Kokoro TTS successful', { audioSize: buffer.length, locale });
      return buffer;
    } catch (error: any) {
      logger.error('Kokoro TTS synthesis failed', { error: error.message, locale });
      throw new Error(`Kokoro TTS failed: ${error.message}`);
    }
  }

  async getVoiceOptions(locale: string): Promise<VoiceOption[]> {
    return KOKORO_VOICES.filter(v => v.locale === locale);
  }
}
