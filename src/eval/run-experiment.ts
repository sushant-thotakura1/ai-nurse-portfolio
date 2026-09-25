// src/eval/run-experiment.ts
import { createClient } from '@arizeai/phoenix-client';
import { createDataset } from '@arizeai/phoenix-client/datasets';
import { runExperiment } from '@arizeai/phoenix-client/experiments';
import type { Example } from '@arizeai/phoenix-client/dist/esm/types/datasets';
import { OpenAIAdapter } from '../ai-agent/adapters/openai.adapter';
import { computeAssessment, runGreeting, runTurn } from './callables';
import { GreetingInput, TurnInput, AssessmentInput } from './types';
import { ChatMessage } from '../ai-agent/interfaces';
import { loadRows, toPhoenixExamples } from './dataset-loader';
import { greetingEvaluator, turnEvaluator, assessmentEvaluator } from './evaluators';
import { DatasetRow } from './dataset-types';
import { ConversationTracer } from '../instrumentation';

// ── Tracer (module-level) ─────────────────────────────────────────────────────

const tracer = new ConversationTracer();

// ── Arg parsing ───────────────────────────────────────────────────────────────

interface ParsedArgs {
  condition: string;
  classification: string;
  csvPath: string;
  experimentName: string;
  dryRun: number | false;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  const condition = get('--condition');
  const classification = get('--classification');
  const csvPath = get('--dataset');

  if (!condition || !classification || !csvPath) {
    process.stderr.write(
      [
        'Usage: npx ts-node src/eval/run-experiment.ts \\',
        '  --condition <condition> \\',
        '  --classification <classification> \\',
        '  --dataset <path/to/dataset.csv> \\',
        '  [--experiment-name "My Experiment"] \\',
        '  [--dry-run N]',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const experimentName =
    get('--experiment-name') ?? `${condition}__${classification}__${today}`;

  const dryRunRaw = get('--dry-run');
  const dryRun: number | false =
    dryRunRaw !== undefined ? parseInt(dryRunRaw, 10) : false;

  return { condition, classification, csvPath, experimentName, dryRun };
}

// ── Tracing attributes ────────────────────────────────────────────────────────

function evalAttributes(row: DatasetRow): Record<string, string | number | boolean> {
  return {
    'eval.scenario_id':     row.scenario_id,
    'eval.row_type':        row.row_type,
    'eval.condition':       row.condition,
    'eval.classification':  row.classification,
    'eval.phase':           row.phase,
    'eval.days_since_start': row.days_since_start,
    'eval.flag_path':       row.scenario_id.split('__')[3] ?? '',
  };
}

// ── Task function ─────────────────────────────────────────────────────────────

function buildTaskFunction(llm: OpenAIAdapter) {
  return async (example: Example): Promise<unknown> => {
    const row = example.input as unknown as DatasetRow;

    switch (row.row_type) {
      case 'greeting': {
        const input: GreetingInput = {
          condition:       row.condition,
          classification:  row.classification,
          phase:           row.phase,
          days_since_start: row.days_since_start,
          locale:          row.locale,
          patient_name:    row.patient_name || undefined,
        };
        return tracer.traceOperation(
          'eval.greeting',
          row.scenario_id,
          evalAttributes(row),
          () => runGreeting(input, llm),
        );
      }

      case 'turn': {
        const history = (row.history as unknown as ChatMessage[] | undefined) ?? [];
        const input: TurnInput = {
          condition:       row.condition,
          classification:  row.classification,
          phase:           row.phase,
          days_since_start: row.days_since_start,
          locale:          row.locale,
          history,
        };
        return tracer.traceOperation(
          'eval.turn',
          row.scenario_id,
          {
            ...evalAttributes(row),
            'eval.turn_number': Number(row.turn_number) || 1,
          },
          () => runTurn(input, llm),
        );
      }

      case 'assessment': {
        const transcript =
          (row.transcript as unknown as ChatMessage[] | undefined) ?? [];
        const input: AssessmentInput = {
          condition:        row.condition,
          classification:   row.classification,
          phase:            row.phase,
          days_since_start: row.days_since_start,
          locale:           row.locale,
          transcript,
        };
        return tracer.traceOperation(
          'eval.assessment',
          row.scenario_id,
          evalAttributes(row),
          () => computeAssessment(input, llm),
        );
      }

      default:
        throw new Error(`Unknown row_type: ${(row as DatasetRow).row_type}`);
    }
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { condition, classification, csvPath, experimentName, dryRun } = parseArgs();

  // 1. Load rows
  const rows = loadRows(csvPath);
  console.log(`Loaded ${rows.length} rows from ${csvPath}`);

  // 2. Convert to Phoenix examples
  const examples = toPhoenixExamples(rows);

  // 3. Create Phoenix client
  const client = createClient();

  // 4. Upload dataset
  const { datasetId } = await createDataset({
    client,
    name: `ai-nurse__${condition}__${classification}`,
    description: `AI nurse evaluation — ${condition} / ${classification}`,
    examples,
  });
  console.log(`Dataset created: ${datasetId}`);

  // 5. Build LLM adapter
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    process.stderr.write('Error: OPENAI_API_KEY environment variable is required\n');
    process.exit(1);
  }
  const llm = new OpenAIAdapter({ apiKey: openAiApiKey });

  // 6. Run experiment
  const result = await runExperiment({
    client,
    dataset: { datasetId },
    task: buildTaskFunction(llm),
    evaluators: [greetingEvaluator, turnEvaluator, assessmentEvaluator],
    experimentName,
    concurrency: 3,
    dryRun: dryRun !== false ? dryRun : false,
    record: dryRun === false,
  });

  console.log(`Experiment complete — success: ${result.successfulRunCount}, failed: ${result.failedRunCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
