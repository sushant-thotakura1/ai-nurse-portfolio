// src/eval/generate-dataset.ts
import fs from 'fs';
import path from 'path';
import { KnowledgeGraph } from '../knowledge-graph/types';
import { enumerateScenarios } from './scenario-enumerator';
import { buildPatientSays, toReadableCsvString, toDatasetCsvString } from './csv-builder';
import { draftGreetingExpected, draftTurnExpected } from './expected-drafters';
import { runWithTenantContext } from '../core/tenant-context-storage';
import { runGreeting, runTurn, computeAssessment } from './callables';
import { OpenAIAdapter } from '../ai-agent/adapters/openai.adapter';
import {
  DatasetRow,
  ScenarioSpec,
} from './dataset-types';
import { ChatMessage } from '../ai-agent/interfaces';
import { AssessmentOutput, GreetingInput, TurnInput, AssessmentInput } from './types';

interface CliArgs {
  condition: string;
  classification?: string;
  kgFile?: string;
  tenantId?: string;
  overwrite: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const condition = get('--condition');
  if (!condition) {
    console.error('ERROR: --condition is required');
    process.exit(1);
  }
  return {
    condition,
    classification: get('--classification'),
    kgFile: get('--kg-file'),
    tenantId: get('--tenant-id'),
    overwrite: args.includes('--overwrite'),
  };
}

