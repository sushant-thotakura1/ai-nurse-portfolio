// src/screening/service.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../core/database';
import { getTenantContext } from '../core/tenant-context-storage';
import { encrypt } from '../core/encryption';
import { checkStopRules, computeRecommendation, visibleQuestions } from './engine';
import { ScreeningSchema, Answers } from './types';
import { vaccinationSchema } from './schemas/vaccination.schema';

export type FilledBy = 'patient' | 'family_lar' | 'hcw';

/** A single currently-visible question, with the `showIf` predicate stripped. */
export interface ScreeningStateQuestion {
  id: string;
  prompt: string;
  type: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
}

export interface ScreeningStateStep {
  id: string;
  title: string;
  /** 0-based position in schema.steps. */
  index: number;
  /** Only the questions visible given the current answers. */
  questions: ScreeningStateQuestion[];
}

/** JSON-serializable wizard snapshot the frontend renders the multi-step form from. */
export interface ScreeningState {
  id: string;
  status: string;
  totalSteps: number;
  steps: ScreeningStateStep[];
  answers: Record<string, unknown>;
  recommendation: unknown | null;
  stopOutcome: unknown | null;
}

/**
 * Question ids that are PII and must be routed to their own encrypted
 * column instead of the plaintext `answers` blob — mirrors Patient's
 * encryptedName/encryptedDob precedent. Anything not in this map is
 * clinical/non-identifying (e.g. age, conditions) and stays in `answers`,
 * which is what the rule engine reads from.
 */
const PII_FIELD_MAP: Record<
  string,
  'encryptedName' | 'encryptedPhone' | 'encryptedExternalId' | 'encryptedAbhaId'
> = {
  name: 'encryptedName',
  phone: 'encryptedPhone',
  external_id: 'encryptedExternalId',
  abha_id: 'encryptedAbhaId',
};

export class ScreeningService {
  constructor(private readonly schema: ScreeningSchema) {}

  async start(filledBy: FilledBy) {
    const tenantContext = getTenantContext();
    if (!tenantContext) {
      throw new Error('No tenant context — screening requires a tenant-scoped request');
    }
    return prisma.screeningRecord.create({
      data: {
        tenantId: tenantContext.tenantId,
        schemaId: this.schema.id,
        schemaVersion: this.schema.version,
        filledBy,
        answers: {},
        status: 'in_progress',
      },
    });
  }

  async submitAnswer(recordId: string, questionId: string, value: Answers[string]) {
    const record = await prisma.screeningRecord.findFirst({ where: { id: recordId } });
    if (!record) {
      throw new Error(`Screening record not found: ${recordId}`);
    }

    // PII answers never touch the plaintext `answers` JSON — encrypt straight
    // into their dedicated column and return early.
    const piiColumn = PII_FIELD_MAP[questionId];
    if (piiColumn) {
      return prisma.screeningRecord.update({
        where: { id: recordId },
        data: { [piiColumn]: encrypt(String(value)) },
      });
    }

    const answers: Answers = { ...(record.answers as Answers), [questionId]: value };
    const stop = checkStopRules(this.schema, answers);

    if (stop) {
      return prisma.screeningRecord.update({
        where: { id: recordId },
        data: { answers, status: 'completed', stopOutcome: stop as unknown as Prisma.InputJsonValue },
      });
    }

    return prisma.screeningRecord.update({
      where: { id: recordId },
      data: { answers },
    });
  }

  /**
   * Returns a full snapshot of the screening — every step with its
   * currently-visible questions (given the answers so far), plus the stored
   * answers, recommendation and stop outcome — so a web wizard can render the
   * whole multi-step questionnaire. Never emits PII (those answers live in
   * encrypted columns, not `answers`) and strips each question's `showIf`.
   */
  async getState(recordId: string): Promise<ScreeningState> {
    const record = await prisma.screeningRecord.findFirst({ where: { id: recordId } });
    if (!record) {
      throw new Error(`Screening record not found: ${recordId}`);
    }

    const answers = (record.answers ?? {}) as Answers;
    const steps: ScreeningStateStep[] = this.schema.steps.map((step, index) => ({
      id: step.id,
      title: step.title,
      index,
      questions: visibleQuestions(step, answers).map((q) => {
        const dto: ScreeningStateQuestion = { id: q.id, prompt: q.prompt, type: q.type };
        if (q.options !== undefined) {
          dto.options = q.options;
        }
        if (q.optional) {
          dto.optional = true;
        }
        return dto;
      }),
    }));

    return {
      id: record.id,
      status: record.status,
      totalSteps: this.schema.steps.length,
      steps,
      answers: (record.answers ?? {}) as Record<string, unknown>,
      recommendation: record.recommendation ?? null,
      stopOutcome: record.stopOutcome ?? null,
    };
  }

  async complete(recordId: string) {
    const record = await prisma.screeningRecord.findFirst({ where: { id: recordId } });
    if (!record) {
      throw new Error(`Screening record not found: ${recordId}`);
    }
    const recommendation = computeRecommendation(this.schema, record.answers as Answers);
    return prisma.screeningRecord.update({
      where: { id: recordId },
      data: { status: 'completed', recommendation: recommendation as unknown as Prisma.InputJsonValue },
    });
  }
}

export const screeningService = new ScreeningService(vaccinationSchema);
