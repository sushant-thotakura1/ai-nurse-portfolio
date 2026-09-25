// src/screening/records.service.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../core/database';
import { decrypt } from '../core/encryption';
import { ScreeningSchema, ScreeningQuestion, Answers, AnswerValue } from './types';
import { vaccinationSchema } from './schemas/vaccination.schema';

/** Question ids whose answers live in encrypted columns, never in `answers`. */
const PII_QUESTION_IDS = new Set(['name', 'phone', 'external_id', 'abha_id']);

export type StatusFilter = 'all' | 'in_progress' | 'completed' | 'stopped';
export type DerivedStatus = 'in_progress' | 'completed' | 'stopped';

export interface StopOutcome {
  outcome: string;
  message: string;
}

const VACCINE_LABELS: Record<string, string> = {
  hepatitis_a: 'Hepatitis A',
  hepatitis_b: 'Hepatitis B',
  influenza: 'Influenza',
  tdap: 'Tdap',
  tdap_td: 'Tdap/Td',
  mmr: 'MMR',
  varicella: 'Varicella',
  pneumococcal: 'Pneumococcal',
  hpv: 'HPV',
  herpes_zoster: 'Herpes Zoster',
  hib: 'Hib',
  meningococcal: 'Meningococcal',
};

export function humanizeVaccine(token: string): string {
  if (VACCINE_LABELS[token]) return VACCINE_LABELS[token];
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Translate the list/CSV `status` query param into a Prisma `where` fragment. */
export function statusWhere(filter: StatusFilter): Prisma.ScreeningRecordWhereInput {
  switch (filter) {
    case 'in_progress':
      return { status: 'in_progress' };
    case 'completed':
      return { status: 'completed', stopOutcome: { equals: Prisma.DbNull } };
    case 'stopped':
      return { status: 'completed', NOT: { stopOutcome: { equals: Prisma.DbNull } } };
    default:
      return {};
  }
}

export function deriveStatus(storedStatus: string, stopOutcome: unknown | null): DerivedStatus {
  if (storedStatus === 'in_progress') return 'in_progress';
  return stopOutcome ? 'stopped' : 'completed';
}

export function summarizeRecommendation(
  status: DerivedStatus,
  recommendation: { vaccines: string[] } | null,
  stopOutcome: StopOutcome | null,
): string {
  if (status === 'in_progress') return '—';
  if (status === 'stopped' && stopOutcome) {
    const verb = stopOutcome.outcome === 'defer' ? 'Deferred' : 'Stopped';
    return `${verb} — ${stopOutcome.message}`;
  }
  if (!recommendation) return '—';
  if (recommendation.vaccines.length === 0) return 'No vaccines recommended';
  const labels = recommendation.vaccines.map(humanizeVaccine);
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
}

export function humanizeAnswer(question: ScreeningQuestion, value: AnswerValue): string {
  if (question.type === 'yes_no') return value ? 'Yes' : 'No';
  const labelFor = (v: string) => question.options?.find((o) => o.value === v)?.label ?? v;
  if (question.type === 'single_select') return labelFor(String(value));
  if (question.type === 'multi_select') {
    return (Array.isArray(value) ? value : []).map((v) => labelFor(String(v))).join(', ');
  }
  return String(value);
}

export interface RecordDetailSection {
  title: string;
  items: { prompt: string; answer: string }[];
}

/** Walk the schema in order; emit a section per step that has ≥1 answered, non-PII question. */
export function buildSections(schema: ScreeningSchema, answers: Answers): RecordDetailSection[] {
  const sections: RecordDetailSection[] = [];
  for (const step of schema.steps) {
    const items: { prompt: string; answer: string }[] = [];
    for (const q of step.questions) {
      if (PII_QUESTION_IDS.has(q.id)) continue;
      if (!(q.id in answers)) continue;
      items.push({ prompt: q.prompt, answer: humanizeAnswer(q, answers[q.id]) });
    }
    if (items.length > 0) sections.push({ title: step.title, items });
  }
  return sections;
}

export function safeDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    const plain = decrypt(ciphertext);
    return plain === '' ? null : plain;
  } catch {
    return null;
  }
}

export interface RecordListItem {
  id: string;
  createdAt: string;
  filledBy: string;
  status: DerivedStatus;
  name: string | null;
  phone: string | null;
  recommendationSummary: string;
}

