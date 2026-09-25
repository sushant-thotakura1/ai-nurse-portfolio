import { prisma } from '../core/database';
import { decrypt } from '../core/encryption';
import { logger } from '../core/logger';
import { getTenantContext } from '../core/tenant-context-storage';
import { conversationsService } from '../conversations/service';

export interface ExportFilters {
  channel?: 'WHATSAPP_CHAT' | 'VOICE';
  outcome?: string;
  condition?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionIds?: string[];
}

export class CallLogsService {
  async getAllCallSessions(limit: number = 50, offset: number = 0) {
    try {
      // Tenant filtering is automatic via Prisma middleware
      const sessions = await prisma.callSession.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: true,
        },
      });

      return sessions.map(session => ({
        ...session,
        patient: {
          phoneNumber: session.patient.phoneNumber,
          name: session.patient.encryptedName ? decrypt(session.patient.encryptedName) : '',
          condition: session.patient.condition,
          classification: session.patient.classification,
          conditionStartDate: session.patient.conditionStartDate,
        },
      }));
    } catch (error: any) {
      logger.error('Failed to get call sessions', { error: error.message, stack: error.stack });
      throw new Error('Failed to retrieve call sessions');
    }
  }

  async getCallSessionById(sessionId: string) {
    try {
      // Tenant filtering is automatic via Prisma middleware
      const session = await prisma.callSession.findUnique({
        where: { id: sessionId },
        include: {
          patient: true,
        },
      });

      if (!session) {
        throw new Error('Call session not found');
      }

      return {
        ...session,
        patient: {
          phoneNumber: session.patient.phoneNumber,
          name: decrypt(session.patient.encryptedName),
          condition: session.patient.condition,
          classification: session.patient.classification,
          conditionStartDate: session.patient.conditionStartDate,
        },
      };
    } catch (error: any) {
      logger.error('Failed to get call session by ID', { error: error.message });
      throw error;
    }
  }

  async getTranscriptsBySessionId(sessionId: string) {
    try {
      // First verify the session exists and is tenant-scoped
      // Tenant filtering is automatic via Prisma middleware
      const session = await prisma.callSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Call session not found');
      }

      // Get transcripts for this session
      const transcripts = await prisma.transcript.findMany({
        where: { sessionId },
        orderBy: { turnNumber: 'asc' },
      });

      return transcripts;
    } catch (error: any) {
      logger.error('Failed to get transcripts', { error: error.message });
      throw new Error('Failed to retrieve transcripts');
    }
  }

  async getClinicalEventsBySessionId(sessionId: string) {
    try {
      // First verify the session exists and is tenant-scoped
      // Tenant filtering is automatic via Prisma middleware
      const session = await prisma.callSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new Error('Call session not found');
      }

      // Get clinical events for this session
      // Tenant filtering is automatic via Prisma middleware (ClinicalEvent has tenantId)
      const events = await prisma.clinicalEvent.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });

      return events;
    } catch (error: any) {
      logger.error('Failed to get clinical events', { error: error.message });
      throw new Error('Failed to retrieve clinical events');
    }
  }

  async getExportBundle(filters: ExportFilters) {
    try {
      const where: any = {};

      if (filters.channel === 'WHATSAPP_CHAT') {
        where.callPurpose = 'WHATSAPP_CHAT';
      } else if (filters.channel === 'VOICE') {
        where.callPurpose = { not: 'WHATSAPP_CHAT' };
      }

      if (filters.outcome === 'IN_PROGRESS') {
        where.outcome = null;
      } else if (filters.outcome) {
        where.outcome = filters.outcome;
      }

      if (filters.condition) {
        where.patient = { condition: filters.condition };
      }

      if (filters.dateFrom || filters.dateTo) {
        where.startedAt = {};
        if (filters.dateFrom) where.startedAt.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.startedAt.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
      }

      if (filters.sessionIds && filters.sessionIds.length > 0) {
        // Accept either identifier. The admin Call Logs page surfaces (and its
        // copy button copies) messageSessionId, while the page's own "Download"
        // button and direct primary-key callers pass CallSession.id. Matching
        // only one silently returns nothing for the other -- for WhatsApp rows
        // the two are unrelated UUIDs.
        where.OR = [
          { id: { in: filters.sessionIds } },
          { messageSessionId: { in: filters.sessionIds } },
        ];
      }

      const sessions = await prisma.callSession.findMany({
        where,
        include: { patient: true },
      });

      if (sessions.length === 0) return [];

      const sessionIds = sessions.map((s) => s.id);
      const tenantId = sessions[0].tenantId;

      const [assessments, facts] = await Promise.all([
        prisma.assessment.findMany({
          where: { tenantId, sessionId: { in: sessionIds } },
          include: { flags: true },
        }),
        prisma.patientFact.findMany({
          where: { tenantId, sourceSessionId: { in: sessionIds } },
        }),
      ]);

      const kgIds = [...new Set(sessions.map((s) => s.knowledgeGraphId).filter((id): id is string => !!id))];
      const kgs = kgIds.length > 0
        ? await prisma.knowledgeGraph.findMany({
            where: { id: { in: kgIds } },
            select: { id: true, version: true, status: true },
          })
        : [];
      const kgById = new Map(kgs.map((kg) => [kg.id, kg]));

      const assessmentsBySession = new Map<string, typeof assessments>();
      for (const a of assessments) {
        const list = assessmentsBySession.get(a.sessionId) ?? [];
        list.push(a);
        assessmentsBySession.set(a.sessionId, list);
      }

      const factsBySession = new Map<string, typeof facts>();
      for (const f of facts) {
        if (!f.sourceSessionId) continue;
        const list = factsBySession.get(f.sourceSessionId) ?? [];
        list.push(f);
        factsBySession.set(f.sourceSessionId, list);
      }

      const transcripts = await Promise.all(
        sessions.map(async (session) => {
          try {
            const result = await conversationsService.getTranscript(
              session.tenantId,
              session.messageSessionId ?? session.id,
            );
            return result.formattedTranscript;
          } catch (error: any) {
            logger.error('Failed to get transcript for export', { error: error.message, sessionId: session.id });
            return null;
          }
        }),
      );
      const transcriptBySession = new Map(sessions.map((s, i) => [s.id, transcripts[i]]));

      return sessions.map((session) => {
        const kg = session.knowledgeGraphId ? kgById.get(session.knowledgeGraphId) : undefined;
        return {
          ...session,
          patient: {
            phoneNumber: session.patient.phoneNumber,
            name: session.patient.encryptedName ? decrypt(session.patient.encryptedName) : '',
            condition: session.patient.condition,
            classification: session.patient.classification,
            conditionStartDate: session.patient.conditionStartDate,
          },
          formattedTranscript: transcriptBySession.get(session.id) ?? null,
          assessments: (assessmentsBySession.get(session.id) ?? []).map((a) => ({
            id: a.id,
            outcome: a.outcome,
            patientAction: a.patientAction,
            escalationType: a.escalationType,
            deterministic: a.deterministic,
            createdAt: a.createdAt,
            flags: a.flags.map((f) => ({
              id: f.id,
              redFlagId: f.redFlagId,
              decidedBy: f.decidedBy,
              fired: f.fired,
              evidence: f.evidence,
              rulesTried: f.rulesTried,
              createdAt: f.createdAt,
            })),
          })),
          patientFacts: (factsBySession.get(session.id) ?? []).map((f) => ({
            id: f.id,
            factId: f.factId,
            value: f.valueNumber ?? f.valueBoolean ?? f.valueString ?? null,
            extractionClass: f.extractionClass,
            observedAt: f.observedAt,
            timeUncertaintyHours: f.timeUncertaintyHours,
            recordedAt: f.recordedAt,
            confidence: f.confidence,
          })),
          knowledgeGraph: kg ? { version: kg.version, status: kg.status } : null,
        };
      });
    } catch (error: any) {
      logger.error('Failed to build call logs export bundle', { error: error.message, stack: error.stack });
      throw new Error('Failed to build export bundle');
    }
  }
}

export const callLogsService = new CallLogsService();
