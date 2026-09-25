import { RuleAst } from '../knowledge-graph/types';
import { FactRow } from './patient-fact.repository';
import { FactResolver, Resolution } from './types';

const WINDOW_UNITS: Record<string, number> = { h: 1, d: 24, w: 168 };

/**
 * Parse a window string like "48h", "7d", "2w" into hours.
 * Formula: n * { h: 1, d: 24, w: 168 }[unit]
 */
export function parseWindowHours(window: string): number {
  const m = /^(\d+)(h|d|w)$/.exec(window);
  if (!m) throw new Error(`Invalid window expression: "${window}"`);
  return parseInt(m[1], 10) * WINDOW_UNITS[m[2]];
}

/**
 * Returns rows that pass the time-uncertainty gate for this window.
 * A row passes iff timeUncertaintyHours <= tolerance * windowHours (inclusive boundary).
 */
function gated(rows: FactRow[], windowHours: number, tolerance: number): FactRow[] {
  const limit = tolerance * windowHours;
  return rows.filter(r => r.timeUncertaintyHours <= limit);
}

const UNRESOLVED: Resolution<never> = { resolved: false };

function ok<T>(value: T): Resolution<T> {
  return { resolved: true, value };
}

/**
 * Walk a RuleAst node and evaluate it to a Resolution<boolean | number>.
 *
 * @param ast       The AST node to evaluate (produced by the Python kg-parser).
 * @param resolver  Provides current values and windowed history for named facts.
 * @param now       The reference clock for all window calculations. NEVER call Date.now() here.
 * @param tolerance The time-uncertainty gate fraction (e.g. 0.25 = 25% of the window).
 *
 * Nullability table:
 *   no_reading, count, sum   — absence-tolerant; gate NOT applied; always resolve.
 *   delta, new_onset          — value-consuming; gate IS applied.
 *   persists                  — gate IS applied; false if any of last-n rows is false,
 *                               unresolvable if < n rows and all visible are true.
 *   n_of                      — UNRESOLVED (not false) when resolvedCount < n.
 *   and / not                 — NO short-circuit; unresolvable if either operand unresolvable.
 *   or                        — short-circuits ONLY on a resolved `true`: a confirmed true
 *                               operand makes the whole OR true regardless of the other side's
 *                               resolution status. Otherwise unresolvable if either operand
 *                               unresolvable. Deliberately asymmetric with `and`: OR short-
 *                               circuiting toward `true` only ever accelerates ESCALATE (cheap
 *                               to get wrong here); AND short-circuiting toward `false` would
 *                               accelerate REASSURE off incomplete corroboration (the dangerous
 *                               direction — see STATUS.md Round 4 and the rule-failure asymmetry
 *                               table). Do not generalize this to `and`.
 */
