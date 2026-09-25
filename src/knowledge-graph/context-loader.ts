/**
 * LLM Context Loader
 * Extracts phase-appropriate clinical context from knowledge graphs
 * for use in AI nurse conversations
 */

import { knowledgeGraphService } from './knowledge-graph.service';
import { KnowledgeGraph, Symptom, RedFlag, Instruction, TriggerDates, ResolvedPhaseInput } from './types';
import { logger } from '../core/logger';
import { languageDirective } from '../core/locale-language';

// ── Private utility ────────────────────────────────────────────────────────

function diffDays(later: Date, earlier: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY));
}

// ── Public helper: resolve daysSinceStart from raw dates ───────────────────

/**
 * Determine daysSinceStart and isReentry from raw patient trigger dates.
 *
 * Encapsulates Change 5 (trigger priority / fallback) and
 * Change 4 (cyclical re-entry detection). Call this before loadContext()
 * when you have Date objects rather than a pre-computed integer.
 *
 * @param kg            - The active KnowledgeGraph for this condition
 * @param triggerDates  - Raw dates from the patient record
 * @returns             - { daysSinceStart, isReentry, triggerTypeUsed }
 * @throws              - If no trigger date is available for the condition
 */
export function resolveDaysSinceStart(
  kg: KnowledgeGraph,
  triggerDates: TriggerDates
): ResolvedPhaseInput {
  const triggers: string[] = kg.condition.trigger ?? ['surgery_date'];
  const phaseModel: string = kg.condition.phase_model ?? 'linear';
  const today = new Date();

  // Step 1: find preferred trigger date (first in ordered list with a value)
  let preferredDate: Date | undefined;
  let preferredType: string | undefined;

  for (const triggerType of triggers) {
    const date = triggerDates[triggerType as keyof TriggerDates];
    if (date) {
      preferredDate = date;
      preferredType = triggerType;
      break;
    }
  }

  if (!preferredDate || !preferredType) {
    throw new Error(
      `No trigger date available. Condition requires one of: ${triggers.join(', ')}. ` +
      `Please collect the required date before loading clinical context.`
    );
  }

  // Linear: use preferred date, no re-entry possible
  if (phaseModel !== 'cyclical') {
    const daysSinceStart = diffDays(today, preferredDate);
    logger.info('Resolved phase input', {
      phaseModel,
      preferredType,
      mostRecentType: preferredType,
      isReentry: false,
      daysSinceStart,
    });
    return {
      daysSinceStart,
      isReentry: false,
      triggerTypeUsed: preferredType,
    };
  }

  // Cyclical: find the most recent date across ALL available trigger types
  let mostRecentDate = preferredDate;
  let mostRecentType = preferredType;

  for (const triggerType of triggers) {
    const date = triggerDates[triggerType as keyof TriggerDates];
    if (date && date > mostRecentDate) {
      mostRecentDate = date;
      mostRecentType = triggerType;
    }
  }

  const isReentry = mostRecentDate > preferredDate;

  logger.info('Resolved phase input', {
    phaseModel,
    preferredType,
    mostRecentType,
    isReentry,
    daysSinceStart: diffDays(today, mostRecentDate),
  });

  return {
    daysSinceStart: diffDays(today, mostRecentDate),
    isReentry,
    triggerTypeUsed: mostRecentType,
  };
}

export interface PatientPhaseContext {
  condition: string;       // e.g. "Cardiac Surgery"
  classification: string;  // e.g. "CABG"
  currentPhase: string;
  daysSinceStart: number;
  phaseFocus: string;
  phaseReview: string;
  isReentry: boolean;
  triggerType: string;     // primary trigger from kg.condition.trigger (e.g. 'enrollment_date')
  conditionType: string;   // from kg.condition.condition_type (e.g. 'chronic')
  track: 'episodic' | 'chronic' | 'hybrid'; // v3.2 — patient's entry track
}

