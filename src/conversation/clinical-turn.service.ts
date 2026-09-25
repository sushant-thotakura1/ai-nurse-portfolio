import { LLMProvider } from '../ai-agent/interfaces';
import { ClinicalContext } from '../knowledge-graph/context-loader';
import { Symptom } from '../knowledge-graph/types';
import { logger } from '../core/logger';
import { DetectedSymptom, RedFlagHit, BranchAnswer, ActiveQuestion } from './agenda-sequencer';

export interface TurnAssessment {
  newSymptoms: DetectedSymptom[];
  redFlags: RedFlagHit[];
  branchAnswer: BranchAnswer;
}

export interface AssessTurnInput {
  patientText: string;
  recentTranscript: Array<{ speaker: 'patient' | 'agent'; text: string }>;
  clinicalCtx: ClinicalContext;
  patient: { ageYears?: number | null; gender?: string | null };
  activeQuestion: ActiveQuestion | null;
  inPlaySymptomIds?: string[];
}

const EMPTY: TurnAssessment = { newSymptoms: [], redFlags: [], branchAnswer: { kind: 'none' } };

interface DayCountRange {
  min: number;
  max: number | null;
}

function parseDayCountLabel(label: string): DayCountRange | null {
  const range = label.match(/^(\d+)\s*[-–—]\s*(\d+)\s*days?$/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const orMore = label.match(/^(\d+)\s*(?:or more|\+)\s*days?$/i);
  if (orMore) return { min: Number(orMore[1]), max: null };
  return null;
}

// Word-form counts a patient might use in place of a digit ("one week", "a
// couple of days"). Kept small and deliberately terse-answer-shaped — this is
// a fast-path for short replies, not a general NLP date parser.
const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  couple: 2, few: 3,
};

/** week = 7 days, month = 30 days, year = 365 days — calendar approximations, not exact. */
function unitToDays(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('week')) return 7;
  if (u.startsWith('month')) return 30;
  if (u.startsWith('year')) return 365;
  return 1; // day / days
}

/**
 * Parses a terse day-count answer — bare digits ("4 days"), word-form counts
 * ("one week", "a couple of days"), or non-day units ("2 weeks", "a month",
 * "1 year") — into a day count. Returns null for anything less terse (the
 * LLM classifies those). Mirrors, in reverse, the day-count -> expression
 * buckets in greeting-copy.ts / symptom-check.skill.ts (week = 7 days,
 * month = 30 days) — those don't bucket to "year", so this goes further.
 */
function parseDayCountAnswer(text: string): number | null {
  const trimmed = text.trim().replace(/\.$/, '');
  const prefix = String.raw`(?:it\s*(?:'?s|\s+has)\s*been|since)?\s*`;
  const suffix = String.raw`(?:\s*ago)?$`;
  const units = 'day|days|week|weeks|month|months|year|years';

  const digits = trimmed.match(new RegExp(`^${prefix}(\\d+)\\s*days?${suffix}`, 'i'));
  if (digits) return Number(digits[1]);

  if (new RegExp(`^${prefix}yesterday${suffix}`, 'i').test(trimmed)) return 1;

  const numericUnit = trimmed.match(new RegExp(`^${prefix}(\\d+)\\s*(${units})${suffix}`, 'i'));
  if (numericUnit) return Number(numericUnit[1]) * unitToDays(numericUnit[2]);

  // Optional leading "a " handles "a couple of days" / "a few days", where the
  // count word itself ("couple", "few") follows the article.
  const wordForm = trimmed.match(
    new RegExp(`^${prefix}(?:a\\s+)?(${Object.keys(COUNT_WORDS).join('|')})\\s*(?:of\\s*)?(${units})${suffix}`, 'i'),
  );
  if (wordForm) {
    const count = COUNT_WORDS[wordForm[1].toLowerCase()];
    return count * unitToDays(wordForm[2]);
  }

  return null;
}

/**
 * When every branch of the active question is a day-count range (e.g. "0–2 days" /
 * "3 or more days") and the patient's message is a terse day count — bare digits or a
 * word-form/non-day-unit answer like "one week" or "a month" — resolve the branch
 * directly instead of asking the LLM to classify it. Terse answers to these
 * questions were being misclassified as off_topic, causing the question to be
 * re-asked verbatim (#169, #184).
 */
function resolveDayCountBranch(patientText: string, branches: Record<string, string>): string | null {
  const ranges: Record<string, DayCountRange> = {};
  for (const [key, label] of Object.entries(branches)) {
    const range = parseDayCountLabel(label);
    if (!range) return null;
    ranges[key] = range;
  }
  const n = parseDayCountAnswer(patientText);
  if (n === null) return null;
  const matches = Object.entries(ranges).filter(([, r]) => n >= r.min && (r.max === null || n <= r.max));
  return matches.length === 1 ? matches[0][0] : null;
}

/**
 * One LLM call per turn: what the patient newly volunteered, which red-flag
 * situations their words actually describe, and — when a question is pending —
 * how their message answers it. Detection is scoped and answer-aware: if the
 * message only answers the active question, no new symptoms are reported; red
 * flags are only evaluated for systemic (symptom_id unset) triggers plus
 * triggers for symptoms already in play. Empty / `none` on any failure — the
 * session-close assessment is the backstop.
 */
export class ClinicalTurnService {
  constructor(private readonly llm: LLMProvider) {}

