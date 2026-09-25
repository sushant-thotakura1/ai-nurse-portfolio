import axios, { AxiosInstance } from 'axios';
import { TTSProvider, VoiceOption } from '../interfaces';
import { logger } from '../../core/logger';
import { INTRON_LOCALES, intronLocale, IntronLocale } from '../intron-locales';

interface IntronTTSConfig {
  apiKey: string;
  baseUrl?: string;
}

const MAX_CHARS = 4096;
const FALLBACK: IntronLocale = INTRON_LOCALES['en-NG'];

/**
 * Intron TTS via the synchronous integrator endpoint.
 *
 * POST /tts/v1/generate  (<= 4096 chars) → { data: { audio_path, processing_status } }
 * then GET <audio_path> for the raw WAV bytes. Warm calls return in ~4-6s.
 *
 * A cold model returns HTTP 503 ("tts text queued for processing") after a long
 * wait and continues the job async — this can exceed two minutes, longer than
 * any reasonable inline wait for a chat reply, so we surface it as an error and
 * let the caller fall back to a text reply. There is no async polling here.
 *
 * Requires an integrator-enabled INTRON_API_KEY.
 */
export class IntronTTSAdapter implements TTSProvider {
  private readonly client: AxiosInstance;

  constructor(config: IntronTTSConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl ?? 'https://infer.voice.intron.io',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async synthesize(text: string, locale: string, _voiceProfile?: string): Promise<Buffer> {
    if (text.length > MAX_CHARS) {
      throw new Error(`Intron TTS: text exceeds ${MAX_CHARS}-char limit (got ${text.length})`);
    }

    const m = intronLocale(locale) ?? FALLBACK;

    logger.info('IntronTTSAdapter: synthesizing', {
      locale,
      voiceLanguage: m.ttsLanguage,
      voiceAccent: m.ttsAccent,
      textLength: text.length,
    });

    const genRes = await this.client
      .post('/tts/v1/generate', {
        text,
        voice_language: m.ttsLanguage,
        voice_accent: m.ttsAccent,
        voice_gender: 'female',
        output_audio_format: 'wav',
      })
      .catch((err: unknown) => {
        const httpStatus = (err as { response?: { status?: number } })?.response?.status;
        if (httpStatus === 503) {
          throw new Error('Intron TTS unavailable (HTTP 503 — model cold-starting; retry shortly)');
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Intron TTS generate failed: ${msg}`);
      });

    const payload = genRes.data?.data ?? genRes.data;
    const status: string = payload?.processing_status ?? '';
    if (status !== 'TTS_TEXT_AUDIO_GENERATED') {
      throw new Error(
        `Intron TTS job not completed (status=${status}): ${payload?.error_message ?? 'unknown error'}`,
      );
    }

    const audioPath: string | undefined = payload?.audio_path;
    if (!audioPath) {
      throw new Error(`Intron TTS completed but no audio_path. Response: ${JSON.stringify(genRes.data)}`);
    }

    const audioRes = await axios
      .get(audioPath, { responseType: 'arraybuffer' })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Intron TTS audio download failed: ${msg}`);
      });

    const buf = Buffer.from(audioRes.data);
    logger.info('IntronTTSAdapter: synthesis complete', { audioSize: buf.length });
    return buf;
  }

  async getVoiceOptions(_locale: string): Promise<VoiceOption[]> {
    return [];
  }
}