export interface ListParams {
  status: StatusFilter;
  limit: number;
  offset: number;
}

export interface RecordListResult {
  records: RecordListItem[];
  total: number;
  limit: number;
  offset: number;
}

export async function listRecords(params: ListParams): Promise<RecordListResult> {
  const where = statusWhere(params.status);
  const [rows, total] = await Promise.all([
    prisma.screeningRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: params.offset,
      take: params.limit,
    }),
    prisma.screeningRecord.count({ where }),
  ]);

  const records: RecordListItem[] = rows.map((r) => {
    const stopOutcome = (r.stopOutcome as StopOutcome | null) ?? null;
    const status = deriveStatus(r.status, stopOutcome);
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      filledBy: r.filledBy,
      status,
      name: safeDecrypt(r.encryptedName),
      phone: safeDecrypt(r.encryptedPhone),
      recommendationSummary: summarizeRecommendation(
        status,
        (r.recommendation as { vaccines: string[] } | null) ?? null,
        stopOutcome,
      ),
    };
  });

  return { records, total, limit: params.limit, offset: params.offset };
}

export interface RecordDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  filledBy: string;
  status: DerivedStatus;
  schemaId: string;
  schemaVersion: string;
  identifiers: {
    name: string | null;
    phone: string | null;
    externalId: string | null;
    abhaId: string | null;
  };
  sections: RecordDetailSection[];
  recommendation: string[] | null;
  recommendationLabels: string[] | null;
  stopOutcome: StopOutcome | null;
}

export async function getRecordDetail(id: string): Promise<RecordDetail> {
  const r = await prisma.screeningRecord.findFirst({ where: { id } });
  if (!r) {
    throw new Error(`Screening record not found: ${id}`);
  }

  const stopOutcome = (r.stopOutcome as StopOutcome | null) ?? null;
  const status = deriveStatus(r.status, stopOutcome);
  const recVaccines = (r.recommendation as { vaccines: string[] } | null)?.vaccines ?? null;

  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    filledBy: r.filledBy,
    status,
    schemaId: r.schemaId,
    schemaVersion: r.schemaVersion,
    identifiers: {
      name: safeDecrypt(r.encryptedName),
      phone: safeDecrypt(r.encryptedPhone),
      externalId: safeDecrypt(r.encryptedExternalId),
      abhaId: safeDecrypt(r.encryptedAbhaId),
    },
    sections: buildSections(vaccinationSchema, (r.answers ?? {}) as Answers),
    recommendation: recVaccines,
    recommendationLabels: recVaccines ? recVaccines.map(humanizeVaccine) : null,
    stopOutcome,
  };
}

const CSV_COLUMNS = [
  'submitted_at',
  'filled_by',
  'status',
  'name',
  'phone',
  'external_id',
  'abha_id',
  'recommendation',
  'stop_outcome',
] as const;

function csvCell(value: string): string {
  // Neutralize spreadsheet formula injection: a cell starting with = + - @
  // (optionally after leading whitespace) is executed as a formula by
  // Excel/Sheets. Prefixing with an apostrophe forces text interpretation.
  const neutralized = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

export async function recordsCsv(params: { status: StatusFilter }): Promise<string> {
  const rows = await prisma.screeningRecord.findMany({
    where: statusWhere(params.status),
    orderBy: { createdAt: 'desc' },
  });

  const lines = [csvRow([...CSV_COLUMNS])];

  for (const r of rows) {
    const stopOutcome = (r.stopOutcome as StopOutcome | null) ?? null;
    const status = deriveStatus(r.status, stopOutcome);
    const recVaccines = (r.recommendation as { vaccines: string[] } | null)?.vaccines ?? [];
    lines.push(
      csvRow([
        r.createdAt.toISOString(),
        r.filledBy,
        status,
        safeDecrypt(r.encryptedName) ?? '',
        safeDecrypt(r.encryptedPhone) ?? '',
        safeDecrypt(r.encryptedExternalId) ?? '',
        safeDecrypt(r.encryptedAbhaId) ?? '',
        recVaccines.map(humanizeVaccine).join('; '),
        stopOutcome?.message ?? '',
      ]),
    );
  }

  // RFC 4180 CRLF line endings + a UTF-8 BOM so Excel-on-Windows renders
  // non-ASCII patient names correctly.
  return '﻿' + lines.join('\r\n');
}
