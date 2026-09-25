import { Prisma, PrismaClient } from '@prisma/client';

export interface AssessmentFlagInput {
  redFlagId: string;
  decidedBy: 'rule' | 'prose' | 'unevaluated';
  fired: boolean | null; // null when decidedBy === 'unevaluated'
  evidence: string | null; // call 3's evidence text; null for rule-decided flags
  rulesTried: unknown; // JSON-serializable -- the `skipped` array shape from RulePassResult (src/decision/types.ts), or [] if not applicable
}

export class AssessmentAuditRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Writes one Assessment row and one AssessmentFlag row per input, atomically.
   * tenantId/patientId/sessionId are always explicit, never inferred.
   */
  async persist(data: {
    tenantId: string;
    patientId: string;
    sessionId: string;
    outcome: string;
    patientAction: string | null;
    escalationType: string | null;
    deterministic: boolean;
    flags: AssessmentFlagInput[];
  }): Promise<{ assessmentId: string }> {
    const assessmentId = await this.prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          tenantId: data.tenantId,
          patientId: data.patientId,
          sessionId: data.sessionId,
          outcome: data.outcome,
          patientAction: data.patientAction,
          escalationType: data.escalationType,
          deterministic: data.deterministic,
        },
      });

      await tx.assessmentFlag.createMany({
        data: data.flags.map((flag) => ({
          tenantId: data.tenantId,
          patientId: data.patientId,
          sessionId: data.sessionId,
          assessmentId: assessment.id,
          redFlagId: flag.redFlagId,
          decidedBy: flag.decidedBy,
          fired: flag.fired,
          evidence: flag.evidence,
          rulesTried: flag.rulesTried as Prisma.InputJsonValue,
        })),
      });

      return assessment.id;
    });

    return { assessmentId };
  }
}
