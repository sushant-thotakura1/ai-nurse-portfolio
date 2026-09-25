import { PrismaClient } from '@prisma/client';
import { LLMProvider } from '../interfaces';
import { Turn } from '../../orchestrator/session';
import { KnowledgeGraph, RedFlag, RuleAction, PatientAction } from '../../knowledge-graph/types';
import { Decision, ExtractionClass, FactResolver } from '../../decision/types';
import { rulePass, isApplicable } from '../../decision/rule-pass';
import { finalize } from '../../decision/finalize';
import { inMemoryFactResolver } from '../../decision/in-memory-fact-resolver';
import { FactRow, PatientFactRepository } from '../../decision/patient-fact.repository';
import { FactExtractor } from '../../perception/fact-extractor';
import { redFlagCheck, RedFlagCheckInput } from './red-flag-check';
import { RedFlagValidationResult } from './red-flag-check.types';
import { AssessmentAuditRepository, AssessmentFlagInput } from './assessment-audit.repository';
import { AssessmentOutput } from '../../eval/types';

export type { AssessmentOutput };

/** Real patient/session identity. Persistence (PatientFact writes, audit rows)
 * only happens when this is supplied -- absent for eval replay, which has no
 * real tenant/patient to write against. */
export interface AssessmentIdentity {
  tenantId: string;
  patientId: string;
  sessionId: string;
}

/** Retained only for backward compatibility with existing callers/summaries
 * that still read a flat event list -- the new engine doesn't produce
 * ClinicalEvent-shaped events at all, so this is always empty now. */
export interface ScoredEvent {
  eventType: string;
  eventData: Record<string, any>;
  riskScore: string;
  requiresEscalation: boolean;
}

export interface TranscriptAssessmentResult {
  assessment: AssessmentOutput;
  scoredEvents: ScoredEvent[];
}

const DEFAULT_TIME_UNCERTAINTY_TOLERANCE = 0.25;

/**
 * Decision -> AssessmentOutput mapping. Written down explicitly per the plan
 * (do not improvise this inline) since AssessmentOutput predates the engine
 * and several of its fields have no direct source in Decision.
 *
 *  - outcome, patient_action, deterministic: direct passthrough -- identical
 *    vocabularies (verified against src/decision/types.ts and src/eval/types.ts).
 *  - escalation_required: outcome === 'ESCALATE', matching the old path exactly.
 *  - overall_risk_level: has NO source in Decision. Derived from outcome, with
 *    ESCALATE split by patient_action (ER_NOW -> CRITICAL, else HIGH) mirroring
 *    the old path's reverse mapping. INCOMPLETE has no natural risk level --
 *    "we don't know" is neither a clean-bill-of-health LOW nor an escalation-
 *    grade HIGH/CRITICAL, so it maps to MEDIUM (uncertain, worth a look) as a
 *    considered default, not a derivation.
 *  - symptoms: has NO source in Decision either -- the engine produces red-flag
 *    verdicts, not scored symptoms. Verified src/eval/evaluators.ts's
 *    assessmentEvaluator only reads outcome/patient_action/overall_risk_level/
 *    escalation_required -- symptoms is not consumed by eval scoring today, so
 *    this is not the "lossy conversion the eval path consumes" the plan warns
 *    against. Populated on a best-effort basis: one entry per flag that
 *    actually fired (rule action != REASSURE, or a prose verdict with
 *    fired=true) -- REASSURE-equivalent and unevaluated flags are not
 *    "symptoms" in the old sense. severity/risk/flag derived from the firing
 *    red flag's action/patient_action the same way overall_risk_level is.
 *    `name` is the red flag's Sheet 4 trigger prose (no shorter label exists
 *    on RedFlag) rather than the bare red_flag_id -- a nurse/patient reading
 *    this summary shouldn't have to decode "RF_HF_002". `decidedBy` records
 *    whether a rule or call 3 made the call, so callers (e.g. the WhatsApp
 *    summary) can name specifically which findings were AI judgment calls
 *    rather than a single opaque "some findings" disclaimer.
 *  - escalation_reason: best-effort -- the trigger prose of the
 *    highest-severity fired flag.
 */
