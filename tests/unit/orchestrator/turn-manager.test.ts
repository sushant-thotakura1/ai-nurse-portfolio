import { TurnManager } from '../../../src/orchestrator/turn-manager';
import { CallSession, CallState } from '../../../src/orchestrator/session';
import { STTProvider } from '../../../src/speech/interfaces';
import { TTSProvider } from '../../../src/speech/interfaces';
import { LLMProvider } from '../../../src/ai-agent/interfaces';

// Mock providers
const mockSTTProvider: jest.Mocked<STTProvider> = {
  transcribe: jest.fn(),
  streamTranscribe: jest.fn(),
};

const mockTTSProvider: jest.Mocked<TTSProvider> = {
  synthesize: jest.fn(),
  getVoiceOptions: jest.fn(),
};

const mockLLMProvider: jest.Mocked<LLMProvider> = {
  complete: jest.fn(),
  stream: jest.fn(),
};

describe('TurnManager', () => {
  let turnManager: TurnManager;
  let mockSession: CallSession;

  beforeEach(() => {
    turnManager = new TurnManager(mockSTTProvider, mockTTSProvider, mockLLMProvider);

    mockSession = {
      sessionId: 'session-123',
      patientId: 'patient-456',
      state: CallState.CONVERSATION,
      locale: 'hi-IN',
      callPurpose: 'POST_SURGERY',
      startedAt: new Date(),
      transcript: [],
      clinicalEvents: [],
      metadata: {},
    } as CallSession;

    jest.clearAllMocks();
  });

  describe('processTurn', () => {
    it('should process complete turn: audio -> STT -> LLM -> TTS', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');

      // Mock STT response
      mockSTTProvider.transcribe.mockResolvedValueOnce({
        text: 'मुझे सिर दर्द है',
        confidence: 0.95,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      // Mock LLM response
      mockLLMProvider.complete.mockResolvedValueOnce({
        content: 'मुझे बताइए, सिर दर्द कब से है?',
        finishReason: 'stop',
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      });

      // Mock TTS response
      const mockAudioResponse = Buffer.from('synthesized-audio');
      mockTTSProvider.synthesize.mockResolvedValueOnce(mockAudioResponse);

      const result = await turnManager.processTurn(mockSession, audioBuffer);

      expect(result.success).toBe(true);
      expect(result.patientText).toBe('मुझे सिर दर्द है');
      expect(result.agentText).toBe('मुझे बताइए, सिर दर्द कब से है?');
      expect(result.audioResponse).toBe(mockAudioResponse);
      expect(mockSession.transcript).toHaveLength(2); // patient + agent
    });

    it('should handle STT failure', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');

      mockSTTProvider.transcribe.mockRejectedValueOnce(new Error('STT failed'));

      const result = await turnManager.processTurn(mockSession, audioBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toContain('STT failed');
    });

    it('should handle LLM failure', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');

      mockSTTProvider.transcribe.mockResolvedValueOnce({
        text: 'test',
        confidence: 0.9,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      mockLLMProvider.complete.mockRejectedValueOnce(new Error('LLM failed'));

      const result = await turnManager.processTurn(mockSession, audioBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM failed');
    });

    it('should handle TTS failure', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');

      mockSTTProvider.transcribe.mockResolvedValueOnce({
        text: 'test',
        confidence: 0.9,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      mockLLMProvider.complete.mockResolvedValueOnce({
        content: 'response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      mockTTSProvider.synthesize.mockRejectedValueOnce(new Error('TTS failed'));

      const result = await turnManager.processTurn(mockSession, audioBuffer);

      expect(result.success).toBe(false);
      expect(result.error).toContain('TTS failed');
    });

    it('should add turn to transcript', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');

      mockSTTProvider.transcribe.mockResolvedValueOnce({
        text: 'patient text',
        confidence: 0.9,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      mockLLMProvider.complete.mockResolvedValueOnce({
        content: 'agent response',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      mockTTSProvider.synthesize.mockResolvedValueOnce(Buffer.from('audio'));

      await turnManager.processTurn(mockSession, audioBuffer);

      expect(mockSession.transcript).toHaveLength(2);
      expect(mockSession.transcript[0].speaker).toBe('patient');
      expect(mockSession.transcript[0].originalText).toBe('patient text');
      expect(mockSession.transcript[1].speaker).toBe('agent');
      expect(mockSession.transcript[1].originalText).toBe('agent response');
    });
  });

  describe('buildConversationHistory', () => {
    it('should build conversation history for LLM', () => {
      mockSession.transcript = [
        {
          turnNumber: 1,
          speaker: 'patient',
          originalText: 'मुझे बुखार है',
          timestamp: new Date(),
        },
        {
          turnNumber: 2,
          speaker: 'agent',
          originalText: 'बुखार कब से है?',
          timestamp: new Date(),
        },
      ];

      const history = turnManager.buildConversationHistory(mockSession);

      expect(history).toHaveLength(3); // system + 2 messages
      expect(history[0].role).toBe('system');
      expect(history[1].role).toBe('user');
      expect(history[1].content).toBe('मुझे बुखार है');
      expect(history[2].role).toBe('assistant');
      expect(history[2].content).toBe('बुखार कब से है?');
    });
  });
});
