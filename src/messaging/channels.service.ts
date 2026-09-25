import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../core/encryption';
import { logger } from '../core/logger';
import { config } from '../core/config';

export type ChannelName = 'telegram' | 'whatsapp';
export type VoiceProviderName = 'sarvam' | 'whisper';
export type SttProviderName = VoiceProviderName | 'intron';

export type TtsProviderName = 'sarvam' | 'whisper-tts' | 'edge-tts' | 'intron';

export interface SttConfig {
  activeProvider: SttProviderName;
  baseUrl: string;
}

export interface TtsConfig {
  activeProvider: TtsProviderName;
  baseUrl: string;
}

export interface VoiceProviderConfig {
  activeProvider: VoiceProviderName;
  whisperBaseUrl: string;
}
export type SttProviderConfig = VoiceProviderConfig; // backward-compat alias

export interface ChannelSummary {
  channel: ChannelName;
  configured: boolean;
  isActive: boolean;
  lastRegisteredAt: string | null;
  maskedSecrets: Record<string, string>;
}

export interface ActivateResult {
  status: 'active' | 'configured';
  webhookUrl: string;
  lastRegisteredAt: string;
  note?: string;
  warning?: string;
}

export interface DeactivateResult {
  warning?: string;
}

function maskSecret(value: string): string {
  if (value.length <= 6) return '••••••';
  return '•'.repeat(value.length - 6) + value.slice(-6);
}

function deriveWebhookUrl(baseUrl: string, tenantSlug: string, channel: ChannelName): string {
  return `${baseUrl}/v1/api/${tenantSlug}/webhooks/${channel}`;
}

export class ChannelsService {
  constructor(private readonly prisma: PrismaClient) {}

  async saveAndActivate(
    channel: ChannelName,
    fields: Record<string, string>,
    tenantId: string,
    baseUrl: string,
    tenantSlug: string,
  ): Promise<ActivateResult> {
    const webhookUrl = deriveWebhookUrl(baseUrl, tenantSlug, channel);
    if (channel === 'telegram') {
      return this.saveAndActivateTelegram(fields, tenantId, webhookUrl);
    }
    return this.saveAndActivateWhatsApp(fields, tenantId, webhookUrl);
  }

  private async saveAndActivateTelegram(
    fields: Record<string, string>,
    tenantId: string,
    webhookUrl: string,
  ): Promise<ActivateResult> {
    // Merge with existing credentials if only some fields are provided
    let botToken = fields.botToken;
    let secretToken = fields.secretToken;

    if (!botToken || !secretToken) {
      const existing = await this.prisma.providerConfig.findFirst({
        where: { tenantId, providerName: 'telegram' },
      });
      if (existing) {
        const stored = JSON.parse(decrypt((existing.config as any).encrypted)) as Record<string, string>;
        botToken = botToken || stored.botToken;
        secretToken = secretToken || stored.secretToken;
      }
      if (!botToken || !secretToken) {
        throw new Error('Bot Token and Secret Token are required.');
      }
    }

    // 1. Call Telegram first — if it fails, do NOT save credentials
    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      { url: webhookUrl, secret_token: secretToken },
    );
    if (!tgResponse.data.ok) {
      throw new Error(tgResponse.data.description ?? 'Telegram webhook registration failed');
    }

    // 2. Save encrypted credentials
    const encrypted = encrypt(JSON.stringify({ botToken, secretToken }));
    const row = await this.prisma.providerConfig.upsert({
      where: { tenantId_providerName: { tenantId, providerName: 'telegram' } },
      create: { tenantId, providerType: 'messaging', providerName: 'telegram', config: { encrypted }, isActive: true, priority: 0 },
      update: { config: { encrypted }, isActive: true },
    });

