import { CallSession, Turn } from './session';
import { STTProvider, TTSProvider } from '../speech/interfaces';
import { LLMProvider, ChatMessage } from '../ai-agent/interfaces';
import { logger } from '../core/logger';

interface TurnResult {
  success: boolean;
  patientText?: string;
  agentText?: string;
  audioResponse?: Buffer;
  error?: string;
  confidence?: number;
}

export class TurnManager {
  constructor(
    private sttProvider: STTProvider,
    private ttsProvider: TTSProvider,
    private llmProvider: LLMProvider
  ) {}

  /**
   * Process a complete turn: Audio -> STT -> LLM -> TTS -> Audio
   */
  async processTurn(session: CallSession, audioBuffer: Buffer): Promise<TurnResult> {
    try {
      logger.info('Processing turn', {
        sessionId: session.sessionId,
        turnNumber: session.transcript.length + 1,
      });

      // Step 1: Transcribe patient audio (STT)
      const transcript = await this.sttProvider.transcribe(
        audioBuffer,
        session.locale,
        [] // TODO: Add medical hints from language pack
      );

      logger.info('Patient speech transcribed', {
        sessionId: session.sessionId,
        text: transcript.text,
        confidence: transcript.confidence,
      });

      // Add patient turn to transcript
      const patientTurn: Turn = {
        turnNumber: session.transcript.length + 1,
        speaker: 'patient',
        originalText: transcript.text,
        timestamp: new Date(),
        confidenceScore: transcript.confidence,
      };
      session.transcript.push(patientTurn);

      // Step 2: Generate agent response (LLM)
      const conversationHistory = this.buildConversationHistory(session);
      const llmResponse = await this.llmProvider.complete(conversationHistory, {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 150,
      });

      logger.info('Agent response generated', {
        sessionId: session.sessionId,
        response: llmResponse.content,
        tokenUsage: llmResponse.usage.totalTokens,
      });

      // Add agent turn to transcript
      const agentTurn: Turn = {
        turnNumber: session.transcript.length + 1,
        speaker: 'agent',
        originalText: llmResponse.content,
        timestamp: new Date(),
      };
      session.transcript.push(agentTurn);

      // Step 3: Synthesize agent response to audio (TTS)
      const audioResponse = await this.ttsProvider.synthesize(
        llmResponse.content,
        session.locale,
        undefined // Use default voice
      );

      logger.info('Turn processing completed', {
        sessionId: session.sessionId,
        audioSize: audioResponse.length,
      });

      return {
        success: true,
        patientText: transcript.text,
        agentText: llmResponse.content,
        audioResponse,
        confidence: transcript.confidence,
      };
    } catch (error: any) {
      logger.error('Turn processing failed', {
        sessionId: session.sessionId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Build conversation history for LLM context
   */
  buildConversationHistory(session: CallSession): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // System prompt
    messages.push({
      role: 'system',
      content: `You are a caring healthcare assistant conducting a ${session.callPurpose} follow-up call in ${session.locale}. Be empathetic, ask follow-up questions, and assess the patient's condition.`,
    });

    // Add conversation history
    for (const turn of session.transcript) {
      messages.push({
        role: turn.speaker === 'patient' ? 'user' : 'assistant',
        content: turn.originalText,
      });
    }

    return messages;
  }

  /**
   * Get turn count for session
   */
  getTurnCount(session: CallSession): number {
    return session.transcript.length;
  }

  /**
   * Get patient turns count
   */
  getPatientTurnCount(session: CallSession): number {
    return session.transcript.filter((t) => t.speaker === 'patient').length;
  }

  /**
   * Get agent turns count
   */
  getAgentTurnCount(session: CallSession): number {
    return session.transcript.filter((t) => t.speaker === 'agent').length;
  }
}