function mapDecisionToAssessmentOutput(
  decision: Decision,
  redFlagsById: Map<string, RedFlag>,
): AssessmentOutput {
  const overall_risk_level = riskLevelForOutcome(decision.outcome, decision.patient_action);

  const firedRuleFlags = decision.verdicts.filter((v) => v.action !== 'REASSURE');
  const firedProseFlags = decision.proseVerdicts.filter((pv) => pv.fired);

  // Track the real red_flag_id alongside each entry -- `symptoms[].name` is
  // now display prose, not an id, so escalation_reason's lookup below can't
  // key off it the way it used to.
  const tagged: Array<{ redFlagId: string; entry: AssessmentOutput['symptoms'][number] }> = [
    ...firedRuleFlags.map((v) => {
      const rf = redFlagsById.get(v.red_flag_id);
      return {
        redFlagId: v.red_flag_id,
        entry: symptomEntry(rf?.trigger ?? v.red_flag_id, v.action, v.patient_action, 'rule', rf?.symptom_id ?? null),
      };
    }),
    ...firedProseFlags.map((pv) => {
      const rf = redFlagsById.get(pv.red_flag_id);
      const action = (rf?.action as RuleAction | undefined) ?? 'ADVISE';
      const patientAction = (rf?.patient_action as PatientAction | undefined) ?? null;
      return {
        redFlagId: pv.red_flag_id,
        entry: symptomEntry(rf?.trigger ?? pv.red_flag_id, action, patientAction, 'prose', rf?.symptom_id ?? null),
      };
    }),
  ];

  const symptoms = tagged.map((t) => t.entry);

  const highestSeverity = tagged.find((t) => t.entry.risk === 'CRITICAL')
    ?? tagged.find((t) => t.entry.risk === 'HIGH');
  const escalation_reason = decision.outcome === 'ESCALATE' && highestSeverity
    ? redFlagsById.get(highestSeverity.redFlagId)?.trigger
    : undefined;

  return {
    outcome: decision.outcome,
    patient_action: decision.patient_action,
    overall_risk_level,
    symptoms,
    escalation_reason,
    escalation_required: decision.outcome === 'ESCALATE',
    deterministic: decision.deterministic,
  };
}

function riskLevelForOutcome(
  outcome: Decision['outcome'],
  patientAction: PatientAction | null,
): AssessmentOutput['overall_risk_level'] {
  switch (outcome) {
    case 'REASSURE': return 'LOW';
    case 'ADVISE': return 'MEDIUM';
    case 'ESCALATE': return patientAction === 'ER_NOW' ? 'CRITICAL' : 'HIGH';
    case 'INCOMPLETE': return 'MEDIUM'; // considered default -- see mapDecisionToAssessmentOutput's doc comment
  }
}

function symptomEntry(
  displayName: string,
  action: RuleAction,
  patientAction: PatientAction | null,
  decidedBy: 'rule' | 'prose',
  symptomId: string | null,
): AssessmentOutput['symptoms'][number] {
  const risk = riskLevelForOutcome(action === 'ESCALATE' ? 'ESCALATE' : 'ADVISE', patientAction);
  const flag: 'green' | 'yellow' | 'red' = action === 'ESCALATE' ? 'red' : 'yellow';
  const severity: 'mild' | 'moderate' | 'severe' = action === 'ESCALATE' ? 'severe' : 'moderate';
  return { name: displayName, severity, risk, flag, decidedBy, symptomId };
}

export class TranscriptAssessmentService {
  // Undefined when no prisma is supplied at construction (e.g. eval replay,
  // which never persists) -- deliberately NOT defaulted to the shared
  // core/database singleton, since that constructs a real PrismaClient at
  // import time. Callers that need persistence (session-closing.service.ts)
  // already receive a live prisma client from their own caller and pass it
  // through explicitly.
  private auditRepo?: AssessmentAuditRepository;
  private factRepo?: PatientFactRepository;

  constructor(
    private llm: LLMProvider,
    prisma?: PrismaClient,
    private redFlagCheckFn: (input: RedFlagCheckInput, llm: LLMProvider) => Promise<RedFlagValidationResult> = redFlagCheck,
  ) {
    if (prisma) {
      this.auditRepo = new AssessmentAuditRepository(prisma);
      this.factRepo = new PatientFactRepository(prisma);
    }
  }

