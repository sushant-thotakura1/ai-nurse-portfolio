import { CallState, CallSession } from './session';
import { logger } from '../core/logger';

interface TransitionResult {
  success: boolean;
  state: CallState;
  error?: string;
}

export class CallStateMachine {
  // Define valid state transitions
  private readonly transitions: Map<CallState, CallState[]> = new Map([
    [CallState.INITIATED, [CallState.RINGING, CallState.FAILED]],
    [CallState.RINGING, [CallState.CONNECTED, CallState.FAILED]],
    [CallState.CONNECTED, [CallState.LANGUAGE_DETECTION, CallState.ENDING, CallState.FAILED]],
    [CallState.LANGUAGE_DETECTION, [CallState.CONSENT_CHECK, CallState.ENDING, CallState.FAILED]],
    [CallState.CONSENT_CHECK, [CallState.CONVERSATION, CallState.ENDING, CallState.FAILED]],
    [CallState.CONVERSATION, [CallState.ESCALATING, CallState.ENDING, CallState.FAILED]],
    [CallState.ESCALATING, [CallState.ENDING, CallState.FAILED]],
    [CallState.ENDING, [CallState.COMPLETED, CallState.FAILED]],
    [CallState.COMPLETED, []],  // Terminal state
    [CallState.FAILED, []],     // Terminal state
  ]);

  /**
   * Attempt to transition session to new state
   */
  transition(session: CallSession, newState: CallState): TransitionResult {
    const currentState = session.state;

    // Check if transition is valid
    if (!this.canTransition(currentState, newState)) {
      logger.error('Invalid state transition attempted', {
        sessionId: session.sessionId,
        from: currentState,
        to: newState,
      });

      return {
        success: false,
        state: currentState,
        error: `Invalid state transition from ${currentState} to ${newState}`,
      };
    }

    // Perform transition
    logger.info('Call state transition', {
      sessionId: session.sessionId,
      from: currentState,
      to: newState,
    });

    return {
      success: true,
      state: newState,
    };
  }

  /**
   * Check if transition from currentState to newState is allowed
   */
  canTransition(currentState: CallState, newState: CallState): boolean {
    const allowedStates = this.transitions.get(currentState);
    return allowedStates ? allowedStates.includes(newState) : false;
  }

  /**
   * Check if state is terminal (no further transitions allowed)
   */
  isTerminalState(state: CallState): boolean {
    const allowedTransitions = this.transitions.get(state);
    return !allowedTransitions || allowedTransitions.length === 0;
  }

  /**
   * Get all valid next states for current state
   */
  getValidNextStates(currentState: CallState): CallState[] {
    return this.transitions.get(currentState) || [];
  }

  /**
   * Get state machine visualization
   */
  getStateDiagram(): string {
    let diagram = 'Call State Machine:\n';
    this.transitions.forEach((nextStates, currentState) => {
      if (nextStates.length > 0) {
        diagram += `  ${currentState} -> ${nextStates.join(', ')}\n`;
      } else {
        diagram += `  ${currentState} (terminal)\n`;
      }
    });
    return diagram;
  }
}

export { CallState };