export function evaluateAst(
  ast: RuleAst,
  resolver: FactResolver,
  now: Date,
  tolerance: number,
): Resolution<boolean | number> {
  // now is passed through for future sub-evaluations that need it.
  // The evaluator must not call Date.now() internally.
  void now;

  switch (ast.kind) {
    case 'number':
      return ok(ast.value);

    case 'string':
      // Strings appear only as RHS in compare nodes. We widen to any so the
      // compare case can handle them; the public signature stays boolean|number.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ok(ast.value) as unknown as Resolution<boolean | number>;

    case 'fact': {
      const r = resolver.currentValue(ast.name) as Resolution<boolean | number>;
      if (!r.resolved) return { resolved: false, unresolvedFact: ast.name };
      return r;
    }

    case 'not': {
      const inner = evaluateAst(ast.operand, resolver, now, tolerance);
      if (!inner.resolved) return inner;
      return ok(!(inner.value as boolean));
    }

    case 'and': {
      // NO short-circuit: both sides must resolve.
      const l = evaluateAst(ast.left, resolver, now, tolerance);
      const r = evaluateAst(ast.right, resolver, now, tolerance);
      if (!l.resolved) return l;
      if (!r.resolved) return r;
      return ok((l.value as boolean) && (r.value as boolean));
    }

    case 'or': {
      // Short-circuit ONLY on a resolved true -- see the doc comment above.
      const l = evaluateAst(ast.left, resolver, now, tolerance);
      if (l.resolved && (l.value as boolean) === true) return ok(true);
      const r = evaluateAst(ast.right, resolver, now, tolerance);
      if (r.resolved && (r.value as boolean) === true) return ok(true);
      if (!l.resolved) return l;
      if (!r.resolved) return r;
      return ok((l.value as boolean) || (r.value as boolean));
    }

    case 'compare': {
      const l = evaluateAst(ast.left, resolver, now, tolerance);
      const r = evaluateAst(ast.right, resolver, now, tolerance);
      if (!l.resolved) return l;
      if (!r.resolved) return r;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lv = l.value as any, rv = r.value as any;
      switch (ast.op) {
        case '>':  return ok(lv >   rv);
        case '>=': return ok(lv >=  rv);
        case '<':  return ok(lv <   rv);
        case '<=': return ok(lv <=  rv);
        case '==': return ok(lv === rv);
        case '!=': return ok(lv !== rv);
        default: {
          const _: never = ast.op;
          void _;
          return UNRESOLVED;
        }
      }
    }

    case 'call': {
      const { func } = ast;

      // ── Absence-tolerant aggregates (gate NOT applied) ──────────────────
      if (func === 'no_reading') {
        const windowHours = parseWindowHours(ast.window);
        const allRows = resolver.history(ast.fact, windowHours);
        // CLINICAL SAFETY: any reading — even with high time-uncertainty — is a reading.
        // Gating would cause a fuzzy reading to be silently dropped, making us
        // falsely report "no reading" and escalate a patient who DID report.
        return ok(allRows.length === 0);
      }

      if (func === 'count') {
        const windowHours = parseWindowHours(ast.window);
        const allRows = resolver.history(ast.fact, windowHours);
        // Gate NOT applied — count tolerates absence; returns 0 on empty history.
        return ok(allRows.filter(r => r.value === true).length);
      }

      if (func === 'sum') {
        const windowHours = parseWindowHours(ast.window);
        const allRows = resolver.history(ast.fact, windowHours);
        // Gate NOT applied — sum tolerates absence; returns 0 on empty history.
        return ok(allRows.reduce((s, r) => s + (r.value as number), 0));
      }

      // ── Value-consuming functions (gate IS applied) ──────────────────────
      if (func === 'delta') {
        const windowHours = parseWindowHours(ast.window);
        const rows = gated(resolver.history(ast.fact, windowHours), windowHours, tolerance);
        if (rows.length < 2) return { resolved: false, unresolvedFact: ast.fact };
        // SIGNED: weight gain is positive, weight loss is negative. Never absolute value.
        const earliest = rows[0].value as number;
        const latest   = rows[rows.length - 1].value as number;
        return ok(latest - earliest);
      }

      if (func === 'new_onset') {
        const windowHours = parseWindowHours(ast.window);
        const rows = gated(resolver.history(ast.fact, windowHours), windowHours, tolerance);
        if (rows.length === 0) return { resolved: false, unresolvedFact: ast.fact };
        const mostRecent = rows[rows.length - 1];
        // Not currently true → cannot be new onset
        if (!mostRecent.value) return ok(false);
        const lookback = rows.slice(0, -1);
        // Was already present → not new
        if (lookback.some(r => r.value === true)) return ok(false);
        // No prior false → first-ever recording, no baseline to establish "new"
        if (!lookback.some(r => r.value === false)) return ok(false);
        return ok(true);
      }

      if (func === 'persists') {
        const windowHours = parseWindowHours(ast.window);
        const ref = ast.ref;
        // v3.3: persists only supports a bare fact ref
        if (ref.kind !== 'fact') return UNRESOLVED;
        const rows = gated(resolver.history(ref.name, windowHours), windowHours, tolerance);
        // Take the last (up to) n recordings
        const last = rows.slice(-ast.n);
        // If any is false, the fact didn't persist for n consecutive recordings
        if (last.some(r => r.value === false)) return ok(false);
        // All visible are true, but we don't have n readings yet → can't confirm persistence
        if (rows.length < ast.n) return { resolved: false, unresolvedFact: ref.name };
        return ok(true);
      }

      if (func === 'n_of') {
        let trueCount = 0;
        let resolvedCount = 0;
        for (const ref of ast.refs) {
          const r = evaluateAst(ref, resolver, now, tolerance);
          if (r.resolved) {
            resolvedCount++;
            if (r.value === true) trueCount++;
          }
        }
        // CLINICAL: "we never asked" must not silently read as "no".
        // An unresolved ref could still be true — only conclude false when
        // even making every unresolved ref true cannot reach n.
        const unresolvedCount = ast.refs.length - resolvedCount;
        if (trueCount >= ast.n) return ok(true);
        if (trueCount + unresolvedCount < ast.n) return ok(false);
        return UNRESOLVED;
      }

      // Unreachable — all func variants handled above
      return UNRESOLVED;
    }
  }
}