  /**
   * rulePass -> call 3 -> finalize (spec §1). kg/classification/phase/
   * daysSinceTrigger are the inputs the engine needs -- the old signature
   * accepted these (underscore-prefixed) and discarded all of them.
   *
   * identity is optional: when supplied (the production path, via
   * session-closing.service.ts), extracted facts are persisted to Postgres
   * and an audit row is written per evaluated flag. When absent (eval
   * replay, via eval/callables.ts), nothing is persisted and fact
   * resolution is scoped to this transcript alone -- there is no real
   * patient to have cross-session history for.
   */
  async assess(
    turns: Turn[],
    kg: KnowledgeGraph,
    classification: string,
    phase: string,
    daysSinceTrigger: number,
    now: Date = new Date(),
    identity?: AssessmentIdentity,
  ): Promise<TranscriptAssessmentResult> {
    if (identity && (!this.auditRepo || !this.factRepo)) {
      throw new Error(
        'TranscriptAssessmentService: identity was supplied but no PrismaClient was given at construction -- persistence is impossible.',
      );
    }

    const facts = kg.facts ?? {};
    const rules = kg.rules ?? [];
    const redFlags = kg.red_flags;
    const redFlagsById = new Map(redFlags.map((rf) => [rf.id, rf]));
    const tolerance = kg.settings?.time_uncertainty_tolerance ?? DEFAULT_TIME_UNCERTAINTY_TOLERANCE;

    // Call 2 -- KB-driven fact extraction, blind to Sheet 8.
    const extractor = new FactExtractor(this.llm);
    const extracted = await extractor.extract(facts, classification, phase, turns);

    const factStatus = new Map<string, ExtractionClass>();
    for (const ef of extracted) {
      factStatus.set(ef.machineName, ef.extractionClass);
    }

    const resolver = await this.buildResolver(facts, extracted, now, identity);

    // rulePass -- pure.
    const rp = rulePass(resolver, rules, classification, phase, now, tolerance);

    // Call 3 -- every red flag rulePass did NOT produce a verdict for.
    // Deliberately NOT [...rp.fellThrough, ...rp.noRules]: rulePass only ever
    // knows about a red_flag_id if it appears in `rules` at all (it groups
    // rules by red_flag_id, then reports fellThrough/noRules per group) --
    // a red flag with literally zero authored rules never becomes a member
    // of any of rulePass's three output arrays, so relying on fellThrough/
    // noRules alone would silently drop it from call 3 entirely. Diffing
    // against every flag rulePass DID decide (rp.verdicts) catches all three
    // cases (fell through, no applicable rules, no rules ever) uniformly.
    //
    // Also gate on the red flag's OWN applicable_phases/applicable_classifications
    // -- rulePass already excludes a rule that doesn't apply to this patient's
    // phase/classification (isApplicable), but that only stops the rule from
    // firing; without the same check here, a red flag scoped to e.g. a later
    // recovery phase (say, "recurrence after a period of stability") would
    // still be handed to call 3 and could fire on prose judgment for a patient
    // who was never in that phase to begin with.
    const ruleDecidedIds = new Set(rp.verdicts.map((v) => v.red_flag_id));
    const toCheck = redFlags.filter(
      (rf) => !ruleDecidedIds.has(rf.id) && isApplicable(rf, classification, phase),
    );

    const capturedFacts: Record<string, number | boolean | string> = {};
    for (const ef of extracted) {
      if (ef.value !== null) capturedFacts[ef.machineName] = ef.value;
    }
    const unresolvedFactNames = extracted.filter((ef) => ef.value === null).map((ef) => ef.machineName);

    // Short-circuit here rather than trusting every injected redFlagCheckFn
    // to implement the same "empty batch -> no call" behaviour the real
    // redFlagCheck does (Task 6) -- an eval-pinned or test double shouldn't
    // have to reimplement it to get this guarantee.
    const checkResult: RedFlagValidationResult = toCheck.length === 0
      ? { verdicts: [], evidence: new Map(), unevaluated: [] }
      : await this.redFlagCheckFn(
        {
          turns,
          facts: capturedFacts,
          unresolvedFactNames,
          daysSinceTrigger,
          currentPhase: phase,
          flags: toCheck,
        },
        this.llm,
      );

    // finalize -- pure.
    const rawDecision = finalize(
      rp,
      checkResult.verdicts,
      redFlags,
      facts,
      factStatus,
      checkResult.unevaluated,
      now,
    );

    // finalize()'s own `deterministic` is computed purely from
    // rp.fellThrough/rp.noRules (spec/Part 1b, already tested), which shares
    // the same blind spot as rulePass itself: a red flag with zero rules
    // ever authored contributes to neither array, so finalize would report
    // deterministic:true even when that flag was actually decided by prose.
    // toCheck (above) is the corrected "needed call 3" set, so recompute
    // here rather than patching finalize's already-tested contract.
    const decision: Decision = { ...rawDecision, deterministic: toCheck.length === 0 };

    if (identity) {
      await this.persistAudit(identity, decision, rp, checkResult);
    }

    const assessment = mapDecisionToAssessmentOutput(decision, redFlagsById);

    return { assessment, scoredEvents: [] };
  }

