// src/screening/records.service.test.ts
import { Prisma } from '@prisma/client';

jest.mock('../core/database', () => ({
  prisma: {
    screeningRecord: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock('../core/encryption', () => ({
  decrypt: jest.fn((v: string) => {
    if (v === 'BAD') throw new Error('Invalid ciphertext format');
    return v.replace(/^enc\(|\)$/g, '');
  }),
}));

import {
  statusWhere,
  deriveStatus,
  summarizeRecommendation,
  humanizeVaccine,
  humanizeAnswer,
  buildSections,
  safeDecrypt,
} from './records.service';
import { vaccinationSchema } from './schemas/vaccination.schema';

describe('statusWhere', () => {
  it('returns an empty object for "all"', () => {
    expect(statusWhere('all')).toEqual({});
  });
  it('filters in_progress by status only', () => {
    expect(statusWhere('in_progress')).toEqual({ status: 'in_progress' });
  });
  it('filters completed as status completed AND stopOutcome is null', () => {
    expect(statusWhere('completed')).toEqual({
      status: 'completed',
      stopOutcome: { equals: Prisma.DbNull },
    });
  });
  it('filters stopped as status completed AND stopOutcome is not null', () => {
    expect(statusWhere('stopped')).toEqual({
      status: 'completed',
      NOT: { stopOutcome: { equals: Prisma.DbNull } },
    });
  });
  it('treats an unknown filter as "all"', () => {
    expect(statusWhere('garbage' as any)).toEqual({});
  });
});

describe('deriveStatus', () => {
  it('is in_progress when the stored status is in_progress', () => {
    expect(deriveStatus('in_progress', null)).toBe('in_progress');
  });
  it('is completed when completed with no stop outcome', () => {
    expect(deriveStatus('completed', null)).toBe('completed');
  });
  it('is stopped when completed with a stop outcome', () => {
    expect(deriveStatus('completed', { outcome: 'stop', message: 'x' })).toBe('stopped');
  });
});

describe('humanizeVaccine', () => {
  it('maps known tokens', () => {
    expect(humanizeVaccine('hepatitis_b')).toBe('Hepatitis B');
    expect(humanizeVaccine('herpes_zoster')).toBe('Herpes Zoster');
  });
  it('title-cases unknown tokens', () => {
    expect(humanizeVaccine('some_new_vaccine')).toBe('Some new vaccine');
  });
});

describe('summarizeRecommendation', () => {
  it('shows a dash when in progress', () => {
    expect(summarizeRecommendation('in_progress', null, null)).toBe('—');
  });
  it('summarizes a stop outcome', () => {
    expect(summarizeRecommendation('stopped', null, { outcome: 'stop', message: 'Cannot proceed without consent.' }))
      .toBe('Stopped — Cannot proceed without consent.');
  });
  it('summarizes a defer outcome', () => {
    expect(summarizeRecommendation('stopped', null, { outcome: 'defer', message: 'Come back later.' }))
      .toBe('Deferred — Come back later.');
  });
  it('lists up to three vaccine labels then a +N overflow', () => {
    expect(summarizeRecommendation('completed', { vaccines: ['influenza', 'pneumococcal', 'hepatitis_b', 'tdap', 'mmr'] }, null))
      .toBe('Influenza, Pneumococcal, Hepatitis B +2');
  });
  it('shows all labels when there are three or fewer', () => {
    expect(summarizeRecommendation('completed', { vaccines: ['influenza', 'pneumococcal'] }, null))
      .toBe('Influenza, Pneumococcal');
  });
  it('shows a "none" note when completed with an empty vaccine list', () => {
    expect(summarizeRecommendation('completed', { vaccines: [] }, null)).toBe('No vaccines recommended');
  });
  it('shows a dash when completed but recommendation was never computed', () => {
    expect(summarizeRecommendation('completed', null, null)).toBe('—');
  });
});

describe('humanizeAnswer', () => {
  const byId = Object.fromEntries(
    vaccinationSchema.steps.flatMap((s) => s.questions).map((q) => [q.id, q]),
  );
  it('renders yes_no', () => {
    expect(humanizeAnswer(byId.consent_given, true)).toBe('Yes');
    expect(humanizeAnswer(byId.consent_given, false)).toBe('No');
  });
  it('renders a single_select label', () => {
    expect(humanizeAnswer(byId.sex, 'female')).toBe('Female');
  });
  it('renders multi_select labels joined', () => {
    expect(humanizeAnswer(byId.chronic_conditions, ['diabetes', 'cancer'])).toBe('Diabetes, Cancer');
  });
  it('renders a number as a string', () => {
    expect(humanizeAnswer(byId.age, 62)).toBe('62');
  });
  it('falls back to the raw value for an unknown option', () => {
    expect(humanizeAnswer(byId.sex, 'unknown_code')).toBe('unknown_code');
  });
});

describe('buildSections', () => {
  it('produces one section per step that has at least one answered visible question', () => {
    const answers = { consent_given: true, age: 62, sex: 'female' };
    const sections = buildSections(vaccinationSchema, answers);
    const consent = sections.find((s) => s.title === 'Consent');
    const details = sections.find((s) => s.title === 'Your details');
    expect(consent?.items).toEqual([{ prompt: 'Do you consent to this screening?', answer: 'Yes' }]);
    expect(details?.items).toEqual([
      { prompt: 'Age', answer: '62' },
      { prompt: 'Sex', answer: 'Female' },
    ]);
    // steps with no answers are omitted
    expect(sections.find((s) => s.title === 'Risk factors')).toBeUndefined();
  });
  it('skips PII question ids even if present in answers', () => {
    const sections = buildSections(vaccinationSchema, { name: 'Asha', consent_given: true });
    const details = sections.find((s) => s.title === 'Your details');
    expect(details).toBeUndefined();
  });
});

describe('safeDecrypt', () => {
  it('returns null for null/empty input', () => {
    expect(safeDecrypt(null)).toBeNull();
    expect(safeDecrypt('')).toBeNull();
  });
  it('decrypts a valid value', () => {
    expect(safeDecrypt('enc(Asha Verma)')).toBe('Asha Verma');
  });
  it('returns null when decryption throws', () => {
    expect(safeDecrypt('BAD')).toBeNull();
  });
});

import { listRecords } from './records.service';
import { prisma } from '../core/database';

describe('listRecords', () => {
  const row = (over: Partial<any> = {}) => ({
    id: 'rec-1',
    createdAt: new Date('2026-08-29T10:14:00Z'),
    filledBy: 'patient',
    status: 'completed',
    encryptedName: 'enc(Asha Verma)',
    encryptedPhone: 'enc(9876543210)',
    recommendation: { vaccines: ['influenza', 'pneumococcal'] },
    stopOutcome: null,
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('queries newest-first with paging and returns the unpaged total', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([row()]);
    (prisma.screeningRecord.count as jest.Mock).mockResolvedValue(7);

    const result = await listRecords({ status: 'all', limit: 25, offset: 0 });

    expect(prisma.screeningRecord.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
    expect(prisma.screeningRecord.count).toHaveBeenCalledWith({ where: {} });
    expect(result).toEqual({
      records: [
        {
          id: 'rec-1',
          createdAt: '2026-08-29T10:14:00.000Z',
          filledBy: 'patient',
          status: 'completed',
          name: 'Asha Verma',
          phone: '9876543210',
          recommendationSummary: 'Influenza, Pneumococcal',
        },
      ],
      total: 7,
      limit: 25,
      offset: 0,
    });
  });

  it('passes the status filter through to findMany and count', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.screeningRecord.count as jest.Mock).mockResolvedValue(0);

    await listRecords({ status: 'stopped', limit: 10, offset: 20 });

    const expectedWhere = { status: 'completed', NOT: { stopOutcome: { equals: expect.anything() } } };
    expect(prisma.screeningRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 20, take: 10 }),
    );
    expect(prisma.screeningRecord.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('derives "stopped" status and a stop-outcome summary for a halted record', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([
      row({ recommendation: null, stopOutcome: { outcome: 'stop', message: 'Cannot proceed without consent.' } }),
    ]);
    (prisma.screeningRecord.count as jest.Mock).mockResolvedValue(1);

    const result = await listRecords({ status: 'all', limit: 25, offset: 0 });

    expect(result.records[0].status).toBe('stopped');
    expect(result.records[0].recommendationSummary).toBe('Stopped — Cannot proceed without consent.');
  });

  it('returns null name/phone when the record has no identifiers', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([
      row({ encryptedName: null, encryptedPhone: null }),
    ]);
    (prisma.screeningRecord.count as jest.Mock).mockResolvedValue(1);

    const result = await listRecords({ status: 'all', limit: 25, offset: 0 });

    expect(result.records[0].name).toBeNull();
    expect(result.records[0].phone).toBeNull();
  });
});

import { getRecordDetail } from './records.service';

describe('getRecordDetail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws /not found/i when the record does not exist (tenant middleware scopes this)', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(getRecordDetail('missing')).rejects.toThrow(/not found/i);
  });

  it('assembles identifiers, schema-driven sections, and the recommendation', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      createdAt: new Date('2026-08-29T10:14:00Z'),
      updatedAt: new Date('2026-08-29T10:20:00Z'),
      filledBy: 'hcw',
      status: 'completed',
      schemaId: 'adult-vaccination',
      schemaVersion: '1',
      encryptedName: 'enc(Asha Verma)',
      encryptedPhone: null,
      encryptedExternalId: 'enc(KEM-42)',
      encryptedAbhaId: null,
      answers: { consent_given: true, age: 62, sex: 'female' },
      recommendation: { vaccines: ['influenza', 'herpes_zoster'] },
      stopOutcome: null,
    });

    const detail = await getRecordDetail('rec-1');

    expect(detail).toEqual({
      id: 'rec-1',
      createdAt: '2026-08-29T10:14:00.000Z',
      updatedAt: '2026-08-29T10:20:00.000Z',
      filledBy: 'hcw',
      status: 'completed',
      schemaId: 'adult-vaccination',
      schemaVersion: '1',
      identifiers: { name: 'Asha Verma', phone: null, externalId: 'KEM-42', abhaId: null },
      sections: [
        { title: 'Consent', items: [{ prompt: 'Do you consent to this screening?', answer: 'Yes' }] },
        { title: 'Your details', items: [{ prompt: 'Age', answer: '62' }, { prompt: 'Sex', answer: 'Female' }] },
      ],
      recommendation: ['influenza', 'herpes_zoster'],
      recommendationLabels: ['Influenza', 'Herpes Zoster'],
      stopOutcome: null,
    });
  });

  it('reports a stopped record with its stop outcome and no recommendation', async () => {
    (prisma.screeningRecord.findFirst as jest.Mock).mockResolvedValue({
      id: 'rec-2',
      createdAt: new Date('2026-08-29T09:52:00Z'),
      updatedAt: new Date('2026-08-29T09:52:00Z'),
      filledBy: 'patient',
      status: 'completed',
      schemaId: 'adult-vaccination',
      schemaVersion: '1',
      encryptedName: null,
      encryptedPhone: null,
      encryptedExternalId: null,
      encryptedAbhaId: null,
      answers: { consent_given: false },
      recommendation: null,
      stopOutcome: { outcome: 'stop', message: 'Cannot proceed without consent.' },
    });

    const detail = await getRecordDetail('rec-2');

    expect(detail.status).toBe('stopped');
    expect(detail.recommendation).toBeNull();
    expect(detail.recommendationLabels).toBeNull();
    expect(detail.stopOutcome).toEqual({ outcome: 'stop', message: 'Cannot proceed without consent.' });
  });
});