async function loadKg(args: CliArgs): Promise<{ kg: KnowledgeGraph; tenantCtx: TenantCtx | null }> {
  if (args.kgFile) {
    if (!fs.existsSync(args.kgFile)) {
      console.error(`ERROR: KG file not found: ${args.kgFile}`);
      process.exit(1);
    }
    try {
      const raw = fs.readFileSync(args.kgFile, 'utf-8');
      return { kg: JSON.parse(raw) as KnowledgeGraph, tenantCtx: null };
    } catch (err) {
      console.error(`ERROR: Failed to read/parse KG file "${args.kgFile}": ${(err as Error).message}`);
      process.exit(1);
    }
  }
  if (!args.tenantId) {
    console.error('ERROR: --tenant-id is required when loading from the database (no --kg-file given).');
    process.exit(1);
  }
  console.log(`Loading KG from database for tenant ${args.tenantId}...`);
  const { knowledgeGraphService } = await import('../knowledge-graph/knowledge-graph.service');
  const { prisma } = await import('../core/database');

  const tenantRecord = await prisma.tenant.findUnique({ where: { id: args.tenantId } });
  if (!tenantRecord) {
    console.error(`ERROR: Tenant ${args.tenantId} not found in database.`);
    process.exit(1);
  }
  const tenantCtx = {
    tenantId: args.tenantId,
    tenantSlug: tenantRecord.slug ?? '',
    tenant: tenantRecord,
    isSuperAdmin: false,
  };

  const kgs = await runWithTenantContext(tenantCtx, () =>
    knowledgeGraphService.listKnowledgeGraphs({ status: 'ACTIVE' }),
  );
  const match = kgs.find((k) =>
    k.condition.toLowerCase().replace(/\s+/g, '_') === args.condition,
  );
  if (!match) {
    console.error(`ERROR: No active KG found for condition "${args.condition}". Pass the slug form (e.g. cardiac_surgery).`);
    process.exit(1);
  }

  const kg = await runWithTenantContext(tenantCtx, () =>
    knowledgeGraphService.getActiveKnowledgeGraph(match.condition),
  );
  if (!kg) {
    console.error(`ERROR: No active KG found for condition "${args.condition}".`);
    process.exit(1);
  }
  return { kg, tenantCtx };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TenantCtx = { tenantId: string; tenantSlug: string; tenant: any; isSuperAdmin: boolean };

function formatAssessmentText(out: AssessmentOutput): string {
  const parts = [
    `Outcome: ${out.outcome}`,
    `Risk: ${out.overall_risk_level}`,
    `Action: ${out.patient_action}`,
  ];
  if (out.symptoms.length > 0) {
    parts.push(`Symptoms: ${out.symptoms.map(s => `${s.name}=${s.flag}`).join(', ')}`);
  }
  if (out.escalation_required) parts.push('Escalation required');
  if (out.escalation_reason) parts.push(`Reason: ${out.escalation_reason}`);
  return parts.join(' | ');
}

async function buildScenarioRowsLive(
  spec: ScenarioSpec,
  kg: KnowledgeGraph,
  llm: OpenAIAdapter,
  tenantCtx: TenantCtx | null,
): Promise<DatasetRow[]> {
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantCtx ? runWithTenantContext(tenantCtx, fn) : fn();

  const base = {
    scenario_id: spec.scenario_id,
    condition: spec.condition_display,
    classification: spec.classification,
    days_since_start: spec.days_since_start,
    phase: spec.phase_display,
    locale: spec.locale,
    patient_name: spec.patient_name,
    approved: false,
    reviewer_notes: '',
  };

  // 1. Greeting — real LLM call
  const greetingInput: GreetingInput = {
    condition: spec.condition_display,
    classification: spec.classification,
    phase: spec.phase_display,
    days_since_start: spec.days_since_start,
    locale: spec.locale,
    patient_name: spec.patient_name,
  };
  const { nurse_greeting } = await run(() => runGreeting(greetingInput, llm));

  // 2. Patient messages (synthetic — dataset reviews nurse output, not patient input)
  const patientTurn1 = buildPatientSays(spec.flag_path, spec.symptoms_reported, 1);
  const patientTurn2 = buildPatientSays(spec.flag_path, spec.symptoms_reported, 2);

  // 3. Turn 1 — real LLM call, history uses real greeting
  const historyForTurn1: ChatMessage[] = [
    { role: 'assistant', content: nurse_greeting },
    { role: 'user', content: patientTurn1 },
  ];
  const turn1Input: TurnInput = {
    condition: spec.condition_display,
    classification: spec.classification,
    phase: spec.phase_display,
    days_since_start: spec.days_since_start,
    locale: spec.locale,
    history: historyForTurn1,
  };
  const turn1Out = await run(() => runTurn(turn1Input, llm));

  // 4. Turn 2 — real LLM call, history uses real turn 1 response
  const historyForTurn2: ChatMessage[] = [
    ...historyForTurn1,
    { role: 'assistant', content: turn1Out.nurse_response },
    { role: 'user', content: patientTurn2 },
  ];
  const turn2Input: TurnInput = {
    condition: spec.condition_display,
    classification: spec.classification,
    phase: spec.phase_display,
    days_since_start: spec.days_since_start,
    locale: spec.locale,
    history: historyForTurn2,
  };
  const turn2Out = await run(() => runTurn(turn2Input, llm));

  // 5. Assessment — deterministic from clinical service, not LLM
  const fullTranscript: ChatMessage[] = [
    ...historyForTurn2,
    { role: 'assistant', content: turn2Out.nurse_response },
  ];
  const assessInput: AssessmentInput = {
    condition: spec.condition_display,
    classification: spec.classification,
    phase: spec.phase_display,
    days_since_start: spec.days_since_start,
    locale: spec.locale,
    transcript: fullTranscript,
  };
  const assessOut = await run(() => computeAssessment(assessInput, llm));

  // Expected values for reviewer chips
  const { expected: greetingExp, needs_review: grNR } = draftGreetingExpected(kg);
  const { expected: turn1Exp } = draftTurnExpected(spec.flag_path, spec.symptoms_reported);
  const { expected: turn2Exp } = draftTurnExpected(spec.flag_path, spec.symptoms_reported);

  const greetingRow: DatasetRow = {
    ...base,
    row_type: 'greeting',
    turn_number: '',
    patient_says: '',
    nurse_says: nurse_greeting,
    expected: JSON.stringify(greetingExp),
    needs_review: grNR,
    history: JSON.stringify([]),
    transcript: undefined,
    symptoms_reported: undefined,
  };

  const turn1Row: DatasetRow = {
    ...base,
    row_type: 'turn',
    turn_number: '1',
    patient_says: patientTurn1,
    nurse_says: turn1Out.nurse_response,
    expected: JSON.stringify(turn1Exp),
    needs_review: true,
    history: JSON.stringify(historyForTurn1),
    transcript: undefined,
    symptoms_reported: undefined,
  };

  const turn2Row: DatasetRow = {
    ...base,
    row_type: 'turn',
    turn_number: '2',
    patient_says: patientTurn2,
    nurse_says: turn2Out.nurse_response,
    expected: JSON.stringify(turn2Exp),
    needs_review: true,
    history: JSON.stringify(historyForTurn2),
    transcript: undefined,
    symptoms_reported: undefined,
  };

  const assessmentRow: DatasetRow = {
    ...base,
    row_type: 'assessment',
    turn_number: '',
    patient_says: '',
    nurse_says: formatAssessmentText(assessOut),
    expected: JSON.stringify(assessOut),
    needs_review: false,
    history: undefined,
    transcript: JSON.stringify(fullTranscript),
    symptoms_reported: JSON.stringify(spec.symptoms_reported),
  };

  return [greetingRow, turn1Row, turn2Row, assessmentRow];
}

async function main(): Promise<void> {
  const args = parseArgs();

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required.');
    process.exit(1);
  }
  const llm = new OpenAIAdapter({ apiKey: openAiApiKey });

  const { kg, tenantCtx } = await loadKg(args);
  const specs = enumerateScenarios(kg, args.condition, args.classification);

  if (specs.length === 0) {
    console.error('ERROR: No scenarios generated. Check condition/classification names.');
    process.exit(1);
  }

  // Pre-flight check — verify no conflicts before writing anything
  const byClassification = new Map<string, ScenarioSpec[]>();
  for (const spec of specs) {
    if (!byClassification.has(spec.classification)) byClassification.set(spec.classification, []);
    byClassification.get(spec.classification)!.push(spec);
  }

  for (const [classification] of byClassification) {
    const outDir = path.resolve(process.cwd(), 'reference-dataset', 'generated', args.condition, classification);
    const readablePath = path.join(outDir, 'readable.csv');
    const datasetPath = path.join(outDir, 'dataset.csv');
    if (!args.overwrite && (fs.existsSync(readablePath) || fs.existsSync(datasetPath))) {
      console.error(
        `ERROR: Output files already exist at ${outDir}.\n` +
        `Pass --overwrite to replace them. This protects existing reviewer feedback.`,
      );
      process.exit(1);
    }
  }

  console.log(`\nGenerating ${specs.length} scenarios with real LLM calls (gpt-4o-mini)...\n`);

  let totalTokens = 0;
  const allRows: DatasetRow[] = [];

  for (const [i, spec] of specs.entries()) {
    process.stdout.write(`[${i + 1}/${specs.length}] ${spec.scenario_id} ... `);
    const rows = await buildScenarioRowsLive(spec, kg, llm, tenantCtx);
    allRows.push(...rows);

    // Tally usage tokens from rows (logged by adapter; approximate from output)
    process.stdout.write('done\n');
  }

  // Write output files grouped by classification
  for (const [classification, classSpecs] of byClassification) {
    const rows = allRows.filter((r) => r.classification === classification);
    const outDir = path.resolve(process.cwd(), 'reference-dataset', 'generated', args.condition, classification);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'readable.csv'), toReadableCsvString(rows), 'utf-8');
    fs.writeFileSync(path.join(outDir, 'dataset.csv'), toDatasetCsvString(rows), 'utf-8');
    console.log(`[${classification}] ${classSpecs.length} scenarios → ${outDir}`);
  }

  console.log(`\nDone. ${specs.length} scenarios, ${allRows.length} total rows.`);
}

main().catch((err: unknown) => {
  console.error('ERROR:', err);
  process.exit(1);
});
