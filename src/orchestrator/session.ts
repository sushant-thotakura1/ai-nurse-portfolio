export enum CallState {
  INITIATED = 'INITIATED',
  RINGING = 'RINGING',
  CONNECTED = 'CONNECTED',
  LANGUAGE_DETECTION = 'LANGUAGE_DETECTION',
  CONSENT_CHECK = 'CONSENT_CHECK',
  CONVERSATION = 'CONVERSATION',
  ESCALATING = 'ESCALATING',
  ENDING = 'ENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface Turn {
  turnNumber: number;
  speaker: 'agent' | 'patient';
  originalText: string;
  translatedText?: string;
  timestamp: Date;
  confidenceScore?: number;
}

export interface CallSession {
  sessionId: string;
  patientId: string;
  callId?: string;
  state: CallState;
  locale: string;
  callPurpose: string;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
  transcript: Turn[];
  clinicalEvents: any[];
  metadata: Record<string, any>;
}