import { recordsCsv } from './records.service';

describe('recordsCsv', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits a header-only CSV when there are no matching records', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([]);

    const csv = await recordsCsv({ status: 'all' });

    expect(csv).toBe(
      '﻿"submitted_at","filled_by","status","name","phone","external_id","abha_id","recommendation","stop_outcome"',
    );
  });

  it('respects the status filter and ignores paging (no skip/take)', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([]);

    await recordsCsv({ status: 'completed' });

    const call = (prisma.screeningRecord.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ status: 'completed', stopOutcome: { equals: expect.anything() } });
    expect(call.skip).toBeUndefined();
    expect(call.take).toBeUndefined();
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('writes one fully-quoted row per record with decrypted PII and escaped quotes', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'rec-1',
        createdAt: new Date('2026-08-29T10:14:00Z'),
        filledBy: 'patient',
        status: 'completed',
        encryptedName: 'enc(Asha "AV" Verma)',
        encryptedPhone: 'enc(9876543210)',
        encryptedExternalId: null,
        encryptedAbhaId: null,
        recommendation: { vaccines: ['influenza', 'pneumococcal'] },
        stopOutcome: null,
      },
    ]);

    const csv = await recordsCsv({ status: 'all' });
    const lines = csv.replace(/^﻿/, '').split('\r\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '"2026-08-29T10:14:00.000Z","patient","completed","Asha ""AV"" Verma","9876543210","","","Influenza; Pneumococcal",""',
    );
  });

  it('writes the stop outcome message in the stop_outcome column', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'rec-2',
        createdAt: new Date('2026-08-29T09:52:00Z'),
        filledBy: 'hcw',
        status: 'completed',
        encryptedName: null,
        encryptedPhone: null,
        encryptedExternalId: null,
        encryptedAbhaId: null,
        recommendation: null,
        stopOutcome: { outcome: 'stop', message: 'Cannot proceed without consent.' },
      },
    ]);

    const csv = await recordsCsv({ status: 'all' });
    const row = csv.replace(/^﻿/, '').split('\r\n')[1];

    expect(row).toContain('"stopped"');
    expect(row.endsWith('"Cannot proceed without consent."')).toBe(true);
  });

  it('neutralizes a formula-injection name and leaves a normal name untouched', async () => {
    (prisma.screeningRecord.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'rec-3',
        createdAt: new Date('2026-08-29T10:14:00Z'),
        filledBy: 'patient',
        status: 'completed',
        encryptedName: 'enc(=cmd())',
        encryptedPhone: null,
        encryptedExternalId: null,
        encryptedAbhaId: null,
        recommendation: null,
        stopOutcome: null,
      },
      {
        id: 'rec-4',
        createdAt: new Date('2026-08-29T10:15:00Z'),
        filledBy: 'patient',
        status: 'completed',
        encryptedName: 'enc(Asha Verma)',
        encryptedPhone: null,
        encryptedExternalId: null,
        encryptedAbhaId: null,
        recommendation: null,
        stopOutcome: null,
      },
    ]);

    const csv = await recordsCsv({ status: 'all' });
    const [, injected, normal] = csv.replace(/^﻿/, '').split('\r\n');

    expect(injected.split(',')[3]).toBe(`"'=cmd()"`);
    expect(normal.split(',')[3]).toBe('"Asha Verma"');
  });
});
