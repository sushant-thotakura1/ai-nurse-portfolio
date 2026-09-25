import { inMemoryFactResolver } from '../in-memory-fact-resolver';
import { FactRow } from '../patient-fact.repository';
import { Fact } from '../../knowledge-graph/types';

const now = new Date('2025-06-01T12:00:00Z');

function hoursAgo(n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

// valid_for_hours: 48 -> cutoff is exactly now - 48h.
const WEIGHT_FACT: Fact = {
  display_name: 'Weight',
  area: 'vitals',
  type: 'number',
  unit: 'kg',
  valid_for: '48h',
  valid_for_hours: 48,
  required: true,
  applicable_classifications: [],
  applicable_phases: [],
  extraction_hint: null,
};

function makeRow(overrides: Partial<FactRow>): FactRow {
  return {
    id: 'row-default',
    factId: 'weight',
    value: 70,
    observedAt: now,
    timeUncertaintyHours: 0,
    extractionClass: 'CONFIDENT',
    ...overrides,
  };
}

describe('inMemoryFactResolver', () => {
  describe('currentValue staleness cutoff', () => {
    // Regression guard for the net-new cutoff logic in currentValue()
    // (in-memory-fact-resolver.ts) — every other test in the suite uses a
    // huge or generously-inside-window valid_for_hours, so nothing else
    // would catch an off-by-one flip from >= to >, or the cutoff direction
    // getting reversed.
    it('a reading exactly at now - valid_for_hours resolves (inclusive boundary)', () => {
      const rows = [makeRow({ observedAt: hoursAgo(48) })];
      const resolver = inMemoryFactResolver(rows, { weight: WEIGHT_FACT }, now);
      expect(resolver.currentValue('weight')).toEqual({ resolved: true, value: 70 });
    });

    it('a reading one hour past now - valid_for_hours does NOT resolve', () => {
      const rows = [makeRow({ observedAt: hoursAgo(49) })];
      const resolver = inMemoryFactResolver(rows, { weight: WEIGHT_FACT }, now);
      expect(resolver.currentValue('weight')).toEqual({ resolved: false });
    });
  });
});
