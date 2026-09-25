import { api } from './api';

export interface TenantDocument {
  id: string;
  title: string;
  description?: string;
  contentType: string;
  summary?: string;
  keywords: string[];
  status: string;
  embeddingsCount: number;
  hasSummaryEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentInput {
  file: File;
  title: string;
  summary: string;
  description?: string;
  keywords?: string; // comma-separated
}

export interface DocumentChunk {
  chunkIndex: number;
  chunkText: string;
  characterCount: number;
}

export interface DocumentChunksResponse {
  chunks: DocumentChunk[];
  total: number;
  page: number;
  pageSize: number;
}

export const documentsApi = {
  list: () =>
    api.get<{ success: boolean; data: TenantDocument[]; count: number }>('/documents'),

  upload: (input: UploadDocumentInput) => {
    const form = new FormData();
    form.append('file', input.file);
    form.append('title', input.title);
    form.append('summary', input.summary);
    if (input.description) form.append('description', input.description);
    if (input.keywords) form.append('keywords', input.keywords);
    return api.post<{ success: boolean; data: TenantDocument }>('/documents/upload', form);
  },

  delete: (id: string) => api.delete(`/documents/${id}`),

  getChunks: (id: string, page: number, pageSize = 20) =>
    api.get<{ success: boolean; data: DocumentChunksResponse }>(
      `/documents/${id}/chunks`,
      { params: { page, pageSize } },
    ),
};
