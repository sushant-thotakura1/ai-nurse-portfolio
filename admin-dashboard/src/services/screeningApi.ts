import { api } from './api';

export type ScreeningStatus = 'in_progress' | 'completed' | 'stopped';
export type ScreeningStatusFilter = 'all' | ScreeningStatus;

export interface ScreeningRecordListItem {
  id: string;
  createdAt: string;
  filledBy: string;
  status: ScreeningStatus;
  name: string | null;
  phone: string | null;
  recommendationSummary: string;
}

export interface ScreeningRecordListResult {
  records: ScreeningRecordListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ScreeningRecordDetailSection {
  title: string;
  items: { prompt: string; answer: string }[];
}

export interface ScreeningRecordDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  filledBy: string;
  status: ScreeningStatus;
  schemaId: string;
  schemaVersion: string;
  identifiers: {
    name: string | null;
    phone: string | null;
    externalId: string | null;
    abhaId: string | null;
  };
  sections: ScreeningRecordDetailSection[];
  recommendation: string[] | null;
  recommendationLabels: string[] | null;
  stopOutcome: { outcome: string; message: string } | null;
}

export interface TenantFeaturesResponse {
  enabledSkills: string[];
  enabledCapabilities: string[];
}

export const screeningApi = {
  async listRecords(params: {
    status: ScreeningStatusFilter;
    limit: number;
    offset: number;
  }): Promise<ScreeningRecordListResult> {
    const res = await api.get('/screening/records', { params });
    return res.data;
  },

  async getRecord(id: string): Promise<ScreeningRecordDetail> {
    const res = await api.get(`/screening/records/${id}`);
    return res.data;
  },

  async downloadCsv(status: ScreeningStatusFilter): Promise<Blob> {
    const res = await api.get('/screening/records.csv', {
      params: { status },
      responseType: 'blob',
    });
    return res.data as Blob;
  },

  async getFeatures(): Promise<TenantFeaturesResponse> {
    const res = await api.get('/features');
    return res.data;
  },
};
