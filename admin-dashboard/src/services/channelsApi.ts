import { api } from './api';  // axios instance with auth interceptor + TENANT_ID base

export type ChannelName = 'telegram' | 'whatsapp';

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

export const channelsApi = {
  async getAll(): Promise<{ channels: ChannelSummary[]; baseUrl: string }> {
    const res = await api.get('/channels');
    return res.data;
  },

  async saveBaseUrl(url: string): Promise<void> {
    await api.put('/channels/base-url', { url });
  },

  async saveAndActivate(channel: ChannelName, fields: Record<string, string>): Promise<ActivateResult> {
    const res = await api.put(`/channels/${channel}`, fields);
    return res.data;
  },

  async deactivate(channel: ChannelName): Promise<{ warning?: string }> {
    const res = await api.delete(`/channels/${channel}`);
    return res.data;
  },
};

export type SttProviderName = 'sarvam' | 'whisper' | 'intron';

export interface SttProviderConfig {
  activeProvider: SttProviderName;
  whisperBaseUrl: string;
}

export const sttProviderApi = {
  async get(): Promise<SttProviderConfig> {
    const res = await api.get('/channels/stt-provider');
    return res.data;
  },

  async save(provider: SttProviderName, whisperBaseUrl?: string): Promise<void> {
    await api.put('/channels/stt-provider', { provider, whisperBaseUrl });
  },
};

export type TtsProviderName = 'sarvam' | 'whisper-tts' | 'edge-tts' | 'intron';

export interface TtsProviderConfig {
  activeProvider: TtsProviderName;
  baseUrl: string;
}

export const ttsProviderApi = {
  async get(): Promise<TtsProviderConfig> {
    const res = await api.get('/channels/tts-provider');
    return res.data;
  },

  async save(provider: TtsProviderName, baseUrl?: string): Promise<void> {
    await api.put('/channels/tts-provider', { provider, baseUrl });
  },
};

/** Client-side secure random token — no server round-trip needed */
export function generateSecureToken(): string {
  const arr = new Uint8Array(32);
  window.crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
