import { CallStateMachine, CallState } from '../../../src/orchestrator/state-machine';
import { CallSession } from '../../../src/orchestrator/session';

describe('CallStateMachine', () => {
  let stateMachine: CallStateMachine;
  let mockSession: CallSession;

  beforeEach(() => {
    stateMachine = new CallStateMachine();
    mockSession = {
      sessionId: 'session-123',
      patientId: 'patient-456',
      state: CallState.INITIATED,
      locale: 'hi-IN',
      callPurpose: 'POST_SURGERY',
      startedAt: new Date(),
      transcript: [],
      clinicalEvents: [],
      metadata: {},
    } as CallSession;
  });

  describe('State Transitions', () => {
    it('should transition from INITIATED to RINGING', () => {
      const result = stateMachine.transition(mockSession, CallState.RINGING);
      expect(result.state).toBe(CallState.RINGING);
      expect(result.success).toBe(true);
    });

    it('should transition from RINGING to CONNECTED', () => {
      mockSession.state = CallState.RINGING;
      const result = stateMachine.transition(mockSession, CallState.CONNECTED);
      expect(result.state).toBe(CallState.CONNECTED);
      expect(result.success).toBe(true);
    });

    it('should transition from CONNECTED to LANGUAGE_DETECTION', () => {
      mockSession.state = CallState.CONNECTED;
      const result = stateMachine.transition(mockSession, CallState.LANGUAGE_DETECTION);
      expect(result.state).toBe(CallState.LANGUAGE_DETECTION);
      expect(result.success).toBe(true);
    });

    it('should transition from LANGUAGE_DETECTION to CONSENT_CHECK', () => {
      mockSession.state = CallState.LANGUAGE_DETECTION;
      const result = stateMachine.transition(mockSession, CallState.CONSENT_CHECK);
      expect(result.state).toBe(CallState.CONSENT_CHECK);
      expect(result.success).toBe(true);
    });

    it('should transition from CONSENT_CHECK to CONVERSATION', () => {
      mockSession.state = CallState.CONSENT_CHECK;
      const result = stateMachine.transition(mockSession, CallState.CONVERSATION);
      expect(result.state).toBe(CallState.CONVERSATION);
      expect(result.success).toBe(true);
    });

    it('should transition from CONVERSATION to ENDING', () => {
      mockSession.state = CallState.CONVERSATION;
      const result = stateMachine.transition(mockSession, CallState.ENDING);
      expect(result.state).toBe(CallState.ENDING);
      expect(result.success).toBe(true);
    });

    it('should transition from ENDING to COMPLETED', () => {
      mockSession.state = CallState.ENDING;
      const result = stateMachine.transition(mockSession, CallState.COMPLETED);
      expect(result.state).toBe(CallState.COMPLETED);
      expect(result.success).toBe(true);
    });

    it('should allow FAILED from any state', () => {
      mockSession.state = CallState.CONVERSATION;
      const result = stateMachine.transition(mockSession, CallState.FAILED);
      expect(result.state).toBe(CallState.FAILED);
      expect(result.success).toBe(true);
    });

    it('should reject invalid state transition', () => {
      mockSession.state = CallState.INITIATED;
      const result = stateMachine.transition(mockSession, CallState.CONVERSATION);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });
  });

  describe('State Validation', () => {
    it('should validate allowed transitions', () => {
      expect(stateMachine.canTransition(CallState.INITIATED, CallState.RINGING)).toBe(true);
      expect(stateMachine.canTransition(CallState.INITIATED, CallState.CONVERSATION)).toBe(false);
    });

    it('should check if state is terminal', () => {
      expect(stateMachine.isTerminalState(CallState.COMPLETED)).toBe(true);
      expect(stateMachine.isTerminalState(CallState.FAILED)).toBe(true);
      expect(stateMachine.isTerminalState(CallState.CONVERSATION)).toBe(false);
    });
  });

  describe('Escalation', () => {
    it('should allow escalation from CONVERSATION', () => {
      mockSession.state = CallState.CONVERSATION;
      const result = stateMachine.transition(mockSession, CallState.ESCALATING);
      expect(result.state).toBe(CallState.ESCALATING);
      expect(result.success).toBe(true);
    });

    it('should transition from ESCALATING to ENDING', () => {
      mockSession.state = CallState.ESCALATING;
      const result = stateMachine.transition(mockSession, CallState.ENDING);
      expect(result.state).toBe(CallState.ENDING);
      expect(result.success).toBe(true);
    });
  });
});