export interface ClinicalContext {
  patientContext: PatientPhaseContext;
  symptoms: { [symptomId: string]: Symptom };
  redFlags: RedFlag[];
  instructions: Instruction[];
  scoringRules: {
    escalate_override: string;
    phase_override: string;
  };
  scoringThresholds: {
    [actionType: string]: import('./types').ScoreThreshold;
  };
  systemPrompt: string;
  /** Tenant/KG-authored full replacement for the escalation message, or null to use the platform default. */
  escalationMessage: string | null;
}

export class ContextLoader {
  /**
   * Resolve the phases dictionary for a given classification.
   * Throws if the classification does not exist in the knowledge graph.
   */
  private getClassificationPhases(
    kg: KnowledgeGraph,
    classification: string
  ): { [phaseKey: string]: any } {
    const cls = kg.condition.classifications?.[classification];
    if (!cls) {
      const available = Object.keys(kg.condition.classifications ?? {});
      throw new Error(
        `Classification '${classification}' not found for condition ` +
        `'${kg.condition.name}'. Available: [${available.join(', ')}]`
      );
    }
    return cls.phases;
  }

  /**
   * Map a trigger type string to the patient's entry track.
   * Chronic triggers → 'chronic'; all others (surgery, discharge, lmp) → 'episodic'.
   */
  private derivePatientTrack(triggerType: string): 'episodic' | 'chronic' {
    const chronicTriggers = ['enrollment_date', 'diagnosis_date'];
    return chronicTriggers.includes(triggerType) ? 'chronic' : 'episodic';
  }

  /**
   * Calculate patient's current phase based on days since condition start,
   * scoped to the patient's classification and (for hybrid conditions) track.
   *
   * For hybrid conditions, phase keys include a track suffix ("Phase I:episodic").
   * Only phases matching the patient's track or track="hybrid" are considered.
   * Returns the composite key (e.g. "Phase I:episodic") so downstream lookups work directly.
   */
  private calculateCurrentPhase(
    kg: KnowledgeGraph,
    classification: string,
    daysSinceStart: number,
    track: 'episodic' | 'chronic' = 'episodic'
  ): string | null {
    const phases = this.getClassificationPhases(kg, classification);
    const isHybrid = kg.condition.condition_type === 'hybrid';
    let bestMatch: { key: string; startDay: number } | null = null;

    for (const [phaseKey, phaseDef] of Object.entries(phases)) {
      // For hybrid conditions, filter phases by the patient's track
      if (isHybrid) {
        const colonIdx = phaseKey.lastIndexOf(':');
        const phaseTrack = colonIdx !== -1 ? phaseKey.slice(colonIdx + 1) : null;
        if (phaseTrack && phaseTrack !== track && phaseTrack !== 'hybrid') continue;
      }

      const [minDays, maxDays] = phaseDef.day_range;
      const rangeType = phaseDef.day_range_type ?? 'fixed';
      let matches = false;

      if (rangeType === 'ongoing') {
        matches = true;
      } else if (maxDays === null) {
        matches = daysSinceStart >= minDays;
      } else {
        matches = daysSinceStart >= minDays && daysSinceStart <= maxDays;
      }

      if (matches) {
        if (bestMatch && minDays === bestMatch.startDay) {
          logger.warn('Overlapping phases detected — picking by insertion order', {
            phase1: bestMatch.key,
            phase2: phaseKey,
            daysSinceStart,
          });
        }
        if (!bestMatch || minDays > bestMatch.startDay) {
          bestMatch = { key: phaseKey, startDay: minDays };
        }
      }
    }

    return bestMatch ? bestMatch.key : null;
  }

  /** applicable_classifications is either ["ALL"] or a list of classification ids */
  private matchesClassification(
    applicable: string[] | undefined,
    classification: string
  ): boolean {
    if (!applicable || applicable.length === 0) return true;
    if (applicable.includes('ALL')) return true;
    return applicable.includes(classification);
  }

