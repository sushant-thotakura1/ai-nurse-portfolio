import { TTSProvider } from './interfaces';
import { WhisperTTSAdapter } from './adapters/whisper-tts.adapter';
import { EdgeTTSAdapter } from './adapters/edge-tts.adapter';
import { SarvamTTSAdapter } from './adapters/sarvam-tts.adapter';
import { IntronTTSAdapter } from './adapters/intron-tts.adapter';
import { decrypt } from '../core/encryption';
import { config } from '../core/config';
import { logger } from '../core/logger';

// Locales natively supported by Kokoro TTS in speaches
const KOKORO_SUPPORTED_LOCALES = new Set(['en-IN', 'hi-IN']);

function makeSarvamAdapter(): SarvamTTSAdapter {
  if (!config.providers.sarvam.apiKey) {
    throw new Error('No TTS provider configured: no DB record and SARVAM_API_KEY is not set');
  }
  return new SarvamTTSAdapter({ apiKey: config.providers.sarvam.apiKey });
}

export async function getTtsProvider(tenantId: string, prisma: any, locale?: string): Promise<TTSProvider> {
  const record = await prisma.providerConfig.findFirst({
    where: { providerType: 'tts', tenantId, isActive: true },
    orderBy: { priority: 'desc' },
  });

  if (record) {
    const encrypted = (record.config as any)?.encrypted;
    if (!encrypted) {
      throw new Error(
        `TTS provider config missing encrypted field (tenantId=${tenantId}, providerName=${record.providerName})`,
      );
    }
    const cfg = JSON.parse(decrypt(encrypted));

    if (record.providerName === 'edge-tts') {
      // edge-tts runs in-process via Python subprocess — no baseUrl needed
      return new EdgeTTSAdapter();
    }
    if (record.providerName === 'whisper-tts') {
      // Kokoro only supports EN + HI — fall back to Sarvam for other locales
      if (locale && !KOKORO_SUPPORTED_LOCALES.has(locale)) {
        logger.info(`Locale "${locale}" not supported by Kokoro TTS, falling back to Sarvam`, { locale, tenantId });
        return makeSarvamAdapter();
      }
      return new WhisperTTSAdapter({ baseUrl: cfg.baseUrl, model: cfg.model });
    }
    if (record.providerName === 'sarvam') {
      return new SarvamTTSAdapter({ apiKey: cfg.apiKey });
    }
    if (record.providerName === 'intron-tts') {
      // Always use Intron TTS regardless of locale. For locales not in INTRON_LOCALES
      // the adapter falls back to the en-NG voice params (Nigerian English persona).
      return new IntronTTSAdapter({ apiKey: cfg.apiKey });
    }
    throw new Error(
      `Unsupported TTS providerName in DB: "${record.providerName}" (tenantId=${tenantId})`,
    );
  }

  // Env-var fallbacks
  const defaultProvider = config.providers.tts.defaultProvider;
  if (defaultProvider === 'edge-tts') {
    return new EdgeTTSAdapter();
  }
  if (defaultProvider === 'whisper-tts' || defaultProvider === 'whisper') {
    if (locale && !KOKORO_SUPPORTED_LOCALES.has(locale)) {
      logger.info(`Locale "${locale}" not supported by Kokoro TTS, falling back to Sarvam`, { locale });
      return makeSarvamAdapter();
    }
    return new WhisperTTSAdapter({ baseUrl: config.providers.stt.whisperBaseUrl });
  }
  if (defaultProvider === 'intron' || (!config.providers.sarvam.apiKey && config.providers.intron.apiKey)) {
    if (!config.providers.intron.apiKey) {
      throw new Error('No TTS provider configured: TTS_DEFAULT_PROVIDER=intron but INTRON_API_KEY is not set');
    }
    // Always use Intron TTS regardless of locale. For locales not in INTRON_LOCALES
    // the adapter falls back to the en-NG voice params (Nigerian English persona).
    return new IntronTTSAdapter({ apiKey: config.providers.intron.apiKey });
  }
  return makeSarvamAdapter();
}