    return {
      status: 'active',
      webhookUrl,
      lastRegisteredAt: row.updatedAt.toISOString(),
    };
  }

  private async saveAndActivateWhatsApp(
    fields: Record<string, string>,
    tenantId: string,
    webhookUrl: string,
  ): Promise<ActivateResult> {
    // Merge incoming fields with any existing stored credentials so that a
    // partial update (e.g. only changing accessToken) does not wipe the other fields.
    let mergedFields = { ...fields };
    const existing = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerName: 'whatsapp' },
    });
    if (existing) {
      try {
        const stored = JSON.parse(decrypt((existing.config as any).encrypted)) as Record<string, string>;
        mergedFields = { ...stored, ...fields }; // stored values as base; incoming fields override
      } catch {
        // Decryption failed — proceed with provided fields only
        logger.warn('saveAndActivateWhatsApp: could not decrypt existing credentials; overwriting', { tenantId });
      }
    }

    const encrypted = encrypt(JSON.stringify(mergedFields));
    await this.prisma.providerConfig.upsert({
      where: { tenantId_providerName: { tenantId, providerName: 'whatsapp' } },
      create: { tenantId, providerType: 'messaging', providerName: 'whatsapp', config: { encrypted }, isActive: true, priority: 0 },
      update: { config: { encrypted }, isActive: true },
    });

    return {
      status: 'configured',
      webhookUrl,
      lastRegisteredAt: new Date().toISOString(),
      note: 'Paste the webhook URL into your Meta developer portal to complete setup.',
    };
  }

  async deactivate(channel: ChannelName, tenantId: string): Promise<DeactivateResult> {
    if (channel === 'telegram') {
      return this.deactivateTelegram(tenantId);
    }
    // WhatsApp: just set isActive = false, no API call
    const row = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerName: 'whatsapp' },
    });
    if (!row) return {};  // already not configured — nothing to deactivate
    await this.prisma.providerConfig.update({
      where: { tenantId_providerName: { tenantId, providerName: 'whatsapp' } },
      data: { isActive: false },
    });
    return {};
  }

  private async deactivateTelegram(tenantId: string): Promise<DeactivateResult> {
    let warning: string | undefined;
    let rowExists = false;

    try {
      const row = await this.prisma.providerConfig.findFirst({
        where: { tenantId, providerName: 'telegram' },
      });
      if (row) {
        rowExists = true;
        const creds = JSON.parse(decrypt((row.config as any).encrypted)) as { botToken: string };
        await axios.post(`https://api.telegram.org/bot${creds.botToken}/deleteWebhook`, {});
      }
    } catch (err: any) {
      warning = `Could not deregister webhook with Telegram: ${err.message}`;
      logger.warn('Telegram deleteWebhook failed during deactivation', { error: err.message });
      rowExists = true;  // Error means row was found but API call failed
    }

    if (rowExists) {
      await this.prisma.providerConfig.update({
        where: { tenantId_providerName: { tenantId, providerName: 'telegram' } },
        data: { isActive: false },
      });
    }

    return warning ? { warning } : {};
  }

  async getChannels(tenantId: string): Promise<ChannelSummary[]> {
    const rows = await this.prisma.providerConfig.findMany({
      where: { tenantId, providerType: 'messaging' },
    });

    return rows.map((row) => {
      let maskedSecrets: Record<string, string> = {};
      try {
        const creds = JSON.parse(decrypt((row.config as any).encrypted)) as Record<string, string>;
        maskedSecrets = Object.fromEntries(
          Object.entries(creds).map(([k, v]) => [k, maskSecret(v)]),
        );
      } catch {
        // Decryption failed — return empty masked secrets
      }

      return {
        channel: row.providerName as ChannelName,
        configured: true,
        isActive: row.isActive,
        lastRegisteredAt: row.updatedAt?.toISOString() ?? null,
        maskedSecrets,
      };
    });
  }

  async getBaseUrl(tenantId: string): Promise<string> {
    const row = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerName: 'base-url' },
    });
    return (row?.config as any)?.url ?? '';
  }

  async saveBaseUrl(url: string, tenantId: string): Promise<void> {
    await this.prisma.providerConfig.upsert({
      where: { tenantId_providerName: { tenantId, providerName: 'base-url' } },
      create: { tenantId, providerType: 'system', providerName: 'base-url', config: { url }, isActive: true, priority: 0 },
      update: { config: { url } },
    });
  }

  async getVoiceProviderConfig(tenantId: string): Promise<VoiceProviderConfig> {
    const record = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerType: 'stt', providerName: 'whisper', isActive: true },
    });
    if (record) {
      const cfg = JSON.parse(decrypt((record.config as any).encrypted ?? '{}'));
      return {
        activeProvider: 'whisper',
        whisperBaseUrl: cfg.baseUrl ?? 'http://speaches:8000/v1',
      };
    }
    return { activeProvider: 'sarvam', whisperBaseUrl: 'http://speaches:8000/v1' };
  }

  async getSttProviderConfig(tenantId: string): Promise<VoiceProviderConfig> {
    const record = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerType: 'stt', isActive: true },
      orderBy: { priority: 'desc' },
    });
    if (record?.providerName === 'whisper') {
      const cfg = JSON.parse(decrypt((record.config as any).encrypted ?? '{}'));
      return { activeProvider: 'whisper', whisperBaseUrl: cfg.baseUrl ?? 'http://speaches:8000/v1' };
    }
    if (record?.providerName === 'intron') {
      return { activeProvider: 'intron' as VoiceProviderName, whisperBaseUrl: '' };
    }
    return { activeProvider: 'sarvam', whisperBaseUrl: 'http://speaches:8000/v1' };
  }

  async saveVoiceProviderConfig(tenantId: string, provider: VoiceProviderName, whisperBaseUrl?: string): Promise<void> {
    if (provider === 'whisper') {
      const baseUrl = whisperBaseUrl ?? 'http://speaches:8000/v1';
      const encryptedStt = encrypt(JSON.stringify({ baseUrl }));
      const encryptedTts = encrypt(JSON.stringify({ baseUrl }));
      // Upsert STT record
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'whisper' } },
        create: { tenantId, providerType: 'stt', providerName: 'whisper', config: { encrypted: encryptedStt }, isActive: true, priority: 1 },
        update: { config: { encrypted: encryptedStt }, isActive: true, priority: 1 },
      });
      // Upsert TTS record
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'whisper-tts' } },
        create: { tenantId, providerType: 'tts', providerName: 'whisper-tts', config: { encrypted: encryptedTts }, isActive: true, priority: 1 },
        update: { config: { encrypted: encryptedTts }, isActive: true, priority: 1 },
      });
    } else {
      // Sarvam: deactivate both whisper STT and TTS records
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerName: 'whisper' },
        data: { isActive: false },
      });
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerName: 'whisper-tts' },
        data: { isActive: false },
      });
    }
  }

  async saveSttProviderConfig(tenantId: string, provider: SttProviderName, whisperBaseUrl?: string): Promise<void> {
    const providerConfig: Record<SttProviderName, () => object> = {
      sarvam: () => ({}),
      whisper: () => ({ encrypted: encrypt(JSON.stringify({ baseUrl: whisperBaseUrl ?? 'http://speaches:8000/v1' })) }),
      intron: () => {
        const apiKey = config.providers.intron.apiKey;
        if (!apiKey) throw new Error('INTRON_API_KEY is not set in the server environment');
        return { encrypted: encrypt(JSON.stringify({ apiKey })) };
      },
    };
    const cfg = providerConfig[provider]();
    await this.prisma.providerConfig.upsert({
      where: { tenantId_providerName: { tenantId, providerName: provider } },
      create: { tenantId, providerType: 'stt', providerName: provider, config: cfg, isActive: true, priority: 1 },
      update: { config: cfg, isActive: true, priority: 1 },
    });
    await this.prisma.providerConfig.updateMany({
      where: { tenantId, providerType: 'stt', providerName: { not: provider } },
      data: { isActive: false },
    });
  }

  async getSttConfig(tenantId: string): Promise<SttConfig> {
    const record = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerType: 'stt', isActive: true },
      orderBy: { priority: 'desc' },
    });
    if (record?.providerName === 'whisper') {
      const cfg = JSON.parse(decrypt((record.config as any).encrypted ?? '{}'));
      return { activeProvider: 'whisper', baseUrl: cfg.baseUrl ?? 'http://speaches:8000/v1' };
    }
    if (record?.providerName === 'intron') {
      return { activeProvider: 'intron', baseUrl: '' };
    }
    return { activeProvider: 'sarvam', baseUrl: '' };
  }

  async saveSttConfig(tenantId: string, provider: SttProviderName, baseUrl?: string): Promise<void> {
    if (provider === 'whisper') {
      const url = baseUrl ?? 'http://speaches:8000/v1';
      const encrypted = encrypt(JSON.stringify({ baseUrl: url }));
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'whisper' } },
        create: { tenantId, providerType: 'stt', providerName: 'whisper', config: { encrypted }, isActive: true, priority: 1 },
        update: { config: { encrypted }, isActive: true, priority: 1 },
      });
    } else {
      // Sarvam: deactivate all active STT records
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerType: 'stt' },
        data: { isActive: false },
      });
    }
  }

  async getTtsConfig(tenantId: string): Promise<TtsConfig> {
    const record = await this.prisma.providerConfig.findFirst({
      where: { tenantId, providerType: 'tts', isActive: true },
      orderBy: { priority: 'desc' },
    });
    if (record?.providerName === 'edge-tts') {
      const cfg = JSON.parse(decrypt((record.config as any).encrypted ?? '{}'));
      return { activeProvider: 'edge-tts', baseUrl: cfg.baseUrl ?? 'http://edge-tts:8000/v1' };
    }
    if (record?.providerName === 'whisper-tts') {
      const cfg = JSON.parse(decrypt((record.config as any).encrypted ?? '{}'));
      return { activeProvider: 'whisper-tts', baseUrl: cfg.baseUrl ?? 'http://speaches:8000/v1' };
    }
    if (record?.providerName === 'intron-tts') {
      return { activeProvider: 'intron', baseUrl: '' };
    }
    return { activeProvider: 'sarvam', baseUrl: '' };
  }

  async saveTtsConfig(tenantId: string, provider: TtsProviderName, baseUrl?: string): Promise<void> {
    if (provider === 'edge-tts') {
      const url = baseUrl ?? 'http://edge-tts:8000/v1';
      const encrypted = encrypt(JSON.stringify({ baseUrl: url }));
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'edge-tts' } },
        create: { tenantId, providerType: 'tts', providerName: 'edge-tts', config: { encrypted }, isActive: true, priority: 1 },
        update: { config: { encrypted }, isActive: true, priority: 1 },
      });
      // Deactivate other TTS providers
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerType: 'tts', providerName: { not: 'edge-tts' } },
        data: { isActive: false },
      });
    } else if (provider === 'whisper-tts') {
      const url = baseUrl ?? 'http://speaches:8000/v1';
      const encrypted = encrypt(JSON.stringify({ baseUrl: url }));
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'whisper-tts' } },
        create: { tenantId, providerType: 'tts', providerName: 'whisper-tts', config: { encrypted }, isActive: true, priority: 1 },
        update: { config: { encrypted }, isActive: true, priority: 1 },
      });
      // Deactivate other TTS providers
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerType: 'tts', providerName: { not: 'whisper-tts' } },
        data: { isActive: false },
      });
    } else if (provider === 'intron') {
      const apiKey = config.providers.intron.apiKey;
      if (!apiKey) throw new Error('INTRON_API_KEY is not set in the server environment');
      const encrypted = encrypt(JSON.stringify({ apiKey }));
      await this.prisma.providerConfig.upsert({
        where: { tenantId_providerName: { tenantId, providerName: 'intron-tts' } },
        create: { tenantId, providerType: 'tts', providerName: 'intron-tts', config: { encrypted }, isActive: true, priority: 1 },
        update: { config: { encrypted }, isActive: true, priority: 1 },
      });
      // Deactivate other TTS providers
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerType: 'tts', providerName: { not: 'intron-tts' } },
        data: { isActive: false },
      });
    } else {
      // Sarvam: deactivate all active TTS records
      await this.prisma.providerConfig.updateMany({
        where: { tenantId, providerType: 'tts' },
        data: { isActive: false },
      });
    }
  }
}
