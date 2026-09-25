import { MessageState } from '../messaging/session';
import { ClinicalContext } from '../knowledge-graph/context-loader';
import { ChatMessage } from '../ai-agent/interfaces';
import { SessionContext } from './conversation-skill';

const MAX_TRANSCRIPT_TURNS = 8;

export function buildSessionContext(
  patient: any,
  session: any,
  clinicalCtx: ClinicalContext | null,
  inboundText: string,
  detectedLocale: string | null,
  locale: string,
  patientName: string | null = null,
  replyingToQuestion?: string,
): SessionContext {
  const rawTranscript: any[] = (session.transcript as any[]) ?? [];
  const agentTurns = rawTranscript.filter((t: any) => t.speaker === 'agent').length;
  const isFirstConversationTurn = agentTurns <= 1;
  const trimmed = rawTranscript.slice(-MAX_TRANSCRIPT_TURNS);

  const recentTranscript = trimmed.map((t: any) => ({
    speaker: t.speaker as 'patient' | 'agent',
    text: t.originalText as string,
  }));

  const transcriptHistory: ChatMessage[] = trimmed.map((t: any) => ({
    role: (t.speaker === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user',
    content: t.originalText as string,
  }));

  return {
    patientId: patient.id,
    condition: patient.condition ?? null,
    classification: patient.classification ?? null,
    currentPhase: clinicalCtx?.patientContext.currentPhase ?? null,
    locale,
    recentTranscript,
    sessionState: session.state as MessageState,
    currentMessage: inboundText,
    detectedLocale,
    clinicalCtx,
    transcriptHistory,
    isFirstConversationTurn,
    patientName,
    replyingToQuestion,
  };
}