  /** applicable_phases is either ["ALL"] or a list of plain phase names */
  private matchesPhase(
    applicable: string[] | undefined,
    currentPhase: string
  ): boolean {
    if (!applicable || applicable.length === 0) return true;
    if (applicable.includes('ALL')) return true;
    // Hybrid conditions store phase keys with track suffix (e.g. "Phase I:episodic").
    // applicable_phases always uses plain names — strip suffix before comparing.
    const colonIdx = currentPhase.lastIndexOf(':');
    const plainPhase = colonIdx !== -1 ? currentPhase.slice(0, colonIdx) : currentPhase;
    return applicable.includes(plainPhase) || applicable.includes(currentPhase);
  }

  /** Filter symptoms applicable to the current classification + phase */
  private getPhaseSymptoms(
    kg: KnowledgeGraph,
    classification: string,
    currentPhase: string
  ): { [symptomId: string]: Symptom } {
    const phaseSymptoms: { [symptomId: string]: Symptom } = {};

    for (const [symptomId, symptom] of Object.entries(kg.symptoms)) {
      if (
        this.matchesPhase(symptom.applicable_phases, currentPhase) &&
        this.matchesClassification(symptom.applicable_classifications, classification)
      ) {
        phaseSymptoms[symptomId] = symptom;
      }
    }

    return phaseSymptoms;
  }

  /** Filter red flags applicable to the current classification + phase */
  private getPhaseRedFlags(
    kg: KnowledgeGraph,
    classification: string,
    currentPhase: string
  ): RedFlag[] {
    return kg.red_flags.filter(
      (flag) =>
        this.matchesPhase(flag.applicable_phases, currentPhase) &&
        this.matchesClassification(flag.applicable_classifications, classification)
    );
  }

  /** Filter instructions applicable to the current classification + phase + track */
  private getPhaseInstructions(
    kg: KnowledgeGraph,
    classification: string,
    currentPhase: string,
    track: 'episodic' | 'chronic' | 'hybrid' = 'episodic'
  ): Instruction[] {
    return kg.instructions.filter((inst) => {
      if (!this.matchesPhase(inst.applicable_phases, currentPhase)) return false;
      if (!this.matchesClassification(inst.applicable_classifications, classification)) return false;
      // v3.2 track filter: absent (v3.1) or 'hybrid' → always include;
      // explicit track must match the patient's entry track
      if (inst.track && inst.track !== 'hybrid' && inst.track !== track) return false;
      return true;
    });
  }

  /**
   * Return condition-specific copy strings based on trigger type and condition type.
   * Used to avoid hardcoding "surgery" language for non-surgical conditions.
   */
  private getConditionCopy(
    triggerType: string,
    conditionType: string,
    conditionDescription: string,
    daysSinceStart: number
  ): { intro: string; timeline: string; reminder: string } {
    switch (triggerType) {
      case 'surgery_date':
        return {
          intro: `calling to check on a patient's recovery after ${conditionDescription} surgery`,
          timeline: `The patient had ${conditionDescription} surgery ${daysSinceStart} days ago.`,
          reminder: `someone recovering from ${conditionDescription} surgery`,
        };
      case 'discharge_date':
        return {
          intro: `calling to check on a patient's recovery after discharge from ${conditionDescription} treatment`,
          timeline: `The patient was discharged from ${conditionDescription} treatment ${daysSinceStart} days ago.`,
          reminder: `someone recovering after discharge from ${conditionDescription} treatment`,
        };
      case 'transplant_date':
        return {
          intro: `calling to check on a patient's recovery after a ${conditionDescription} transplant`,
          timeline: `The patient had a ${conditionDescription} transplant ${daysSinceStart} days ago.`,
          reminder: `someone recovering from a ${conditionDescription} transplant`,
        };
      case 'diagnosis_date':
        return {
          intro: `calling to check in with a patient managing ${conditionDescription}`,
          timeline: `The patient was diagnosed with ${conditionDescription} ${daysSinceStart} days ago.`,
          reminder: `someone managing a chronic condition (${conditionDescription})`,
        };
      case 'enrollment_date':
      default:
        if (conditionType === 'chronic' || conditionType === 'hybrid') {
          return {
            intro: `calling to check in with a patient enrolled in the ${conditionDescription} care programme`,
            timeline: `The patient has been in the ${conditionDescription} care programme for ${daysSinceStart} days. Current focus: `,
            reminder: `someone managing their ${conditionDescription} as part of an ongoing care programme`,
          };
        }
        return {
          intro: `calling to check in on a patient's health (${conditionDescription})`,
          timeline: `The patient has been enrolled for ${daysSinceStart} days.`,
          reminder: `someone managing ${conditionDescription}`,
        };
    }
  }

