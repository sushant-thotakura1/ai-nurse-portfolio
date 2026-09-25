import { RedFlag, Fact, PatientAction, RuleAction } from '../knowledge-graph/types';
import { RulePassResult, ProseVerdict, Decision, ExtractionClass } from './types';

const SEVERITY: Record<string, number> = { REASSURE: 0, ADVISE: 1, ESCALATE: 2 };
const PA_RANK: Record<string, number> = {
  ER_NOW: 0, FACILITY_TODAY: 1, NURSE_CALLBACK: 2, SELF_MONITOR: 3,
};

function maxPatientAction(actions: Array<PatientAction | null>): PatientAction | null {
  let best: PatientAction | null = null;
  for (const a of actions) {
    if (a === null) continue;
    if (best === null || PA_RANK[a] < PA_RANK[best]) best = a;
  }
  return best;
}

interface FlagResult {
  action: RuleAction;
  patient_action: PatientAction | null;
}

export function finalize(
  rp: RulePassResult,
  proseVerdicts: ProseVerdict[],
  redFlags: RedFlag[],
  applicableFacts: Record<string, Fact>,
  factStatus: Map<string, ExtractionClass>,
  unevaluated: string[],
  now: Date,         // accepted for purity contract — pass-through
): Decision {
  void now;          // pure: no Date.now() calls

  // Build per-flag results
  const flagResults: FlagResult[] = [];

  // Rule verdicts
  for (const v of rp.verdicts) {
    flagResults.push({ action: v.action, patient_action: v.patient_action });
  }

  // Prose verdicts
  const rfById = new Map(redFlags.map(rf => [rf.id, rf]));
  for (const pv of proseVerdicts) {
    if (pv.fired) {
      const rf = rfById.get(pv.red_flag_id);
      if (!rf) {
        throw new Error(`fired ProseVerdict references unknown red_flag_id: ${pv.red_flag_id}`);
      }
      flagResults.push({
        action: rf.action as RuleAction,
        patient_action: (rf.patient_action ?? null) as PatientAction | null,
      });
    } else {
      flagResults.push({ action: 'REASSURE', patient_action: 'SELF_MONITOR' });
    }
  }

  // Max severity
  let maxSev = 0;
  for (const fr of flagResults) {
    const sev = SEVERITY[fr.action] ?? 0;
    if (sev > maxSev) maxSev = sev;
  }

  const outcomeAction = (['REASSURE', 'ADVISE', 'ESCALATE'] as const)[maxSev];

  // patient_action: max over verdicts matching the outcome severity
  const matchingPa = flagResults
    .filter(fr => fr.action === outcomeAction)
    .map(fr => fr.patient_action);
  const patient_action = maxPatientAction(matchingPa);

  // deterministic: no prose fall-through
  const deterministic = rp.fellThrough.length === 0 && rp.noRules.length === 0;

  // INCOMPLETE check — only when outcome would be REASSURE
  let outcome: Decision['outcome'] = outcomeAction;
  let finalPatientAction = patient_action;
  let escalation_type: 'CLINICAL_RED_FLAG' | null = null;

  if (outcome === 'ESCALATE') {
    escalation_type = 'CLINICAL_RED_FLAG';
  }

  if (outcome === 'REASSURE') {
    // Check if any required fact was NOT_ASKED
    const anyMissing = Object.entries(applicableFacts).some(([machineName, fact]) => {
      if (!fact.required) return false;
      const status = factStatus.get(machineName);
      return status === 'NOT_ASKED' || status === undefined;
    });
    if (anyMissing || unevaluated.length > 0) {
      outcome = 'INCOMPLETE';
      finalPatientAction = null;
      escalation_type = null;
    }
  }

  return {
    outcome,
    patient_action: finalPatientAction,
    escalation_type,
    deterministic,
    verdicts: rp.verdicts,
    proseVerdicts,
  };
}
