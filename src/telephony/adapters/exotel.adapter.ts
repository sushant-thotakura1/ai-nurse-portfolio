import axios, { AxiosInstance } from 'axios';
import {
  TelephonyProvider,
  OutboundCallRequest,
  CallSession,
  TelephonyWebhookEvent,
  CallStatus,
} from '../interfaces';
import { logger } from '../../core/logger';

interface ExotelConfig {
  apiKey: string;
  apiToken: string;
  sid: string;
  baseUrl?: string;
}

export class ExotelAdapter implements TelephonyProvider {
  private client: AxiosInstance;
  private config: ExotelConfig;

  constructor(config: ExotelConfig) {
    this.config = config;
    const baseUrl = config.baseUrl || 'https://api.exotel.com/v1';

    this.client = axios.create({
      baseURL: `${baseUrl}/Accounts/${config.sid}`,
      auth: {
        username: config.apiKey,
        password: config.apiToken,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  async makeOutboundCall(params: OutboundCallRequest): Promise<CallSession> {
    try {
      logger.info('Initiating outbound call via Exotel', {
        sessionId: params.sessionId,
        locale: params.locale,
      });

      const response = await this.client.post('/Calls/connect.json', {
        From: this.config.sid, // Exotel virtual number
        To: params.patientPhone,
        Url: `${process.env.API_BASE_URL}/webhooks/exotel/call-status`, // Callback URL
        StatusCallback: `${process.env.API_BASE_URL}/webhooks/exotel/status`,
        Record: true,
      });

      const callId = response.data.Call.Sid;

      logger.info('Outbound call initiated', {
        sessionId: params.sessionId,
        callId,
      });

      return {
        sessionId: params.sessionId,
        callId,
        patientPhone: params.patientPhone,
        locale: params.locale,
        status: CallStatus.INITIATED,
      };
    } catch (error: any) {
      logger.error('Failed to initiate outbound call', {
        error: error.message,
        sessionId: params.sessionId,
      });
      throw new Error(`Exotel call failed: ${error.message}`);
    }
  }

  async handleWebhook(event: TelephonyWebhookEvent): Promise<void> {
    logger.info('Received Exotel webhook', {
      eventType: event.eventType,
      callId: event.callId,
      status: event.status,
    });

    // Webhook handling logic will be implemented when we build the orchestrator
    // For now, just log the event
  }

  async endCall(callId: string): Promise<void> {
    try {
      logger.info('Ending call', { callId });

      await this.client.post(`/Calls/${callId}.json`, {
        Status: 'completed',
      });

      logger.info('Call ended', { callId });
    } catch (error: any) {
      logger.error('Failed to end call', {
        error: error.message,
        callId,
      });
      throw new Error(`Failed to end call: ${error.message}`);
    }
  }

  async streamAudio(callId: string, audioUrl: string): Promise<void> {
    try {
      logger.info('Streaming audio to call', { callId, audioUrl });

      await this.client.post(`/Calls/${callId}/Play.json`, {
        Url: audioUrl,
      });

      logger.info('Audio streaming started', { callId });
    } catch (error: any) {
      logger.error('Failed to stream audio', {
        error: error.message,
        callId,
      });
      throw new Error(`Failed to stream audio: ${error.message}`);
    }
  }

  async recordCall(callId: string, enabled: boolean): Promise<void> {
    try {
      logger.info('Setting call recording', { callId, enabled });

      await this.client.post(`/Calls/${callId}/Record.json`, {
        Record: enabled,
      });

      logger.info('Call recording updated', { callId, enabled });
    } catch (error: any) {
      logger.error('Failed to update call recording', {
        error: error.message,
        callId,
      });
      throw new Error(`Failed to update recording: ${error.message}`);
    }
  }
}
