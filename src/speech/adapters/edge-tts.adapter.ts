import { spawn } from 'child_process';
import * as path from 'path';
import { TTSProvider, VoiceOption } from '../interfaces';
import { logger } from '../../core/logger';

export interface EdgeTTSConfig {
  baseUrl?: string; // unused — kept for interface compatibility
}

// Voice names encode the locale — no separate language param needed.
const LOCALE_TO_VOICE: Record<string, string> = {
  // Indian languages
  'hi-IN': 'hi-IN-SwaraNeural',
  'te-IN': 'te-IN-ShrutiNeural',
  'ta-IN': 'ta-IN-PallaviNeural',
  'kn-IN': 'kn-IN-SapnaNeural',
  'ml-IN': 'ml-IN-SobhanaNeural',
  'mr-IN': 'mr-IN-AarohiNeural',
  'gu-IN': 'gu-IN-DhwaniNeural',
  'bn-IN': 'bn-IN-TanishaaNeural',
  'pa-IN': 'pa-IN-OjasNeural',
  'en-IN': 'en-IN-NeerjaNeural',
  // African languages
  'sw-KE': 'sw-KE-ZuriNeural',
  'sw-TZ': 'sw-TZ-RehemaNeural',
  'af-ZA': 'af-ZA-AdriNeural',
  'am-ET': 'am-ET-MekdesNeural',
  'ha-NG': 'ha-NG-ZiraNeural',
  'so-SO': 'so-SO-UbaxNeural',
  'yo-NG': 'yo-NG-IfeomiNeural',
  'zu-ZA': 'zu-ZA-ThandoNeural',
};

const EDGE_VOICES: VoiceOption[] = Object.entries(LOCALE_TO_VOICE).map(([locale, id]) => ({
  id,
  name: id,
  gender: 'female' as const,
  locale,
}));

// Path to the Python helper script (relative to this file's location at src/speech/adapters/)
const SCRIPT_PATH = path.resolve(__dirname, '..', '..', '..', 'scripts', 'edge_tts_synth.py');

const RETRY_DELAYS_MS = [500, 1000]; // delays before attempt 2 and 3
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 3 total attempts

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class EdgeTTSAdapter implements TTSProvider {
  async synthesize(text: string, locale: string, voiceProfile?: string): Promise<Buffer> {
    const voice = voiceProfile ?? LOCALE_TO_VOICE[locale] ?? 'en-IN-NeerjaNeural';

    logger.info('Synthesizing speech with edge-tts', { locale, voice, textLength: text.length });

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const delay = RETRY_DELAYS_MS[attempt - 2];
        logger.warn('edge-tts synthesis failed, retrying', { attempt, delay, locale, voice, error: lastError?.message });
        await sleep(delay);
      }

      try {
        const audio = await this.spawnSynthesis(voice, text, locale);
        if (attempt > 1) {
          logger.info('edge-tts synthesis succeeded after retry', { attempt, locale, voice });
        }
        return audio;
      } catch (err: any) {
        lastError = err;
      }
    }

    logger.error('edge-tts synthesis failed after all retries', { attempts: MAX_ATTEMPTS, locale, voice, error: lastError?.message });
    throw lastError!;
  }

  private spawnSynthesis(voice: string, text: string, locale: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [SCRIPT_PATH, voice, text]);

      const audioChunks: Buffer[] = [];
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => audioChunks.push(chunk));
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          logger.error('edge-tts synthesis failed', { code, stderr, locale, voice });
          reject(new Error(`edge-tts failed (exit ${code}): ${stderr.trim()}`));
        } else {
          const audio = Buffer.concat(audioChunks);
          logger.info('edge-tts synthesis successful', { audioSize: audio.length, locale, voice });
          resolve(audio);
        }
      });

      proc.on('error', (err: Error) => {
        logger.error('edge-tts process error', { error: err.message });
        reject(new Error(`edge-tts process error: ${err.message}`));
      });
    });
  }

  async getVoiceOptions(locale: string): Promise<VoiceOption[]> {
    return EDGE_VOICES.filter(v => v.locale === locale);
  }
}