  /**
   * Build system prompt for LLM with clinical context
   */
  private buildSystemPrompt(
    ctx: PatientPhaseContext,
    symptoms: { [symptomId: string]: Symptom },
    redFlags: RedFlag[],
    instructions: Instruction[],
    locale: string = 'en-IN'
  ): string {
    const patientContext = ctx; // alias for readability
    // Language name + instruction (unknown locales fall back to English —
    // see src/core/locale-language.ts).
    const language = languageDirective(locale);

    // Build simple symptom reference
    const symptomList = Object.entries(symptoms)
      .map(([id, symptom]) => {
        const questionTopics = symptom.assessment_questions
          .map((q) => `  - ${q.prompt}`)
          .join('\n');

        return `${symptom.name}:\n${questionTopics || '  - Ask about severity and duration'}`;
      })
      .join('\n\n');

    const concerningSigns = redFlags.map((flag) => `- ${flag.trigger}`).join('\n');

    const careGuidance = instructions.map((inst) => inst.text).join('\n- ');

    const conditionDescription = patientContext.classification
      ? `${patientContext.condition} (${patientContext.classification})`
      : patientContext.condition;

    const copy = this.getConditionCopy(
      patientContext.triggerType,
      patientContext.conditionType,
      conditionDescription,
      patientContext.daysSinceStart
    );

    return `You are a caring, empathetic nurse from REAN Foundation ${copy.intro}.

## CRITICAL LANGUAGE REQUIREMENT
${language.instruction}

Example: ${language.example}

NEVER mention technical terms with the patient: "risk score", "assessment protocol", "phase", "escalation", "severity score", etc.

## Patient's Health Context
${copy.timeline} Recovery focus: ${patientContext.phaseFocus}

## Your Role in This Call

### 1. Start Warmly
Greet naturally and ask how they're feeling. Be caring and genuine.

### 2. Listen for These Symptoms
If mentioned, ask follow-up questions conversationally:

${symptomList}

### 3. Watch for Concerning Signs
If patient describes these, express concern and advise contacting doctor:

${concerningSigns}

### 4. Share Care Guidance
Mention this advice naturally:
- ${careGuidance}

## Conversation Style

✓ DO:
- Talk like a real caring nurse would
- Be warm and supportive
- Ask ONE question at a time
- Use simple everyday words
- Acknowledge feelings ("I understand that must be difficult")
- Reassure when symptoms are normal
- Show appropriate concern when needed
- Give practical, helpful advice

✗ DON'T:
- Don't mix languages (${language.name} ONLY!)
- Don't mention "risk scores", "phases", "assessment questions"
- Don't sound robotic or like reading a form
- Don't use medical jargon
- Don't be overly formal
- Don't ask multiple questions together

## Examples

Bad (robotic): "आपके जवाब पर, मैं इसे इस तरह से देखूंगी: दर्द सर्जरी के साइट पर है (कोई अतिरिक्त जोखिम नहीं) - दर्द prescribed medication पर प्रतिक्रिया नहीं दे रहा है (जो कि जोखिम को बढ़ाता है). इसका मतलब है कि आपका जोखिम स्कोर 2 है।"

Good (natural): "मुझे समझ आ रहा है। अगर दवा से आराम नहीं मिल रहा, तो यह चिंता की बात है। मैं सुझाव दूंगी कि आप अपने डॉक्टर से बात करें ताकि वे दवा की जांच कर सकें।"

Remember: Have a caring conversation with ${copy.reminder}. They should feel like talking to a real nurse who cares, not a medical computer.`;
  }

