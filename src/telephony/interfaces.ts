export interface OutboundCallRequest {
  patientPhone: string;
  locale: string;
  callPurpose: string;
  sessionId: string;
}

export interface CallSession {
  sessionId: string;
  callId: string;
  patientPhone: string;
  locale: string;
  status: CallStatus;
  startedAt?: Date;
  endedAt?: Date;
}

export enum CallStatus {
  INITIATED = 'INITIATED',
  RINGING = 'RINGING',
  CONNECTED = 'CONNECTED',
  ENDED = 'ENDED',
  FAILED = 'FAILED',
}

export interface TelephonyWebhookEvent {
  eventType: string;
  callId: string;
  status: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface TelephonyProvider {
  /**
   * Initiate an outbound call
   */
  makeOutboundCall(params: OutboundCallRequest): Promise<CallSession>;

  /**
   * Handle incoming webhook events from telephony provider
   */
  handleWebhook(event: TelephonyWebhookEvent): Promise<void>;

  /**
   * End an active call
   */
  endCall(callId: string): Promise<void>;

  /**
   * Stream audio to an active call
   */
  streamAudio(callId: string, audioUrl: string): Promise<void>;

  /**
   * Enable/disable call recording
   */
  recordCall(callId: string, enabled: boolean): Promise<void>;
}