  async assessTurn(input: AssessTurnInput): Promise<TurnAssessment> {
    const { patientText, recentTranscript, clinicalCtx, patient, activeQuestion } = input;
    const inPlay = new Set(input.inPlaySymptomIds ?? []);

    if (activeQuestion) {
      const resolved = resolveDayCountBranch(patientText, activeQuestion.branches);
      if (resolved) return { newSymptoms: [], redFlags: [], branchAnswer: { kind: 'branch', key: resolved } };
    }

    const symptomList: DetectedSymptom[] = Object.entries(clinicalCtx.symptoms).map(
      ([id, symptom]: [string, Symptom]) => ({
        id,
        name: symptom.name,
        baseSeverity: symptom.base_severity || 'moderate',
        severityScore: symptom.severity_score || 0,
      }),
    );
    const redFlagList = (clinicalCtx.redFlags ?? []).filter(
      f => !!f.id && (!f.symptom_id || inPlay.has(f.symptom_id)),
    );

    if (symptomList.length === 0 && redFlagList.length === 0) return EMPTY;

    const pc = clinicalCtx.patientContext;
    const contextLines = [
      pc?.condition && `- Condition: ${pc.condition}${pc.classification ? ` (${pc.classification})` : ''}`,
      typeof pc?.daysSinceStart === 'number' && `- Days since surgery / condition start: ${pc.daysSinceStart}`,
      pc?.currentPhase && `- Current recovery phase: ${pc.currentPhase}`,
      pc?.conditionType && `- Condition type: ${pc.conditionType}`,
      typeof patient.ageYears === 'number' && `- Patient age: ${patient.ageYears}`,
      patient.gender && `- Patient gender: ${patient.gender}`,
    ].filter(Boolean);

    const transcriptBlock = recentTranscript.length
      ? recentTranscript.map(t => `${t.speaker === 'patient' ? 'Patient' : 'Nurse'}: ${t.text}`).join('\n')
      : '(none)';

    const questionBlock = activeQuestion
      ? `The patient was just asked this question:
"${activeQuestion.promptEn}"
Possible answers:
${Object.entries(activeQuestion.branches).map(([k, v]) => `${k}: ${v}`).join('\n')}

If the patient's message is only answering that question, set "branchAnswer" to the matching letter (or "unclear" if they tried but it is ambiguous) and report NO new symptoms. If the patient did not answer it — they asked something else, changed the subject, or volunteered a different problem — set "branchAnswer" to "off_topic" and report any symptom they newly volunteered.`
      : `There is no pending question. Set "branchAnswer" to null. Report any symptom the patient explicitly volunteers as a current problem.`;

    const prompt = `PATIENT CONTEXT:
${contextLines.join('\n') || '(not available)'}

RECENT CONVERSATION:
${transcriptBlock}

PATIENT'S LATEST MESSAGE: "${patientText}"

${questionBlock}

SYMPTOMS in the clinical protocol:
${symptomList.map(s => `- ${s.id}: ${s.name}`).join('\n') || '(none)'}

RED-FLAG SITUATIONS requiring urgent escalation:
${redFlagList.map(f => `- ${f.id}: ${f.trigger}`).join('\n') || '(none)'}

Rules:
- Report a SYMPTOM id only when the patient's own words newly and explicitly describe experiencing that symptom now. Do not infer from an answer to the pending question. Do not guess.
- Report a RED-FLAG id only when the message clearly describes that specific situation, including any stated timeframe or phase, judged against the patient context. Never flag one just because a related symptom was mentioned.

Respond with ONLY this JSON object:
{"newSymptoms": ["<id>", ...], "redFlags": ["<id>", ...], "branchAnswer": "<letter|unclear|off_topic|null>"}`;

    let raw: string;
    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: 'You are a precise clinical triage assistant for post-operative follow-up. Respond with only the JSON object.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 300 },
      );
      raw = response.content;
    } catch (err) {
      logger.warn('assessTurn: LLM call failed', { error: err instanceof Error ? err.message : String(err) });
      return EMPTY;
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY;
    let parsed: { newSymptoms?: unknown; redFlags?: unknown; branchAnswer?: unknown };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return EMPTY;
    }

    const symptomIds = new Set(Array.isArray(parsed.newSymptoms) ? parsed.newSymptoms.map(String) : []);
    const redFlagIds = new Set(Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String) : []);
    const newSymptoms = symptomList.filter(s => symptomIds.has(s.id));
    const redFlags: RedFlagHit[] = redFlagList
      .filter(f => redFlagIds.has(f.id))
      .map(f => ({
        trigger: f.trigger,
        symptomId: f.symptom_id ?? null,
        action: f.action,
        urgency: f.urgency,
        rationale: f.rationale,
      }));

    const branchAnswer = this.parseBranchAnswer(parsed.branchAnswer, activeQuestion);

    if (newSymptoms.length > 0 || redFlags.length > 0) {
      logger.info('assessTurn: assessed', {
        newSymptoms: newSymptoms.map(s => s.name),
        redFlags: redFlags.map(f => f.trigger),
        branchAnswer: branchAnswer.kind,
      });
    }
    return { newSymptoms, redFlags, branchAnswer };
  }

  private parseBranchAnswer(value: unknown, activeQuestion: ActiveQuestion | null): BranchAnswer {
    if (!activeQuestion) return { kind: 'none' };
    const v = typeof value === 'string' ? value.trim() : '';
    if (v === 'unclear') return { kind: 'unclear' };
    if (v === 'off_topic' || v === '' || v === 'null') return { kind: 'off_topic' };
    if (Object.prototype.hasOwnProperty.call(activeQuestion.branches, v)) return { kind: 'branch', key: v };
    return { kind: 'off_topic' };
  }
}
