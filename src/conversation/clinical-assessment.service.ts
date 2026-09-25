/**
 * Clinical Assessment Service
 * Manages symptom assessment flow based on knowledge graph
 */

import { prisma } from '../core/database';
import { logger } from '../core/logger';
import { ClinicalContext } from '../knowledge-graph/context-loader';

interface AssessmentResult {
  symptomName: string;
  symptomId: string;
  outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE';
  riskScore: number;
  reasoning: string;
  questionsAsked?: number;
  escalationReason?: string;
}

export class ClinicalAssessmentService {
  /**
   * Record a symptom reported by the patient
   */
  async recordSymptomReported(
    sessionId: string,
    patientId: string,
    symptomName: string,
    symptomId: string,
    baseSeverity: string,
    tenantId: string
  ) {
    try {
      await prisma.clinicalEvent.create({
        data: {
          tenantId: tenantId,
          sessionId,
          patientId,
          eventType: 'SYMPTOM_REPORTED',
          eventData: {
            symptomName,
            symptomId,
            severity: baseSeverity.toUpperCase(),
            timestamp: new Date().toISOString(),
          },
          riskScore: baseSeverity.toUpperCase(),
          requiresEscalation: false,
          createdAt: new Date(),
        },
      });

      logger.info('Symptom reported event created', {
        sessionId,
        symptomName,
        severity: baseSeverity,
      });
    } catch (error: any) {
      logger.error('Failed to record symptom reported', { error: error.message });
      throw error;
    }
  }

  /**
   * Record a symptom assessment outcome
   */
  async recordAssessmentOutcome(
    sessionId: string,
    patientId: string,
    result: AssessmentResult,
    tenantId: string
  ) {
    try {
      const requiresEscalation = result.outcome === 'ESCALATE';

      await prisma.clinicalEvent.create({
        data: {
          tenantId: tenantId,
          sessionId,
          patientId,
          eventType: 'SYMPTOM_ASSESSMENT',
          eventData: {
            symptomName: result.symptomName,
            symptomId: result.symptomId,
            outcome: result.outcome,
            riskScore: result.riskScore,
            reasoning: result.reasoning,
            questionsAsked: result.questionsAsked || 0,
            escalationReason: result.escalationReason,
            assessedAt: new Date().toISOString(),
          },
          riskScore: this.mapRiskScore(result.riskScore),
          requiresEscalation,
          createdAt: new Date(),
        },
      });

      // Update session outcome if escalation required
      if (requiresEscalation) {
        await prisma.callSession.update({
          where: { id: sessionId },
          data: {
            outcome: 'ESCALATE',
            state: 'ESCALATING',
          },
        });
      }

      logger.info('Assessment outcome recorded', {
        sessionId,
        symptom: result.symptomName,
        outcome: result.outcome,
        riskScore: result.riskScore,
      });
    } catch (error: any) {
      logger.error('Failed to record assessment outcome', { error: error.message });
      throw error;
    }
  }

  /**
   * Record a red flag event
   */
  async recordRedFlag(
    sessionId: string,
    patientId: string,
    trigger: string,
    symptomId: string | null,
    action: string,
    urgency: string,
    rationale: string,
    tenantId: string
  ) {
    try {
      await prisma.clinicalEvent.create({
        data: {
          tenantId: tenantId,
          sessionId,
          patientId,
          eventType: 'RED_FLAG',
          eventData: {
            trigger,
            symptomId,
            action,
            urgency,
            rationale,
            detectedAt: new Date().toISOString(),
          },
          riskScore: 'CRITICAL',
          requiresEscalation: true,
          createdAt: new Date(),
        },
      });

      // Update session to escalating state
      await prisma.callSession.update({
        where: { id: sessionId },
        data: {
          outcome: 'ESCALATE',
          state: 'ESCALATING',
        },
      });

      logger.warn('Red flag detected', {
        sessionId,
        trigger,
        urgency,
      });
    } catch (error: any) {
      logger.error('Failed to record red flag', { error: error.message });
      throw error;
    }
  }

