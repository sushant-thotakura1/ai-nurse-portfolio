import { LLMProvider } from '../ai-agent/interfaces';
import { Fact } from '../knowledge-graph/types';
import { ExtractionClass } from '../decision/types';
import { Turn } from '../orchestrator/session';

export interface ExtractedFact {
  machineName: string;
  value: number | boolean | string | null;   // null when NO_ANSWER or NOT_ASKED
  extractionClass: ExtractionClass;
  observedAt: Date;                           // defaults to latest patient turn timestamp
  timeUncertaintyHours: number;               // 0 unless patient volunteered a time offset
}

export class FactExtractor {
  constructor(private llm: LLMProvider) {}

  async extract(
    facts: Record<string, Fact>,    // kg.facts dict, already the full condition vocab
    classification: string,
    phase: string,
    turns: Turn[],
  ): Promise<ExtractedFact[]> {
    // 1. Filter facts by classification+phase
    const applicable: Array<[string, Fact]> = Object.entries(facts).filter(([, fact]) => {
      const classMatch =
        fact.applicable_classifications.includes('ALL') ||
        fact.applicable_classifications.includes(classification);
      const phaseMatch =
        fact.applicable_phases.includes('ALL') ||
        fact.applicable_phases.includes(phase);
      return classMatch && phaseMatch;
    });

    // 2. Empty applicable set → return [] without calling the LLM (fast path)
    if (applicable.length === 0) {
      return [];
    }

    // 3. Determine base timestamp from the last patient turn
    const patientTurns = turns.filter(t => t.speaker === 'patient');
    const lastPatientTurn = patientTurns.length > 0
      ? patientTurns[patientTurns.length - 1]
      : null;
    const baseTimestamp = lastPatientTurn ? lastPatientTurn.timestamp : new Date();

    // 4. Build the prompt from filtered applicable facts
    const prompt = this.buildPrompt(applicable, turns);

    // 5. Call LLM
    const response = await this.llm.complete(
      [{ role: 'user', content: prompt }],
      {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 1000,
      }
    );

    // 6. Parse LLM response — strip markdown code fences before JSON parsing
    const cleaned = response.content
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/```\s*$/m, '')
      .trim();

    let parsed: Record<string, any> = {};
    try {
      const firstBrace = cleaned.indexOf('{');
      const jsonString = firstBrace >= 0 ? cleaned.slice(firstBrace) : cleaned;
      parsed = JSON.parse(jsonString);
    } catch {
      // If parsing fails, treat all facts as NOT_ASKED
      parsed = {};
    }

    // 7. Map each applicable fact to an ExtractedFact
    return applicable.map(([machineName, fact]) => {
      const entry = parsed[machineName];

      if (!entry) {
        // Fact key absent from LLM response → NOT_ASKED
        return {
          machineName,
          value: null,
          extractionClass: 'NOT_ASKED' as ExtractionClass,
          observedAt: baseTimestamp,
          timeUncertaintyHours: 0,
        };
      }

      const extractionClass: ExtractionClass = entry.extractionClass ?? 'NOT_ASKED';
      const rawValue = entry.value;
      const timeOffsetHours: number =
        typeof entry.timeOffsetHours === 'number' ? entry.timeOffsetHours : 0;

      // Compute typed value; null when NO_ANSWER or NOT_ASKED
      let value: number | boolean | string | null = null;
      if (
        extractionClass !== 'NO_ANSWER' &&
        extractionClass !== 'NOT_ASKED' &&
        rawValue !== null &&
        rawValue !== undefined
      ) {
        if (fact.type === 'number') {
          const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          value = isNaN(num) ? null : num;
        } else if (fact.type === 'boolean') {
          // Boolean("false") === true in JS — handle string representation explicitly
          if (typeof rawValue === 'boolean') {
            value = rawValue;
          } else if (rawValue === 'false') {
            value = false;
          } else if (rawValue === 'true') {
            value = true;
          } else {
            value = Boolean(rawValue);
          }
        } else {
          // categorical
          value = String(rawValue);
        }
      }

      // Compute observedAt: subtract volunteered time offset when present
      const observedAt =
        timeOffsetHours !== 0
          ? new Date(baseTimestamp.getTime() - timeOffsetHours * 60 * 60 * 1000)
          : baseTimestamp;

      return {
        machineName,
        value,
        extractionClass,
        observedAt,
        timeUncertaintyHours: Math.abs(timeOffsetHours),
      };
    });
  }

  /**
   * Build the extraction prompt from the filtered applicable fact list.
   * MUST NOT mention thresholds, rules, or actions — perception is blind to Sheet 8.
   */
  private buildPrompt(applicable: Array<[string, Fact]>, turns: Turn[]): string {
    const factLines = applicable
      .map(([machineName, fact]) => {
        const displayName = fact.display_name ?? machineName;
        const typeDesc =
          fact.type === 'number'
            ? `numeric${fact.unit ? `, ${fact.unit}` : ''}`
            : fact.type;
        const hint = fact.extraction_hint ? ` ${fact.extraction_hint}` : '';
        return `- ${machineName} (${typeDesc}): ${displayName}.${hint}`;
      })
      .join('\n');

    const transcript = turns
      .map(turn => `${turn.speaker.toUpperCase()}: ${turn.originalText}`)
      .join('\n');

    return `You are a clinical fact extractor. From the transcript below, extract the following facts:

${factLines}

For each fact, respond with a JSON object using the machine name as the key:
{
  "fact_a": { "value": 72.5, "extractionClass": "CONFIDENT" },
  "fact_b": { "value": true, "extractionClass": "UNCERTAIN" },
  "fact_c": { "value": null, "extractionClass": "NO_ANSWER" }
}

If the patient attached a specific past time to THIS fact's own value (e.g. "two days ago I weighed 70kg" when reporting weight), also include:
  "timeOffsetHours": 48

Each fact's timeOffsetHours must come ONLY from what the patient said about THAT fact specifically. Do not attach a time mentioned for one symptom or topic to a different, unrelated fact just because it is the only time reference in the transcript. Example: if the patient says "I've been vomiting for 3 days" and separately mentions breathlessness with no time reference of its own, timeOffsetHours belongs on the vomiting-related fact only -- the breathlessness fact gets no timeOffsetHours (defaults to now). If you are not sure which fact a mentioned time belongs to, omit timeOffsetHours rather than guessing.

Classification rules for extractionClass:
- CONFIDENT: patient stated clearly
- UNCERTAIN: implied or inferred
- NO_ANSWER: patient was asked or the topic came up, but gave no value
- NOT_ASKED: topic never came up (omit the key entirely — extractor will treat missing keys as NOT_ASKED)

Transcript:
${transcript}`;
  }
}
