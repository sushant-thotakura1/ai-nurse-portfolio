// src/admin/services/feedback-store.ts
import fs from 'fs';
import path from 'path';

export interface FeedbackEntry {
  scenario_id: string;
  row_type: 'greeting' | 'turn' | 'assessment';
  turn_number?: number;
  field: string;
  decision: 'correct' | 'needs_change';
  comment?: string;
  reviewed_at: string;        // ISO 8601
  scenario_approved?: true;
}

function getFeedbackBase(): string {
  return path.resolve(process.cwd(), 'reference-dataset', 'feedback');
}

function safePath(email: string, condition: string, classification: string): string {
  // Normalise and validate — prevent path traversal
  const base = getFeedbackBase();
  const resolved = path.resolve(base, email, condition, `${classification}.json`);
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal detected: ${resolved}`);
  }
  return resolved;
}

export function loadFeedback(email: string, condition: string, classification: string): FeedbackEntry[] {
  const filePath = safePath(email, condition, classification);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FeedbackEntry[];
}

export function saveFeedback(
  email: string,
  condition: string,
  classification: string,
  entry: FeedbackEntry,
): void {
  const filePath = safePath(email, condition, classification);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const entries = loadFeedback(email, condition, classification);
  const existingIdx = entries.findIndex(
    (e) => e.scenario_id === entry.scenario_id &&
           e.row_type    === entry.row_type    &&
           e.field       === entry.field,
  );
  if (existingIdx !== -1) {
    entries[existingIdx] = entry;
  } else {
    entries.push(entry);
  }
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

export function approveScenario(
  email: string,
  condition: string,
  classification: string,
  scenarioId: string,
): void {
  const entries = loadFeedback(email, condition, classification);
  let matched = false;
  for (const e of entries) {
    if (e.scenario_id === scenarioId) {
      e.scenario_approved = true;
      matched = true;
    }
  }
  if (!matched) {
    throw new Error(`approveScenario: scenarioId "${scenarioId}" not found in feedback for ${email}/${condition}/${classification}`);
  }
  const filePath = safePath(email, condition, classification);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}
