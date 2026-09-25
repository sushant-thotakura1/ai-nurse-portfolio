import { prisma } from '../core/database';
import { decrypt } from '../core/encryption';
import { logger } from '../core/logger';

interface TranscriptTurn {
  speaker: string;
  originalText: string;
  timestamp: Date | string;
}

export interface PatientSummary {
  name: string;
  phoneNumber: string;
  condition: string | null;
  classification: string | null;
  conditionStartDate: Date | null;
}

export interface TranscriptResult {
  sessionId: string;
  sessionType: 'messaging' | 'voice';
  channel: string;
  patientId: string;
  patient: PatientSummary;
  startedAt: Date;
  endedAt: Date | null;
  outcome: string | null;
  feedbackText: string | null;
  formattedTranscript: string;
}

function formatTurns(sessionId: string, channel: string, startedAt: Date, turns: TranscriptTurn[]): string {
  if (turns.length === 0) return '';
  const date = startedAt.toISOString().split('T')[0];
  const header = `[Session: ${sessionId} | Channel: ${channel} | Date: ${date}]`;
  const body = turns
    .map(t => `${t.speaker === 'agent' ? 'Nurse' : 'Patient'}: ${t.originalText}`)
    .join('\n');
  return `${header}\n\n${body}`;
}

function decryptPatientSummary(patient: any): PatientSummary {
  let name = '';
  try {
    if (patient.encryptedName) name = decrypt(patient.encryptedName);
  } catch (err: any) {
    logger.error('Failed to decrypt patient name', { error: err.message, patientId: patient.id });
  }
  return {
    name,
    phoneNumber: patient.phoneNumber,
    condition: patient.condition ?? null,
    classification: patient.classification ?? null,
    conditionStartDate: patient.conditionStartDate ?? null,
  };
}

export class ConversationsService {
  async getTranscript(tenantId: string, sessionId: string): Promise<TranscriptResult> {
    const msgSession = await prisma.messageSession.findFirst({
      where: { id: sessionId, tenantId },
    });

    if (msgSession) {
      const turns = (msgSession.transcript as unknown as TranscriptTurn[]) ?? [];

      const [patient, callSession] = await Promise.all([
        prisma.patient.findFirst({ where: { id: msgSession.patientId } }),
        prisma.callSession.findFirst({
          where: { messageSessionId: sessionId, tenantId },
          select: { outcome: true, feedbackText: true, endedAt: true },
        }),
      ]);

      return {
        sessionId,
        sessionType: 'messaging',
        channel: msgSession.channel,
        patientId: msgSession.patientId,
        patient: decryptPatientSummary(patient),
        startedAt: msgSession.createdAt,
        endedAt: callSession?.endedAt ?? null,
        outcome: callSession?.outcome ?? null,
        feedbackText: callSession?.feedbackText ?? null,
        formattedTranscript: formatTurns(sessionId, msgSession.channel, msgSession.createdAt, turns),
      };
    }

    // Fallback for closed WhatsApp sessions: findOrResetSession deletes the
    // MessageSession row when the patient starts a new conversation, so the
    // direct lookup above returns null. The linked CallSession still exists
    // with messageSessionId pointing at the (now-deleted) row, and
    // SessionClosingService already wrote Transcript rows keyed to callSession.id.
    const callSessionByMsgId = await prisma.callSession.findFirst({
      where: { messageSessionId: sessionId, tenantId },
      include: { patient: true },
    });

    if (callSessionByMsgId) {
      const rows = await prisma.transcript.findMany({
        where: { sessionId: callSessionByMsgId.id },
        orderBy: { turnNumber: 'asc' },
      });
      const turns: TranscriptTurn[] = rows.map((r: any) => ({
        speaker: r.speaker,
        originalText: r.originalText,
        timestamp: r.timestamp,
      }));
      return {
        sessionId,
        sessionType: 'messaging',
        channel: callSessionByMsgId.callPurpose ?? 'WHATSAPP_CHAT',
        patientId: callSessionByMsgId.patientId,
        patient: decryptPatientSummary(callSessionByMsgId.patient),
        startedAt: callSessionByMsgId.startedAt,
        endedAt: callSessionByMsgId.endedAt ?? null,
        outcome: callSessionByMsgId.outcome ?? null,
        feedbackText: callSessionByMsgId.feedbackText ?? null,
        formattedTranscript: formatTurns(sessionId, callSessionByMsgId.callPurpose ?? 'WHATSAPP_CHAT', callSessionByMsgId.startedAt, turns),
      };
    }

    const callSession = await prisma.callSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { patient: true },
    });

    if (callSession) {
      const rows = await prisma.transcript.findMany({
        where: { sessionId },
        orderBy: { turnNumber: 'asc' },
      });
      const turns: TranscriptTurn[] = rows.map((r: any) => ({
        speaker: r.speaker,
        originalText: r.originalText,
        timestamp: r.timestamp,
      }));
      return {
        sessionId,
        sessionType: 'voice',
        channel: 'voice',
        patientId: callSession.patientId,
        patient: decryptPatientSummary(callSession.patient),
        startedAt: callSession.startedAt,
        endedAt: callSession.endedAt ?? null,
        outcome: callSession.outcome ?? null,
        feedbackText: callSession.feedbackText ?? null,
        formattedTranscript: formatTurns(sessionId, 'voice', callSession.startedAt, turns),
      };
    }

    throw new Error('Session not found');
  }
}

export const conversationsService = new ConversationsService();
