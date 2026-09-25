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

export interface TenantFeatures {
  enabledSkills?: string[];
  enabledCapabilities?: string[];
  welcomeMessage?: string | null;
  /** BCP-47 locales offered in the "set my language" flow. Empty = all active language packs. */
  languageOptions?: string[];
}

export interface SkillDefinition {
  name: string;
  label: string;
}

export interface CapabilityDefinition {
  name: string;
  label: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings?: {
    whatsappSessionTimeoutMinutes?: number;
    features?: TenantFeatures;
  } | null;
}

export const tenantsApi = {
  async list(): Promise<Tenant[]> {
    const res = await adminApi.get<{ tenants: Tenant[] }>('/tenants');
    return res.data.tenants;
  },

  async create(name: string, slug: string): Promise<Tenant> {
    const res = await adminApi.post<{ tenant: Tenant }>('/tenants', { name, slug });
    return res.data.tenant;
  },

  async update(id: string, data: {
    name?: string;
    slug?: string;
    status?: string;
    settings?: {
      whatsappSessionTimeoutMinutes?: number;
      features?: TenantFeatures;
    };
  }): Promise<Tenant> {
    const res = await adminApi.put<{ tenant: Tenant }>(`/tenants/${id}`, data);
    return res.data.tenant;
  },
};

export const skillsApi = {
  async list(): Promise<SkillDefinition[]> {
    const res = await adminApi.get<{ skills: SkillDefinition[] }>('/skills');
    return res.data.skills;
  },
};

export const capabilitiesApi = {
  async list(): Promise<CapabilityDefinition[]> {
    const res = await adminApi.get<{ capabilities: CapabilityDefinition[] }>('/capabilities');
    return res.data.capabilities;
  },
};
