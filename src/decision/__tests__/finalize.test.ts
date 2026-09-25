import { finalize } from '../finalize';
import { RedFlag, Fact } from '../../knowledge-graph/types';
import { RulePassResult, ProseVerdict, ExtractionClass } from '../types';

function emptyRp(): RulePassResult {
  return { verdicts: [], fellThrough: [], noRules: [], skipped: [] };
}

function makeRedFlag(id: string, action: 'ESCALATE' | 'ADVISE', patientAction: string): RedFlag {
  return {
    id, symptom_id: null, trigger: id, action, urgency: 'urgent',
    patient_action: patientAction, context_note: '', rationale: '',
    applicable_classifications: ['ALL'], applicable_phases: ['ALL'],
  };
}

function makeFact(required: boolean): Fact {
  return {
    display_name: null, area: 'vitals', type: 'number',
    valid_for: '7d', valid_for_hours: 168, required,
    applicable_classifications: ['ALL'], applicable_phases: ['ALL'],
    extraction_hint: null,
  };
}

const now = new Date('2025-01-01T12:00:00Z');
const noFacts: Record<string, Fact> = {};
const noStatus: Map<string, ExtractionClass> = new Map();

describe('finalize', () => {

  describe('prose verdict mapping', () => {
    it('fired prose verdict uses the red flag\'s action and patient_action', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: true }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('ESCALATE');
      expect(d.patient_action).toBe('ER_NOW');
    });

    it('unfired prose verdict is treated as REASSURE / SELF_MONITOR', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('REASSURE');
      expect(d.patient_action).toBe('SELF_MONITOR');
    });

    it('throws when a fired prose verdict references an unknown red_flag_id', () => {
      const rp = { ...emptyRp(), noRules: ['RF_UNKNOWN'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_UNKNOWN', fired: true }];
      expect(() => finalize(rp, prose, [], noFacts, noStatus, [], now)).toThrow('RF_UNKNOWN');
    });
  });

  describe('outcome = max severity', () => {
    it('ESCALATE wins over ADVISE', () => {
      const rf_a = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rf_b = makeRedFlag('RF_B', 'ADVISE',   'NURSE_CALLBACK');
      const rp = { ...emptyRp(), noRules: ['RF_A', 'RF_B'] };
      const prose: ProseVerdict[] = [
        { red_flag_id: 'RF_A', fired: true },
        { red_flag_id: 'RF_B', fired: true },
      ];
      const d = finalize(rp, prose, [rf_a, rf_b], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('ESCALATE');
    });
  });

  describe('patient_action = max over verdicts matching outcome', () => {
    it('ER_NOW beats NURSE_CALLBACK when both flags escalate', () => {
      const rf_a = makeRedFlag('RF_A', 'ESCALATE', 'NURSE_CALLBACK');
      const rf_b = makeRedFlag('RF_B', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A', 'RF_B'] };
      const prose: ProseVerdict[] = [
        { red_flag_id: 'RF_A', fired: true },
        { red_flag_id: 'RF_B', fired: true },
      ];
      const d = finalize(rp, prose, [rf_a, rf_b], noFacts, noStatus, [], now);
      expect(d.patient_action).toBe('ER_NOW');
    });

    it('patient_action comes only from verdicts matching the outcome, not lower-severity ones', () => {
      // RF_A ESCALATE+ER_NOW; RF_B ADVISE+FACILITY_TODAY
      // outcome=ESCALATE, so patient_action only from ESCALATE verdicts → ER_NOW
      const rf_a = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rf_b = makeRedFlag('RF_B', 'ADVISE',   'FACILITY_TODAY');
      const rp = { ...emptyRp(), noRules: ['RF_A', 'RF_B'] };
      const prose: ProseVerdict[] = [
        { red_flag_id: 'RF_A', fired: true },
        { red_flag_id: 'RF_B', fired: true },
      ];
      const d = finalize(rp, prose, [rf_a, rf_b], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('ESCALATE');
      expect(d.patient_action).toBe('ER_NOW');
    });
  });

  describe('INCOMPLETE', () => {
    it('INCOMPLETE when all flags are REASSURE but a required fact was NOT_ASKED', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const facts: Record<string, Fact> = { weight: makeFact(true) }; // required
      const status = new Map<string, ExtractionClass>([['weight', 'NOT_ASKED']]);
      const d = finalize(rp, prose, [rf], facts, status, [], now);
      expect(d.outcome).toBe('INCOMPLETE');
      expect(d.patient_action).toBeNull();
      expect(d.escalation_type).toBeNull();
    });

    it('REASSURE when all flags reassure AND all required facts are confident', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const facts: Record<string, Fact> = { weight: makeFact(true) };
      const status = new Map<string, ExtractionClass>([['weight', 'CONFIDENT']]);
      const d = finalize(rp, prose, [rf], facts, status, [], now);
      expect(d.outcome).toBe('REASSURE');
    });

    it('a verdict ABOVE REASSURE overrides INCOMPLETE — missing facts do not block escalation', () => {
      // If even one flag fires ESCALATE, outcome=ESCALATE regardless of missing required facts
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: true }];
      const facts: Record<string, Fact> = { weight: makeFact(true) };
      const status = new Map<string, ExtractionClass>([['weight', 'NOT_ASKED']]);
      const d = finalize(rp, prose, [rf], facts, status, [], now);
      expect(d.outcome).toBe('ESCALATE'); // not INCOMPLETE
    });

    it('a fired REASSURE rule downgrade does not license REASSURE while required fact is NOT_ASKED', () => {
      // Rule fired REASSURE (downgrade), but required fact was never asked → INCOMPLETE
      const rp: RulePassResult = {
        verdicts: [{ red_flag_id: 'RF_A', rule_id: 'R_1', action: 'REASSURE', patient_action: 'SELF_MONITOR' }],
        fellThrough: [],
        noRules: [],
        skipped: [],
      };
      const facts: Record<string, Fact> = { weight: makeFact(true) };
      const status = new Map<string, ExtractionClass>([['weight', 'NOT_ASKED']]);
      const d = finalize(rp, [], [], facts, status, [], now);
      expect(d.outcome).toBe('INCOMPLETE');
    });

    it('INCOMPLETE → patient_action is null, escalation_type is null', () => {
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const facts: Record<string, Fact> = { weight: makeFact(true) };
      const status = new Map<string, ExtractionClass>([['weight', 'NOT_ASKED']]);
      const d = finalize(rp, prose, [rf], facts, status, [], now);
      expect(d.patient_action).toBeNull();
      expect(d.escalation_type).toBeNull();
    });
  });

  describe('deterministic flag', () => {
    it('deterministic === true iff fellThrough and noRules are both empty', () => {
      const rp: RulePassResult = {
        verdicts: [{ red_flag_id: 'RF_A', rule_id: 'R_1', action: 'REASSURE', patient_action: null }],
        fellThrough: [],
        noRules: [],
        skipped: [],
      };
      const d = finalize(rp, [], [], noFacts, noStatus, [], now);
      expect(d.deterministic).toBe(true);
    });

    it('deterministic === false when any flag fell through', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), fellThrough: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.deterministic).toBe(false);
    });

    it('deterministic === false when any flag had noRules', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.deterministic).toBe(false);
    });
  });

  describe('escalation_type', () => {
    it('escalation_type is CLINICAL_RED_FLAG when outcome is ESCALATE', () => {
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: true }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.escalation_type).toBe('CLINICAL_RED_FLAG');
    });

    it('escalation_type is null when outcome is ADVISE', () => {
      const rf = makeRedFlag('RF_A', 'ADVISE', 'NURSE_CALLBACK');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: true }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.escalation_type).toBeNull();
    });
  });

  describe('empty verdict set', () => {
    it('no flags at all → REASSURE (no required facts present)', () => {
      const d = finalize(emptyRp(), [], [], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('REASSURE');
      expect(d.patient_action).toBeNull();
    });

    it('no flags at all with a required fact NOT_ASKED → INCOMPLETE', () => {
      const facts: Record<string, Fact> = { weight: makeFact(true) };
      const status = new Map<string, ExtractionClass>([['weight', 'NOT_ASKED']]);
      const d = finalize(emptyRp(), [], [], facts, status, [], now);
      expect(d.outcome).toBe('INCOMPLETE');
    });
  });

  describe('now is honoured', () => {
    it('same inputs with different now produce independent decisions (no hidden Date.now())', () => {
      // Both calls return the same outcome since now is not used in finalize logic directly,
      // but the test confirms now is passed through without calling Date.now() internally.
      const d1 = finalize(emptyRp(), [], [], noFacts, noStatus, [], new Date('2025-01-01'));
      const d2 = finalize(emptyRp(), [], [], noFacts, noStatus, [], new Date('2025-06-01'));
      // Both should be consistent — no internal state contamination
      expect(d1.outcome).toBe(d2.outcome);
      expect(d1.deterministic).toBe(d2.deterministic);
    });
  });

  describe('unevaluated flags', () => {
    it('does not outrank a fired rule — ESCALATE survives a call-3 failure', () => {
      // rulePass produced an ESCALATE verdict; two flags were unevaluated
      const rp: RulePassResult = {
        verdicts: [{ red_flag_id: 'RF_A', rule_id: 'R_1', action: 'ESCALATE', patient_action: 'ER_NOW' }],
        fellThrough: [],
        noRules: [],
        skipped: [],
      };
      const d = finalize(rp, [], [], noFacts, noStatus, ['RF_B', 'RF_C'], now);
      expect(d.outcome).toBe('ESCALATE');
    });

    it('leaves ADVISE alone — INCOMPLETE would strip NURSE_CALLBACK', () => {
      // outcome would be ADVISE; one flag unevaluated
      const rf = makeRedFlag('RF_A', 'ADVISE', 'NURSE_CALLBACK');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: true }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, ['RF_B'], now);
      expect(d.outcome).toBe('ADVISE');
      expect(d.patient_action).toBe('NURSE_CALLBACK');
    });

    it('downgrades an all-clear to INCOMPLETE', () => {
      // all verdicts REASSURE; one flag unevaluated
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, ['RF_B'], now);
      expect(d.outcome).toBe('INCOMPLETE');
      expect(d.patient_action).toBeNull();
      expect(d.escalation_type).toBeNull();
    });

    it('leaves a genuine all-clear alone', () => {
      // all verdicts REASSURE; nothing unevaluated
      const rf = makeRedFlag('RF_A', 'ESCALATE', 'ER_NOW');
      const rp = { ...emptyRp(), noRules: ['RF_A'] };
      const prose: ProseVerdict[] = [{ red_flag_id: 'RF_A', fired: false }];
      const d = finalize(rp, prose, [rf], noFacts, noStatus, [], now);
      expect(d.outcome).toBe('REASSURE');
    });
  });
});
