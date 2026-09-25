import axios from 'axios';

// Auth routes are not tenant-scoped — use base URL directly
const authApi = axios.create({ baseURL: '/v1/api/auth' });
const adminApi = axios.create({ baseURL: '/v1/api/admin' });
const reviewerApi = axios.create({ baseURL: '/v1/api/reviewer' });

const attachToken = (config: any) => {
  try {
    const raw = localStorage.getItem('auth');
    if (raw) {
      const { token } = JSON.parse(raw) as { token: string };
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  } catch { /* ignore */ }
  return config;
};

authApi.interceptors.request.use(attachToken);
adminApi.interceptors.request.use(attachToken);
reviewerApi.interceptors.request.use(attachToken);

export type UserRole = 'super_admin' | 'admin' | 'user' | 'reviewer';

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  conditions?: string[];
  fullName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const usersApi = {
  async list(): Promise<AdminUser[]> {
    const res = await authApi.get<{ users: AdminUser[] }>('/users');
    return res.data.users;
  },

  async create(data: {
    email: string;
    password: string;
    role: UserRole;
    fullName?: string;
  }): Promise<AdminUser> {
    const res = await authApi.post<AdminUser>('/users', data);
    return res.data;
  },

  async update(
    id: string,
    data: { password?: string; role?: UserRole; fullName?: string; isActive?: boolean }
  ): Promise<void> {
    await authApi.put(`/users/${id}`, data);
  },

  async updateConditions(email: string, conditions: string[]): Promise<void> {
    await adminApi.put(`/users/${encodeURIComponent(email)}`, { conditions });
  },

  async listAvailableConditions(): Promise<string[]> {
    const res = await reviewerApi.get<{ conditions: { condition: string }[] }>('/available-conditions');
    return res.data.conditions.map((c) => c.condition);
  },

  async remove(id: string): Promise<void> {
    await authApi.delete(`/users/${id}`);
  },
};
