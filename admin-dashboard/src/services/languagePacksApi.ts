import axios from 'axios';

const adminApi = axios.create({ baseURL: '/v1/api/admin' });

adminApi.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('auth');
    if (raw) {
      const { token } = JSON.parse(raw) as { token: string };
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  } catch { /* ignore */ }
  return config;
});

export interface LanguagePack {
  id: string;
  localeCode: string;
  displayName: string;
  scripts: Record<string, string>;
  medicalLexicon: Record<string, string>;
  voiceProfile: string | null;
  sttHints: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const languagePacksApi = {
  async list(): Promise<LanguagePack[]> {
    const res = await adminApi.get<{ languagePacks: LanguagePack[] }>('/language-packs');
    return res.data.languagePacks;
  },

  async create(data: Omit<LanguagePack, 'id' | 'createdAt' | 'updatedAt'>): Promise<LanguagePack> {
    const res = await adminApi.post<{ languagePack: LanguagePack }>('/language-packs', data);
    return res.data.languagePack;
  },

  async update(localeCode: string, data: Partial<Omit<LanguagePack, 'id' | 'localeCode' | 'createdAt' | 'updatedAt'>>): Promise<LanguagePack> {
    const res = await adminApi.put<{ languagePack: LanguagePack }>(`/language-packs/${localeCode}`, data);
    return res.data.languagePack;
  },

  async remove(localeCode: string): Promise<void> {
    await adminApi.delete(`/language-packs/${localeCode}`);
  },
};
