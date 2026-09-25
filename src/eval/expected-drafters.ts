// src/eval/expected-drafters.ts
import { KnowledgeGraph, Symptom } from '../knowledge-graph/types';
import {
  GreetingExpected, TurnExpected, AssessmentExpected, FlagPath,
} from './dataset-types';

export function draftGreetingExpected(
  _kg: KnowledgeGraph,
): { expected: GreetingExpected; needs_review: false } {
  return {
    expected: {
      phase_acknowledged: true,
      condition_mentioned: true,
      warm_tone: true,
      opens_with_open_question: true,
    },
    needs_review: false,
  };
}

export function draftTurnExpected(
  flagPath: FlagPath,
  symptomsReported: string[],
): { expected: TurnExpected; needs_review: true } {
  return {
    expected: {
      topics_covered: flagPath === 'green' ? [] : symptomsReported,
      one_question_at_a_time: true,
      did_not_dismiss: true,
      acknowledged_symptoms: true,
    },
    needs_review: true,   // conversational content always needs human review
  };
}

export function draftAssessmentExpected(
  kg: KnowledgeGraph,
  classification: string,
  phaseKey: string,
  flagPath: FlagPath,
  symptomsReported: string[],
): { expected: AssessmentExpected; needs_review: boolean } {
  if (symptomsReported.length === 0) {
    return {
      expected: {
        outcome: 'REASSURE',
        patient_action: 'SELF_MONITOR',
        overall_risk_level: 'LOW',
        escalation_required: false,
      },
      needs_review: false,
    };
  }

  const OUTCOME_ORDER = ['REASSURE', 'ADVISE', 'ESCALATE'] as const;
  type Outcome = typeof OUTCOME_ORDER[number];

  let topOutcome: Outcome = 'REASSURE';
  let maxScore = 0;

  for (const name of symptomsReported) {
    const symptom = kg.symptoms[name];
    if (!symptom) continue;
    const score = symptom.severity_score;
    if (score > maxScore) maxScore = score;
    const outcome: Outcome = score >= 3 ? 'ESCALATE' : score >= 1 ? 'ADVISE' : 'REASSURE';
    if (OUTCOME_ORDER.indexOf(outcome) > OUTCOME_ORDER.indexOf(topOutcome)) topOutcome = outcome;
  }

  const overall_risk_level = mapRiskScore(maxScore);
  const patient_action: AssessmentExpected['patient_action'] =
    overall_risk_level === 'CRITICAL' ? 'ER_NOW'
    : overall_risk_level === 'HIGH'   ? 'FACILITY_TODAY'
    : overall_risk_level === 'MEDIUM' ? 'NURSE_CALLBACK'
    : 'SELF_MONITOR';

  return {
    expected: {
      outcome: topOutcome,
      patient_action,
      overall_risk_level,
      escalation_required: topOutcome === 'ESCALATE',
    },
    needs_review: false,
  };
}

export function selectSymptomForFlagPath(
  kg: KnowledgeGraph,
  classification: string,
  phaseKey: string,
  flagPath: FlagPath,
): string | null {
  if (flagPath === 'green') return null;

  const applicable = Object.values(kg.symptoms).filter((s: Symptom) => {
    const classOk =
      s.applicable_classifications.includes('ALL') ||
      s.applicable_classifications.includes(classification);
    const phaseOk =
      s.applicable_phases.includes('ALL') || s.applicable_phases.includes(phaseKey);
    return classOk && phaseOk;
  });

  if (flagPath === 'yellow') {
    const candidate = applicable
      .filter((s) => s.severity_score >= 1 && s.severity_score <= 2)
      .sort((a, b) => a.severity_score - b.severity_score)[0];
    return candidate?.name ?? null;
  }

  // red
  const candidate = applicable
    .filter((s) => s.severity_score >= 3)
    .sort((a, b) => b.severity_score - a.severity_score)[0];
  return candidate?.name ?? null;
}

function mapRiskScore(score: number): AssessmentExpected['overall_risk_level'] {
  if (score >= 3) return 'CRITICAL';
  if (score >= 2) return 'HIGH';
  if (score >= 1) return 'MEDIUM';
  return 'LOW';
}