  /**
   * @deprecated Use TranscriptAssessmentService instead.
   * This method requires structured KG branch responses that are not available
   * in free-text channels. It is retained for potential future structured-input use.
   */
  async assessSymptom(
    sessionId: string,
    patientId: string,
    symptomName: string,
    patientResponses: any[],
    clinicalContext: ClinicalContext
  ): Promise<AssessmentResult> {
    try {
      // Find the symptom in the knowledge graph
      const symptom = this.findSymptomByName(clinicalContext, symptomName);

      if (!symptom) {
        // If symptom not in knowledge graph, default assessment
        return {
          symptomName,
          symptomId: 'UNKNOWN',
          outcome: 'ADVISE',
          riskScore: 1,
          reasoning: 'Symptom not defined in clinical protocol. General advice provided.',
        };
      }

      // Check phase override
      const phaseOverride = this.checkPhaseOverride(
        symptom,
        clinicalContext.patientContext.currentPhase
      );

      if (phaseOverride) {
        return {
          symptomName,
          symptomId: symptom.id,
          outcome: phaseOverride.outcome,
          riskScore: 0,
          reasoning: phaseOverride.reasoning,
        };
      }

      // Calculate risk score based on questions and responses.
      // Use snake_case property name from KG (severity_score, not severityScore).
      let riskScore = (symptom as any).severity_score ?? symptom.severityScore ?? 0;
      let questionsAsked = 0;
      let escalate = false;

      // Simulate assessment question flow
      // In real implementation, this would track actual patient responses
      for (const response of patientResponses) {
        if (response.escalate) {
          escalate = true;
          break;
        }
        riskScore += response.riskShift || 0;
        questionsAsked++;
      }

      // Determine outcome based on score thresholds.
      // When escalate=true the loop broke early — ensure the score reflects the
      // ESCALATE threshold (≥3) so the displayed Risk Score is meaningful.
      let outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE';
      let reasoning: string;

      if (escalate || riskScore >= 3) {
        outcome = 'ESCALATE';
        if (escalate) riskScore = Math.max(riskScore, 3);
        reasoning = 'Red flag criteria met. Immediate medical attention recommended.';
      } else if (riskScore >= 1) {
        outcome = 'ADVISE';
        reasoning = 'Symptom requires monitoring and guidance. Follow-up recommended.';
      } else {
        outcome = 'REASSURE';
        reasoning = 'Symptom expected at this recovery phase. Normal progression.';
      }

      return {
        symptomName,
        symptomId: symptom.id,
        outcome,
        riskScore,
        reasoning,
        questionsAsked,
        escalationReason: escalate ? 'Red flag triggered during assessment' : undefined,
      };
    } catch (error: any) {
      logger.error('Failed to assess symptom', { error: error.message });
      throw error;
    }
  }

  /**
   * Find symptom in clinical context by name
   */
  private findSymptomByName(clinicalContext: ClinicalContext, symptomName: string): any {
    const symptoms = clinicalContext.symptoms;

    // Try exact match first
    for (const [symptomId, symptom] of Object.entries(symptoms)) {
      if (symptom.name.toLowerCase() === symptomName.toLowerCase()) {
        return { ...symptom, id: symptomId };
      }
    }

    // Try partial match
    for (const [symptomId, symptom] of Object.entries(symptoms)) {
      if (
        symptom.name.toLowerCase().includes(symptomName.toLowerCase()) ||
        symptomName.toLowerCase().includes(symptom.name.toLowerCase())
      ) {
        return { ...symptom, id: symptomId };
      }
    }

    return null;
  }

  /**
   * Check if there's a phase-specific override for this symptom
   */
  private checkPhaseOverride(symptom: any, currentPhase: string): { outcome: 'REASSURE' | 'ADVISE' | 'ESCALATE'; reasoning: string } | null {
    if (!symptom.phase_override) return null;

    const override = symptom.phase_override;

    // Typed object form: { [phaseKey: string]: PhaseOverride }
    if (typeof override === 'object' && !Array.isArray(override)) {
      const matchedKey = Object.keys(override).find(
        (k) => k.toLowerCase() === currentPhase.toLowerCase()
      );
      if (!matchedKey) return null;
      const entry = override[matchedKey] as { action: string; note: string };
      const action = entry.action.toUpperCase();
      if (action === 'ESCALATE') return { outcome: 'ESCALATE' as const, reasoning: entry.note };
      if (action === 'ADVISE')   return { outcome: 'ADVISE'   as const, reasoning: entry.note };
      if (action === 'REASSURE') return { outcome: 'REASSURE' as const, reasoning: entry.note };
      logger.warn('checkPhaseOverride: unrecognized action value', { action: entry.action, phaseKey: matchedKey });
      return null;
    }

    // Legacy string form: "Phase I: REASSURE\nPhase III: ESCALATE"
    if (typeof override === 'string') {
      const lines = override.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes(currentPhase.toLowerCase())) {
          if (line.includes('ESCALATE')) {
            return {
              outcome: 'ESCALATE' as const,
              reasoning: 'Phase-specific red flag detected',
            };
          } else if (line.includes('REASSURE')) {
            return {
              outcome: 'REASSURE' as const,
              reasoning: 'Expected symptom for current recovery phase',
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Map numeric risk score to string category
   */
  private mapRiskScore(score: number): string {
    if (score >= 3) return 'CRITICAL';
    if (score >= 2) return 'HIGH';
    if (score >= 1) return 'MEDIUM';
    return 'LOW';
  }
}

export const clinicalAssessmentService = new ClinicalAssessmentService();
