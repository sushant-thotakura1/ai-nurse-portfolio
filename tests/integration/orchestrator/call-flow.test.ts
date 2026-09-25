import { CallHandler } from '../../../src/orchestrator/call-handler';
import { ExotelAdapter } from '../../../src/telephony/adapters/exotel.adapter';
import { SarvamSTTAdapter } from '../../../src/speech/adapters/sarvam-stt.adapter';
import { SarvamTTSAdapter } from '../../../src/speech/adapters/sarvam-tts.adapter';
import { OpenAIAdapter } from '../../../src/ai-agent/adapters/openai.adapter';
import { CallStateMachine } from '../../../src/orchestrator/state-machine';
import { TurnManager } from '../../../src/orchestrator/turn-manager';
import { CallState } from '../../../src/orchestrator/session';
import { CallStatus } from '../../../src/telephony/interfaces';

// Mock all adapters
jest.mock('../../../src/telephony/adapters/exotel.adapter');
jest.mock('../../../src/speech/adapters/sarvam-stt.adapter');
jest.mock('../../../src/speech/adapters/sarvam-tts.adapter');
jest.mock('../../../src/ai-agent/adapters/openai.adapter');

describe('CallHandler - End-to-End Call Flow Integration', () => {
  let callHandler: CallHandler;
  let mockExotel: jest.Mocked<ExotelAdapter>;
  let mockSTT: jest.Mocked<SarvamSTTAdapter>;
  let mockTTS: jest.Mocked<SarvamTTSAdapter>;
  let mockLLM: jest.Mocked<OpenAIAdapter>;

  beforeEach(() => {
    // Create mocked instances
    mockExotel = new ExotelAdapter({
      apiKey: 'test',
      apiToken: 'test',
      sid: 'test',
    }) as jest.Mocked<ExotelAdapter>;

    mockSTT = new SarvamSTTAdapter({
      apiKey: 'test',
    }) as jest.Mocked<SarvamSTTAdapter>;

    mockTTS = new SarvamTTSAdapter({
      apiKey: 'test',
    }) as jest.Mocked<SarvamTTSAdapter>;

    mockLLM = new OpenAIAdapter({
      apiKey: 'test',
    }) as jest.Mocked<OpenAIAdapter>;

    // Create call handler with mocked dependencies
    callHandler = new CallHandler(
      mockExotel,
      mockSTT,
      mockTTS,
      mockLLM
    );

    jest.clearAllMocks();
  });

  describe('initiateOutboundCall', () => {
    it('should initiate complete outbound call flow', async () => {
      // Setup mocks
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const result = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      expect(result.sessionId).toBeDefined();
      expect(result.callId).toBe('call-123');
      expect(result.state).toBe(CallState.INITIATED);
      expect(mockExotel.makeOutboundCall).toHaveBeenCalledWith(
        expect.objectContaining({
          patientPhone: '+919876543210',
          locale: 'hi-IN',
          callPurpose: 'POST_SURGERY',
        })
      );
    });

    it('should handle call initiation failure', async () => {
      mockExotel.makeOutboundCall.mockRejectedValue(
        new Error('Telephony provider error')
      );

      await expect(
        callHandler.initiateOutboundCall({
          patientId: 'patient-456',
          patientPhone: '+919876543210',
          locale: 'hi-IN',
          callPurpose: 'POST_SURGERY',
        })
      ).rejects.toThrow('Telephony provider error');
    });
  });

  describe('handleCallConnected', () => {
    it('should follow proper state flow: INITIATED -> RINGING -> CONNECTED', async () => {
      // First initiate the call
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // First transition to ringing
      await callHandler.transitionToRinging(session.sessionId);
      let updatedSession = await callHandler.getSession(session.sessionId);
      expect(updatedSession.state).toBe(CallState.RINGING);

      // Mock greeting synthesis
      mockTTS.synthesize.mockResolvedValue(Buffer.from('audio-data'));

      // Then handle call connected
      await callHandler.handleCallConnected(session.sessionId);

      updatedSession = await callHandler.getSession(session.sessionId);
      expect(updatedSession.state).toBe(CallState.CONNECTED);
    });
  });

  describe('processConversationalTurn', () => {
    it('should process complete conversational turn (STT -> LLM -> TTS)', async () => {
      // Setup session
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // Follow proper state flow: INITIATED -> RINGING -> CONNECTED -> LANGUAGE_DETECTION -> CONSENT_CHECK -> CONVERSATION
      await callHandler.transitionToRinging(session.sessionId);
      await callHandler.handleCallConnected(session.sessionId);
      await callHandler.transitionToLanguageDetection(session.sessionId);
      await callHandler.transitionToConsentCheck(session.sessionId);
      await callHandler.transitionToConversation(session.sessionId);

      mockTTS.synthesize.mockResolvedValue(Buffer.from('audio-data'));

      // Mock patient audio input
      const patientAudio = Buffer.from('patient-audio');

      // Mock STT response
      mockSTT.transcribe.mockResolvedValue({
        text: 'I am feeling some pain',
        confidence: 0.95,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      // Mock LLM response
      mockLLM.complete.mockResolvedValue({
        content: 'I understand you are experiencing pain. Can you describe where the pain is located?',
        finishReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      // Mock TTS response
      mockTTS.synthesize.mockResolvedValue(Buffer.from('agent-audio-response'));

      // Process turn
      const result = await callHandler.processConversationalTurn(
        session.sessionId,
        patientAudio
      );

      expect(result.patientText).toBe('I am feeling some pain');
      expect(result.agentText).toContain('experiencing pain');
      expect(result.audioResponse).toBeInstanceOf(Buffer);

      // Verify full pipeline
      expect(mockSTT.transcribe).toHaveBeenCalledWith(
        patientAudio,
        'hi-IN',
        []
      );
      expect(mockLLM.complete).toHaveBeenCalled();
      expect(mockTTS.synthesize).toHaveBeenCalled();
    });

    it('should extract clinical events during conversation', async () => {
      // Setup session
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // Follow proper state flow
      await callHandler.transitionToRinging(session.sessionId);
      await callHandler.handleCallConnected(session.sessionId);
      await callHandler.transitionToLanguageDetection(session.sessionId);
      await callHandler.transitionToConsentCheck(session.sessionId);
      await callHandler.transitionToConversation(session.sessionId);

      mockTTS.synthesize.mockResolvedValue(Buffer.from('audio-data'));

      // Mock critical symptom
      mockSTT.transcribe.mockResolvedValue({
        text: 'I have severe chest pain and difficulty breathing',
        confidence: 0.95,
        locale: 'hi-IN',
        timestamp: new Date(),
      });

      // Mock LLM response for conversation
      mockLLM.complete
        .mockResolvedValueOnce({
          content: 'This sounds serious. I am connecting you to a healthcare professional immediately.',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })
        // Mock LLM response for clinical event extraction
        .mockResolvedValueOnce({
          content: JSON.stringify({
            events: [
              {
                type: 'SYMPTOM_CHECK',
                symptoms: ['severe chest pain', 'difficulty breathing'],
                severity: 'critical',
              },
            ],
          }),
          finishReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        });

      mockTTS.synthesize.mockResolvedValue(Buffer.from('agent-audio-response'));

      const result = await callHandler.processConversationalTurn(
        session.sessionId,
        Buffer.from('audio')
      );

      // Verify clinical event was detected and escalation triggered
      const updatedSession = await callHandler.getSession(session.sessionId);
      expect(updatedSession.clinicalEvents.length).toBeGreaterThan(0);

      const criticalEvent = updatedSession.clinicalEvents.find(
        (e: any) => e.riskScore === 'CRITICAL'
      );
      expect(criticalEvent).toBeDefined();
    });
  });

  describe('endCall', () => {
    it('should complete call flow and persist session data', async () => {
      // Setup session
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // Follow state flow to a state where ending is allowed (from CONVERSATION -> ENDING -> COMPLETED)
      await callHandler.transitionToRinging(session.sessionId);
      await callHandler.handleCallConnected(session.sessionId);
      await callHandler.transitionToLanguageDetection(session.sessionId);
      await callHandler.transitionToConsentCheck(session.sessionId);
      await callHandler.transitionToConversation(session.sessionId);

      // Mock end call
      mockExotel.endCall.mockResolvedValue();

      // End the call
      await callHandler.endCall(session.sessionId, 'COMPLETED');

      expect(mockExotel.endCall).toHaveBeenCalledWith('call-123');

      const updatedSession = await callHandler.getSession(session.sessionId);
      expect(updatedSession.state).toBe(CallState.COMPLETED);
    });
  });

  describe('error handling and resilience', () => {
    it('should handle STT failure gracefully', async () => {
      // Setup session
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // Follow proper state flow
      await callHandler.transitionToRinging(session.sessionId);
      await callHandler.handleCallConnected(session.sessionId);
      await callHandler.transitionToLanguageDetection(session.sessionId);
      await callHandler.transitionToConsentCheck(session.sessionId);
      await callHandler.transitionToConversation(session.sessionId);

      // Mock STT failure
      mockSTT.transcribe.mockRejectedValue(new Error('STT service unavailable'));

      await expect(
        callHandler.processConversationalTurn(
          session.sessionId,
          Buffer.from('audio')
        )
      ).rejects.toThrow();
    });

    it('should handle timeout during conversation', async () => {
      // Setup session
      mockExotel.makeOutboundCall.mockResolvedValue({
        sessionId: 'session-123',
        callId: 'call-123',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        status: CallStatus.INITIATED,
      });

      const session = await callHandler.initiateOutboundCall({
        patientId: 'patient-456',
        patientPhone: '+919876543210',
        locale: 'hi-IN',
        callPurpose: 'POST_SURGERY',
      });

      // Get to conversation state first
      await callHandler.transitionToRinging(session.sessionId);
      await callHandler.handleCallConnected(session.sessionId);
      await callHandler.transitionToLanguageDetection(session.sessionId);
      await callHandler.transitionToConsentCheck(session.sessionId);
      await callHandler.transitionToConversation(session.sessionId);

      // Mock endCall
      mockExotel.endCall.mockResolvedValue();

      // Simulate timeout
      await callHandler.handleTimeout(session.sessionId);

      const updatedSession = await callHandler.getSession(session.sessionId);
      expect(updatedSession.state).toBe(CallState.COMPLETED);
    });
  });
});