  /**
   * rulePass/finalize are pure and synchronous -- every fact must be fetched
   * up front. Session-scoped as of the 2026-09-17 fact-resolution change
   * (docs/superpowers/specs/2026-09-17-session-scoped-fact-resolution-design.md):
   * both branches resolve from this transcript's own extraction only, never
   * from prior PatientFact rows. Temporal rules (delta, persists, new_onset)
   * can no longer see cross-session history -- this matches the confirmed
   * "current session only" escalation boundary
   * (docs/specs/2026-08-24-text-conversation-fixes.md) that ClinicalTurnService
   * already honored; TranscriptAssessmentService previously did not.
   * With identity: newly extracted facts are still persisted (audit trail,
   * call-logs export), just never read back into this or a future
   * assessment's resolver. Without identity: nothing is persisted (eval
   * replay) -- unchanged from before.
   */
  private async buildResolver(
    facts: KnowledgeGraph['facts'],
    extracted: Awaited<ReturnType<FactExtractor['extract']>>,
    now: Date,
    identity?: AssessmentIdentity,
  ): Promise<FactResolver> {
    if (!identity) {
      const rows: FactRow[] = extracted
        .filter((ef) => ef.value !== null)
        .map((ef) => ({
          id: `${ef.machineName}-${ef.observedAt.getTime()}`,
          factId: ef.machineName,
          value: ef.value,
          observedAt: ef.observedAt,
          timeUncertaintyHours: ef.timeUncertaintyHours,
          extractionClass: ef.extractionClass,
        }));
      return inMemoryFactResolver(rows, facts ?? {}, now);
    }

    const savedRows: FactRow[] = [];
    for (const ef of extracted) {
      if (ef.value === null) continue; // NOT_ASKED / NO_ANSWER -- nothing to store
      // Non-null: assess() throws before calling this method if identity is
      // supplied without factRepo/auditRepo having been constructed.
      savedRows.push(await this.factRepo!.save({
        tenantId: identity.tenantId,
        patientId: identity.patientId,
        factId: ef.machineName,
        valueNumber: typeof ef.value === 'number' ? ef.value : undefined,
        valueBoolean: typeof ef.value === 'boolean' ? ef.value : undefined,
        valueString: typeof ef.value === 'string' ? ef.value : undefined,
        observedAt: ef.observedAt,
        timeUncertaintyHours: ef.timeUncertaintyHours,
        sourceSessionId: identity.sessionId,
        extractionClass: ef.extractionClass,
      }));
    }

    return inMemoryFactResolver(savedRows, facts ?? {}, now);
  }

  private async persistAudit(
    identity: AssessmentIdentity,
    decision: Decision,
    rp: ReturnType<typeof rulePass>,
    checkResult: RedFlagValidationResult,
  ): Promise<void> {
    const skippedByFlag = new Map<string, typeof rp.skipped>();
    for (const s of rp.skipped) {
      const list = skippedByFlag.get(s.red_flag_id) ?? [];
      list.push(s);
      skippedByFlag.set(s.red_flag_id, list);
    }

    const flags: AssessmentFlagInput[] = [
      ...rp.verdicts.map((v): AssessmentFlagInput => ({
        redFlagId: v.red_flag_id,
        decidedBy: 'rule',
        fired: v.action !== 'REASSURE',
        evidence: null,
        rulesTried: skippedByFlag.get(v.red_flag_id) ?? [],
      })),
      ...checkResult.verdicts.map((pv): AssessmentFlagInput => ({
        redFlagId: pv.red_flag_id,
        decidedBy: 'prose',
        fired: pv.fired,
        evidence: checkResult.evidence.get(pv.red_flag_id) ?? null,
        rulesTried: skippedByFlag.get(pv.red_flag_id) ?? [],
      })),
      ...checkResult.unevaluated.map((id): AssessmentFlagInput => ({
        redFlagId: id,
        decidedBy: 'unevaluated',
        fired: null,
        evidence: null,
        rulesTried: skippedByFlag.get(id) ?? [],
      })),
    ];

    // Non-null: assess() throws before calling this method if identity is
    // supplied without factRepo/auditRepo having been constructed.
    await this.auditRepo!.persist({
      tenantId: identity.tenantId,
      patientId: identity.patientId,
      sessionId: identity.sessionId,
      outcome: decision.outcome,
      patientAction: decision.patient_action,
      escalationType: decision.escalation_type,
      deterministic: decision.deterministic,
      flags,
    });
  }
}
