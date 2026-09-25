// src/eval/scenario-enumerator.ts
import { KnowledgeGraph } from '../knowledge-graph/types';
import { ScenarioSpec, FlagPath } from './dataset-types';
import { selectSymptomForFlagPath } from './expected-drafters';

const FLAG_PATHS: FlagPath[] = ['green', 'yellow', 'red'];
const SYNTHETIC_PATIENT_NAME = 'Priya Sharma';
const DEFAULT_LOCALE = 'en-IN';

export function enumerateScenarios(
  kg: KnowledgeGraph,
  conditionKey: string,
  classificationFilter?: string,
): ScenarioSpec[] {
  const specs: ScenarioSpec[] = [];
  const classifications = Object.keys(kg.condition.classifications);

  for (const classification of classifications) {
    if (classificationFilter && classification !== classificationFilter) continue;

    const classDef = kg.condition.classifications[classification];

    for (const [phaseKey, phaseDef] of Object.entries(classDef.phases)) {
      const days_since_start = computeMidpoint(phaseDef.day_range);

      for (const flagPath of FLAG_PATHS) {
        const symptomName = selectSymptomForFlagPath(kg, classification, phaseKey, flagPath);
        const symptoms_reported = symptomName ? [symptomName] : [];

        specs.push({
          scenario_id: `${conditionKey}__${classification}__${phaseKey}__${flagPath}`,
          condition: conditionKey,
          condition_display: kg.meta.condition.name,
          classification,
          phase_key: phaseKey,
          phase_display: phaseDef.name,
          days_since_start,
          flag_path: flagPath,
          symptoms_reported,
          locale: DEFAULT_LOCALE,
          patient_name: SYNTHETIC_PATIENT_NAME,
        });
      }
    }
  }

  return specs;
}

function computeMidpoint(dayRange: [number, number | null]): number {
  const [start, end] = dayRange;
  if (end === null) return start + 15;  // open-ended: start + 15 days
  return Math.floor((start + end) / 2);
}
