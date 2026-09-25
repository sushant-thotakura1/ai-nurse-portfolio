import { FactRow } from './patient-fact.repository';
import { Fact } from '../knowledge-graph/types';
import { FactResolver, Resolution } from './types';

/**
 * In-memory FactResolver over a fixed set of rows. Used by the rule-test-runner
 * and by unit tests, so staleness/window semantics exist in exactly one place
 * outside the Prisma repository.
 *
 * currentValue mirrors PatientFactRepository.getCurrentValue's cutoff logic
 * (cutoff = now - valid_for_hours; newest row with observedAt >= cutoff wins).
 * history mirrors PatientFactRepository.getWindowHistory (rows in
 * [now - windowHours, now], oldest first) — NOT filtered by valid_for_hours.
 */
export function inMemoryFactResolver(
  rows: FactRow[],
  facts: Record<string, Fact>,
  now: Date,
): FactResolver {
  const byFact = new Map<string, FactRow[]>();
  for (const row of rows) {
    const list = byFact.get(row.factId) ?? [];
    list.push(row);
    byFact.set(row.factId, list);
  }
  // Sort each fact's rows oldest-first, mirroring the Prisma repository's
  // ORDER BY observedAt ASC.
  for (const list of byFact.values()) {
    list.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }

  const nowMs = now.getTime();

  return {
    currentValue(name: string): Resolution<number | boolean | string> {
      const factDef = facts[name];
      if (!factDef) return { resolved: false };

      const cutoffMs = nowMs - factDef.valid_for_hours * 60 * 60 * 1000;
      const candidates = (byFact.get(name) ?? []).filter(
        (r) => r.observedAt.getTime() >= cutoffMs,
      );
      if (candidates.length === 0) return { resolved: false };

      // Already sorted oldest-first, so the last candidate is the newest.
      const newest = candidates[candidates.length - 1];
      if (newest.value === null) return { resolved: false };
      return { resolved: true, value: newest.value };
    },

    history(name: string, windowHours: number): FactRow[] {
      const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
      return (byFact.get(name) ?? []).filter(
        (r) => r.observedAt.getTime() >= cutoffMs && r.observedAt.getTime() <= nowMs,
      );
    },

    factDef(name: string): Fact | undefined {
      return facts[name];
    },
  };
}
