// src/eval/dataset-loader.ts
import * as fs from 'fs';
import Papa from 'papaparse';
import type { Example } from '@arizeai/phoenix-client/dist/esm/types/datasets';
import type { DatasetRow } from './dataset-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseJsonField<T>(raw: string, fallback: T): T {
  if (!raw || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'true';
}

// ── Core coercion ─────────────────────────────────────────────────────────────

function parseRow(raw: Record<string, string>): DatasetRow {
  return {
    scenario_id:       raw['scenario_id'] ?? '',
    row_type:          raw['row_type'] as DatasetRow['row_type'],
    turn_number:       raw['turn_number'] ?? '',
    patient_name:      raw['patient_name'] ?? '',
    condition:         raw['condition'] ?? '',
    classification:    raw['classification'] ?? '',
    days_since_start:  Number(raw['days_since_start']),
    phase:             raw['phase'] ?? '',
    locale:            raw['locale'] ?? '',
    patient_says:      raw['patient_says'] ?? '',
    nurse_says:        raw['nurse_says'] ?? '',
    expected:          parseJsonField(raw['expected'] ?? '', {}),
    needs_review:      parseBool(raw['needs_review'] ?? 'false'),
    approved:          parseBool(raw['approved'] ?? 'false'),
    reviewer_notes:    raw['reviewer_notes'] ?? '',
    history:           parseJsonField(raw['history'] ?? '', []),
    transcript:        parseJsonField(raw['transcript'] ?? '', []),
    symptoms_reported: parseJsonField(raw['symptoms_reported'] ?? '', []),
  } as unknown as DatasetRow;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read and parse a CSV dataset file.  Throws if the file does not exist or
 * if PapaParse encounters errors.  Returns only rows where needs_review === false.
 *
 * Expects RFC 4180-quoted CSV as produced by csv-stringify (the format written
 * by csv-builder.ts).  Uses PapaParse in standard header mode so quoted JSON
 * fields (e.g. `"{""key"":true}"`) are unescaped correctly before coercion.
 */
export function loadRows(csvPath: string): DatasetRow[] {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Dataset file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');

  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    throw new Error(
      `CSV parse errors in ${csvPath}: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const rows = result.data.map(parseRow).filter((r) => !r.needs_review);
  return rows;
}

/**
 * Map DatasetRows to Phoenix Example objects for upload to Arize Phoenix.
 */
export function toPhoenixExamples(rows: DatasetRow[]): Example[] {
  return rows.map((row) => {
    const flag_path = row.scenario_id.split('__')[3] ?? '';

    const input: Record<string, unknown> = {
      scenario_id:       row.scenario_id,
      row_type:          row.row_type,
      turn_number:       row.turn_number,
      condition:         row.condition,
      classification:    row.classification,
      days_since_start:  row.days_since_start,
      phase:             row.phase,
      locale:            row.locale,
      patient_says:      row.patient_says,
      history:           row.history,
      transcript:        row.transcript,
      symptoms_reported: row.symptoms_reported,
      flag_path,
    };

    return {
      input,
      output: row.expected as unknown as Record<string, unknown>,
      metadata: {
        row_type:       row.row_type,
        scenario_id:    row.scenario_id,
        condition:      row.condition,
        classification: row.classification,
        flag_path,
        needs_review:   row.needs_review,
      },
    };
  });
}
