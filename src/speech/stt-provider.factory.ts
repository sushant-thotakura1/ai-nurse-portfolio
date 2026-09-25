import { decrypt } from '../core/encryption';
import { config } from '../core/config';
import { STTProvider } from './interfaces';
import { SarvamSTTAdapter } from './adapters/sarvam-stt.adapter';
import { WhisperSTTAdapter } from './adapters/whisper-stt.adapter';
import { IntronSTTAdapter } from './adapters/intron-stt.adapter';

export async function getSttProvider(tenantId: string, prisma: any): Promise<STTProvider> {
  const record = await prisma.providerConfig.findFirst({
    where: { providerType: 'stt', tenantId, isActive: true },
    orderBy: { priority: 'desc' },
  });

  if (record) {
    if (record.providerName === 'sarvam') {
      return new SarvamSTTAdapter({ apiKey: config.providers.sarvam.apiKey });
    }
    const encrypted = (record.config as any)?.encrypted;
    if (!encrypted) {
      throw new Error(`STT provider config missing encrypted field (tenantId=${tenantId}, providerName=${record.providerName})`);
    }
    const cfg = JSON.parse(decrypt(encrypted));
    if (record.providerName === 'whisper') {
      return new WhisperSTTAdapter({ baseUrl: cfg.baseUrl, model: cfg.model ?? config.providers.stt.whisperModel });
    }
    if (record.providerName === 'intron') {
      return new IntronSTTAdapter({ apiKey: cfg.apiKey });
    }
    throw new Error(`Unsupported STT providerName in DB: "${record.providerName}" (tenantId=${tenantId})`);
  }

  // Env-var fallbacks
  const defaultProvider = config.providers.stt.defaultProvider;
  if (defaultProvider === 'whisper') {
    return new WhisperSTTAdapter({ baseUrl: config.providers.stt.whisperBaseUrl, model: config.providers.stt.whisperModel });
  }
  if (defaultProvider === 'intron' || (!config.providers.sarvam.apiKey && config.providers.intron.apiKey)) {
    if (!config.providers.intron.apiKey) {
      throw new Error('No STT provider configured: STT_DEFAULT_PROVIDER=intron but INTRON_API_KEY is not set');
    }
    return new IntronSTTAdapter({ apiKey: config.providers.intron.apiKey });
  }
  if (!config.providers.sarvam.apiKey) {
    throw new Error('No STT provider configured: no DB record and SARVAM_API_KEY is not set');
  }
  return new SarvamSTTAdapter({ apiKey: config.providers.sarvam.apiKey });
}
