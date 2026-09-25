import { api } from './api';

export interface CallSession {
  id: string;
  patientId: string;
  callPurpose: string;
  state: string;
  locale: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  outcome?: string;
  feedbackText?: string | null;
  recordingUrl?: string;
  currentPhase?: string;
  daysSinceStart?: number;
  messageSessionId?: string;
  patient?: {
    phoneNumber: string;
    name: string;
    condition?: string | null;
    classification?: string | null;
    conditionStartDate?: string | null;
  };
}

export interface Transcript {
  id: string;
  sessionId: string;
  turnNumber: number;
  speaker: 'agent' | 'patient';
  originalText: string;
  translatedText?: string;
  timestamp: string;
  confidenceScore?: number;
}

export interface ClinicalEvent {
  id: string;
  sessionId: string;
  eventType: string;
  eventData: any;
  riskScore?: string;
  requiresEscalation: boolean;
  createdAt: string;
}

export interface ExportFilters {
  channel?: string;
  outcome?: string;
  condition?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionIds?: string[];
}

export const callApi = {
  async getCallSessions(): Promise<CallSession[]> {
    const response = await api.get('/calls');
    return response.data;
  },

  async exportCallLogs(filters: ExportFilters): Promise<any[]> {
    const response = await api.post('/calls/export', filters);
    return response.data;
  },

  async getConversationTranscript(sessionId: string): Promise<string | null> {
    try {
      const response = await api.get(`/conversations/${sessionId}/transcript`);
      return response.data?.formattedTranscript ?? null;
    } catch {
      return null;
    }
  },

  async getCallSession(id: string): Promise<CallSession> {
    const response = await api.get(`/calls/${id}`);
    return response.data;
  },

  async getTranscripts(sessionId: string): Promise<Transcript[]> {
    const response = await api.get(`/calls/${sessionId}/transcripts`);
    return response.data;
  },

  async getClinicalEvents(sessionId: string): Promise<ClinicalEvent[]> {
    const response = await api.get(`/calls/${sessionId}/events`);
    return response.data;
  },
};
