// src/admin/__tests__/feedback-store.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpBase: string;
let store: typeof import('../services/feedback-store');

beforeEach(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-test-'));
  jest.resetModules();
  jest.mock('path', () => ({
    ...jest.requireActual('path'),
    resolve: (...args: string[]) => {
      const actual = jest.requireActual('path').resolve(...args);
      // redirect reference-dataset/feedback to tmpBase
      const refDatasetFeedback = jest.requireActual('path').resolve('reference-dataset', 'feedback');
      if (actual.startsWith(refDatasetFeedback)) {
        return actual.replace(refDatasetFeedback, tmpBase);
      }
      return actual;
    },
  }));
  store = await import('../services/feedback-store');
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true });
  jest.resetModules();
});

describe('saveFeedback', () => {
  it('writes feedback entry to the correct path', () => {
    store.saveFeedback('reviewer@test.com', 'cardiac_surgery', 'CABG', {
      scenario_id: 'cardiac_surgery__CABG__phase_1__yellow',
      row_type: 'greeting',
      field: 'warm_tone',
      decision: 'correct',
      reviewed_at: '2026-06-10T00:00:00Z',
    });
    const file = path.join(tmpBase, 'reviewer@test.com', 'cardiac_surgery', 'CABG.json');
    expect(fs.existsSync(file)).toBe(true);
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(entries[0].field).toBe('warm_tone');
  });

  it('upserts — same scenario+field replaces previous entry', () => {
    const base = { scenario_id: 's1', row_type: 'greeting' as const, field: 'warm_tone', reviewed_at: '2026-06-10T00:00:00Z' };
    store.saveFeedback('r@t.com', 'cond', 'CLS', { ...base, decision: 'correct' });
    store.saveFeedback('r@t.com', 'cond', 'CLS', { ...base, decision: 'needs_change', comment: 'wrong' });
    const entries = store.loadFeedback('r@t.com', 'cond', 'CLS');
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe('needs_change');
  });
});

describe('loadFeedback', () => {
  it('returns empty array when no feedback file exists', () => {
    expect(store.loadFeedback('new@t.com', 'cond', 'CLS')).toEqual([]);
  });
});

describe('path safety', () => {
  it('throws on path traversal in condition', () => {
    expect(() =>
      store.saveFeedback('r@t.com', '../../../etc', 'CLS', { scenario_id: 's', row_type: 'greeting', field: 'f', decision: 'correct', reviewed_at: '' })
    ).toThrow();
  });

  it('throws on path traversal in email', () => {
    expect(() =>
      store.saveFeedback('../../../etc', 'cond', 'CLS', { scenario_id: 's', row_type: 'greeting', field: 'f', decision: 'correct', reviewed_at: '' })
    ).toThrow();
  });

  it('throws on path traversal in classification', () => {
    expect(() =>
      store.saveFeedback('r@t.com', 'cond', '../../../etc/passwd', { scenario_id: 's', row_type: 'greeting', field: 'f', decision: 'correct', reviewed_at: '' })
    ).toThrow();
  });
});

describe('approveScenario', () => {
  it('marks all entries for scenarioId as approved', () => {
    store.saveFeedback('r@t.com', 'cond', 'CLS', { scenario_id: 's1', row_type: 'greeting', field: 'warm_tone', decision: 'correct', reviewed_at: '2026-06-10T00:00:00Z' });
    store.approveScenario('r@t.com', 'cond', 'CLS', 's1');
    const entries = store.loadFeedback('r@t.com', 'cond', 'CLS');
    expect(entries[0].scenario_approved).toBe(true);
  });

  it('throws when scenarioId not found', () => {
    expect(() => store.approveScenario('r@t.com', 'cond', 'CLS', 'nonexistent')).toThrow();
  });
});