  /**
   * Load clinical context for a patient.
   * @param condition        - Condition name (e.g. "Cardiac Surgery")
   * @param classification   - Classification label (e.g. "CABG")
   * @param daysSinceStart   - Days since condition start
   * @param locale           - Patient locale (e.g. "hi-IN")
   * @param knowledgeGraphId - Optional specific KG ID; falls back to active KG for the condition
   * @param isReentry        - Whether this is a cyclical re-entry
   * @param triggerTypeUsed  - v3.2: actual trigger type used for this patient (e.g. 'enrollment_date').
   *                           When omitted, falls back to the condition's first trigger.
   *                           Required for correct track selection on hybrid conditions.
   */
  async loadContext(
    condition: string,
    classification: string,
    daysSinceStart: number,
    locale: string = 'hi-IN',
    knowledgeGraphId?: string,
    isReentry: boolean = false,
    triggerTypeUsed?: string
  ): Promise<ClinicalContext | null> {
    try {
      logger.info('Loading clinical context', {
        condition,
        classification,
        daysSinceStart,
        knowledgeGraphId: knowledgeGraphId || 'active',
      });

      let kg;
      if (knowledgeGraphId) {
        kg = await knowledgeGraphService.getKnowledgeGraphById(knowledgeGraphId);
        if (!kg) {
          logger.warn('Specified knowledge graph not found, falling back to active', {
            knowledgeGraphId,
            condition,
          });
          kg = await knowledgeGraphService.getActiveKnowledgeGraph(condition);
        }
      } else {
        kg = await knowledgeGraphService.getActiveKnowledgeGraph(condition);
      }

      if (!kg) {
        logger.warn('No knowledge graph found', { condition, knowledgeGraphId });
        return null;
      }

      // Derive patient track: use caller-supplied trigger if available, else condition's first trigger
      const effectiveTrigger = triggerTypeUsed ?? kg.condition.trigger?.[0] ?? 'surgery_date';
      const track = this.derivePatientTrack(effectiveTrigger);

      const currentPhase = this.calculateCurrentPhase(kg, classification, daysSinceStart, track);

      if (!currentPhase) {
        logger.warn('Patient is outside defined phase ranges', { condition, classification, daysSinceStart, track });
        return null;
      }

      const symptoms = this.getPhaseSymptoms(kg, classification, currentPhase);
      const redFlags = this.getPhaseRedFlags(kg, classification, currentPhase);
      const instructions = this.getPhaseInstructions(kg, classification, currentPhase, track);

      const phaseDef = kg.condition.classifications[classification].phases[currentPhase];

      const patientContext: PatientPhaseContext = {
        condition: kg.condition.name,
        classification,
        currentPhase,
        daysSinceStart,
        phaseFocus: phaseDef.focus,
        phaseReview: phaseDef.review,
        isReentry,
        triggerType: effectiveTrigger,
        conditionType: kg.condition.condition_type ?? 'episodic',
        track,
      };

      const systemPrompt = this.buildSystemPrompt(
        patientContext,
        symptoms,
        redFlags,
        instructions,
        locale
      );

      logger.info('Clinical context loaded successfully', {
        condition,
        classification,
        currentPhase,
        symptomCount: Object.keys(symptoms).length,
        redFlagCount: redFlags.length,
        instructionCount: instructions.length,
      });

      return {
        patientContext,
        symptoms,
        redFlags,
        instructions,
        scoringRules: kg.scoring.rules,
        scoringThresholds: kg.scoring.thresholds,
        systemPrompt,
        escalationMessage: kg.settings?.escalation_message ?? null,
      };
    } catch (error: any) {
      logger.error('Failed to load clinical context', {
        error: error.message,
        condition,
        classification,
        daysSinceStart,
      });
      throw error;
    }
  }
}

export const contextLoader = new ContextLoader();
