import axios from 'axios';
import { tenantStore } from './tenantStore';

export const api = axios.create();
// baseURL is set dynamically on every request by the interceptor below

// Request interceptor — attach Bearer token if present
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('auth');
    if (raw) {
      const { token } = JSON.parse(raw) as { token: string };
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return config;
});

// Request interceptor — rewrite baseURL from tenantStore before every request
// so tenant switching works without recreating the axios instance.
api.interceptors.request.use((config) => {
  config.baseURL = `/v1/api/${tenantStore.get()}`;
  return config;
});

// Response interceptor — redirect to /login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface Patient {
  id: string;
  phoneNumber: string;
  name: string;
  dob?: string;
  gender?: string;
  preferredLocale: string;
  consentStatus: string;
  consentRecordedAt?: string;
  condition?: string;
  classification?: string;
  conditionStartDate?: string;
  triggerType?: string;
  knowledgeGraphId?: string;
  isTestIdentity?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePatientRequest {
  phoneNumber: string;
  name: string;
  dob?: string;
  gender?: string;
  preferredLocale: string;
  consentStatus: string;
  condition?: string;
  classification?: string;
  knowledgeGraphId?: string;
  conditionStartDate?: string;
  triggerType?: string;
  isTestIdentity?: boolean;
}

export interface KnowledgeGraphListItem {
  id: string;
  condition: string;
  classifications: string[];
  version: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  isValid: boolean;
  conditionType: 'episodic' | 'chronic' | 'hybrid' | null;
  phaseNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportResult {
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{
    row: number;
    field: string;
    message: string;
  }>;
}

export const patientApi = {
  // Get all patients
  async getPatients(): Promise<Patient[]> {
    const response = await api.get('/patients');
    return response.data;
  },

  // Get patient by ID
  async getPatient(id: string): Promise<Patient> {
    const response = await api.get(`/patients/${id}`);
    return response.data;
  },

  // Create new patient
  async createPatient(data: CreatePatientRequest): Promise<Patient> {
    const response = await api.post('/patients', data);
    return response.data;
  },

  // Update patient
  async updatePatient(id: string, data: Partial<CreatePatientRequest>): Promise<Patient> {
    const response = await api.put(`/patients/${id}`, data);
    return response.data;
  },

  // Import patients from CSV
  async importPatients(file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/patients/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};
