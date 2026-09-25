import { evaluateAst, parseWindowHours } from '../ast-evaluator';
import { FactRow } from '../patient-fact.repository';
import { FactResolver } from '../types';
import { inMemoryFactResolver } from '../in-memory-fact-resolver';
import { RuleAst, Fact } from '../../knowledge-graph/types';

// ── Shared clock ─────────────────────────────────────────────────────────────
const now = new Date('2025-06-01T12:00:00Z');

function hoursAgo(n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeRow(overrides: Partial<FactRow>): FactRow {
  return {
    id: 'row-default',
    factId: 'fact-default',
    value: null,
    observedAt: now,
    timeUncertaintyHours: 0,
    extractionClass: 'CONFIDENT',
    ...overrides,
  };
}

// Built on the shared inMemoryFactResolver (see in-memory-fact-resolver.ts) so
// staleness/window semantics can't diverge between this test double and the
// real rule-test-runner. currentValues become single "now" rows; histories
// are passed through as-is (factId re-tagged to the record key). Every fact
// referenced gets a synthetic, very-permissive Fact def (valid_for_hours is
// effectively "never stale") unless the caller overrides it via factDefs —
// none of these tests exercise staleness through currentValue, only through
// history()'s windowHours, which inMemoryFactResolver honours directly.
function makeResolver(opts: {
  currentValues?: Record<string, number | boolean | string | null>;
  histories?: Record<string, FactRow[]>;
  factDefs?: Record<string, Partial<Fact>>;
}): FactResolver {
  const rows: FactRow[] = [];

  for (const [name, value] of Object.entries(opts.currentValues ?? {})) {
    if (value === null || value === undefined) continue;
    rows.push(makeRow({ id: `${name}-current`, factId: name, value, observedAt: now }));
  }

  for (const [name, factRows] of Object.entries(opts.histories ?? {})) {
    for (const row of factRows) {
      rows.push({ ...row, factId: name });
    }
  }

  const factNames = new Set<string>([
    ...Object.keys(opts.currentValues ?? {}),
    ...Object.keys(opts.histories ?? {}),
    ...Object.keys(opts.factDefs ?? {}),
  ]);
  const facts: Record<string, Fact> = {};
  for (const name of factNames) {
    facts[name] = {
      display_name: null,
      area: 'symptom',
      type: 'boolean',
      valid_for: '999999h',
      valid_for_hours: 999_999,
      required: false,
      applicable_classifications: [],
      applicable_phases: [],
      extraction_hint: null,
      ...opts.factDefs?.[name],
    } as Fact;
  }

  return inMemoryFactResolver(rows, facts, now);
}

// ── parseWindowHours ──────────────────────────────────────────────────────────

describe('parseWindowHours', () => {
  it('"48h" → 48', () => expect(parseWindowHours('48h')).toBe(48));
  it('"7d" → 168', () => expect(parseWindowHours('7d')).toBe(168));
  it('"2w" → 336', () => expect(parseWindowHours('2w')).toBe(336));
  it('throws on invalid format', () => expect(() => parseWindowHours('3x')).toThrow());
});

// ── delta ─────────────────────────────────────────────────────────────────────

describe('delta', () => {
  it('is SIGNED — latest minus earliest in the window', () => {
    const rows = [
      makeRow({ value: 70, observedAt: hoursAgo(24), timeUncertaintyHours: 0 }),
      makeRow({ value: 72, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '48h' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 2 });
  });

  it('reversed readings give negative delta (weight loss is negative)', () => {
    // CLINICAL: delta of -2 is a 2 kg loss, NOT 2. Absolute value would be wrong.
    const rows = [
      makeRow({ value: 72, observedAt: hoursAgo(24), timeUncertaintyHours: 0 }),
      makeRow({ value: 70, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '48h' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: -2 });
  });

  it('unresolvable with fewer than 2 gated readings', () => {
    const rows = [makeRow({ value: 70, observedAt: hoursAgo(0), timeUncertaintyHours: 0 })];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '48h' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'weight' });
  });

  it('excludes readings that fail the time-uncertainty gate', () => {
    // 13 > 48 * 0.25 = 12 → EXCLUDED
    const rows = [
      makeRow({ value: 70, observedAt: hoursAgo(24), timeUncertaintyHours: 13 }),
      makeRow({ value: 72, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '48h' };
    // Only 1 gated reading → unresolvable
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'weight' });
  });
});

// ── count ─────────────────────────────────────────────────────────────────────

describe('count', () => {
  it('counts recordings where the boolean fact is true', () => {
    const rows = [
      makeRow({ value: true,  observedAt: hoursAgo(6),  timeUncertaintyHours: 0 }),
      makeRow({ value: false, observedAt: hoursAgo(12), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(18), timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { breathlessness: rows } });
    const ast: RuleAst = { kind: 'call', func: 'count', fact: 'breathlessness', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 2 });
  });

  it('returns 0 on empty history — absence-tolerant, not unresolvable', () => {
    const r = makeResolver({ histories: { breathlessness: [] } });
    const ast: RuleAst = { kind: 'call', func: 'count', fact: 'breathlessness', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 0 });
  });

  it('ignores time-uncertainty gate (gate is not applied to count)', () => {
    // timeUncertaintyHours=50 in a 7d window: 50 > 168*0.25=42 → gate would exclude
    const rows = [
      makeRow({ value: true, observedAt: hoursAgo(1), timeUncertaintyHours: 50 }),
    ];
    const r = makeResolver({ histories: { breathlessness: rows } });
    const ast: RuleAst = { kind: 'call', func: 'count', fact: 'breathlessness', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 1 });
  });
});

// ── sum ───────────────────────────────────────────────────────────────────────

describe('sum', () => {
  it('sums numeric values in the window', () => {
    const rows = [
      makeRow({ value: 3, observedAt: hoursAgo(1), timeUncertaintyHours: 0 }),
      makeRow({ value: 5, observedAt: hoursAgo(2), timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { missed_doses: rows } });
    const ast: RuleAst = { kind: 'call', func: 'sum', fact: 'missed_doses', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 8 });
  });

  it('returns 0 on empty history — absence-tolerant', () => {
    const r = makeResolver({ histories: { missed_doses: [] } });
    const ast: RuleAst = { kind: 'call', func: 'sum', fact: 'missed_doses', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 0 });
  });
});

// ── no_reading ────────────────────────────────────────────────────────────────

describe('no_reading', () => {
  it('true when zero recordings in the window', () => {
    const r = makeResolver({ histories: { weight: [] } });
    const ast: RuleAst = { kind: 'call', func: 'no_reading', fact: 'weight', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('false when at least one recording exists', () => {
    const rows = [makeRow({ value: 70, observedAt: hoursAgo(1), timeUncertaintyHours: 0 })];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'no_reading', fact: 'weight', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });

  it('IGNORES the time-uncertainty gate — an imprecisely timed reading still counts', () => {
    // CLINICAL SAFETY: if we gated no_reading, a fuzzy reading would be excluded and we'd
    // falsely report "no reading" and escalate a patient who DID report.
    const rows = [makeRow({ value: 70, observedAt: hoursAgo(1), timeUncertaintyHours: 999 })];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'no_reading', fact: 'weight', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });
});

// ── n_of ──────────────────────────────────────────────────────────────────────

describe('n_of', () => {
  it('true when at least n refs are true', () => {
    const r = makeResolver({ currentValues: { a: true, b: false, c: true } });
    const ast: RuleAst = {
      kind: 'call', func: 'n_of', n: 2,
      refs: [
        { kind: 'fact', name: 'a' },
        { kind: 'fact', name: 'b' },
        { kind: 'fact', name: 'c' },
      ],
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('false when fewer than n refs are true (but enough resolve)', () => {
    const r = makeResolver({ currentValues: { a: true, b: false, c: false } });
    const ast: RuleAst = {
      kind: 'call', func: 'n_of', n: 2,
      refs: [
        { kind: 'fact', name: 'a' },
        { kind: 'fact', name: 'b' },
        { kind: 'fact', name: 'c' },
      ],
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });

  it('UNRESOLVABLE — not false — when fewer than n refs resolve', () => {
    // CLINICAL: "we never asked about vision_loss" must not silently read as "no vision loss".
    // If only 1 ref resolves and n=2, the result is unresolvable.
    const r = makeResolver({ currentValues: { a: true } }); // b and c unresolved
    const ast: RuleAst = {
      kind: 'call', func: 'n_of', n: 2,
      refs: [
        { kind: 'fact', name: 'a' },
        { kind: 'fact', name: 'b' },
        { kind: 'fact', name: 'c' },
      ],
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false });
  });

  it('UNRESOLVABLE — not false — when unresolved refs could still push trueCount to n', () => {
    // a=true, b=false, c=unresolved; n=2. resolvedCount(2) >= n(2) but trueCount(1) < n.
    // c might be true → trueCount could reach 2. Must be UNRESOLVED, not false.
    const r = makeResolver({ currentValues: { a: true, b: false } }); // c unresolved
    const ast: RuleAst = {
      kind: 'call', func: 'n_of', n: 2,
      refs: [
        { kind: 'fact', name: 'a' },
        { kind: 'fact', name: 'b' },
        { kind: 'fact', name: 'c' },
      ],
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false });
  });
});

// ── new_onset ─────────────────────────────────────────────────────────────────

describe('new_onset', () => {
  it('true when currently true, no true in lookback, at least one false in lookback', () => {
    const rows = [
      makeRow({ value: false, observedAt: hoursAgo(48), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { chest_pain: rows } });
    const ast: RuleAst = { kind: 'call', func: 'new_onset', fact: 'chest_pain', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('false on a first-ever recording (no prior false)', () => {
    const rows = [makeRow({ value: true, observedAt: hoursAgo(0), timeUncertaintyHours: 0 })];
    const r = makeResolver({ histories: { chest_pain: rows } });
    const ast: RuleAst = { kind: 'call', func: 'new_onset', fact: 'chest_pain', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });

  it('false when prior true exists in lookback', () => {
    const rows = [
      makeRow({ value: true, observedAt: hoursAgo(48), timeUncertaintyHours: 0 }),
      makeRow({ value: true, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { chest_pain: rows } });
    const ast: RuleAst = { kind: 'call', func: 'new_onset', fact: 'chest_pain', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });
});

// ── persists ──────────────────────────────────────────────────────────────────

describe('persists', () => {
  it('true when the last n recordings of the fact are all true', () => {
    const rows = [
      makeRow({ value: false, observedAt: hoursAgo(72), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(48), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(24), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { breathlessness: rows } });
    // persists(breathlessness, 3, 7d) — last 3 of 4 are true
    const ast: RuleAst = {
      kind: 'call', func: 'persists',
      ref: { kind: 'fact', name: 'breathlessness' },
      n: 3, window: '7d',
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('false when fewer than n consecutive recordings are true', () => {
    const rows = [
      makeRow({ value: false, observedAt: hoursAgo(24), timeUncertaintyHours: 0 }),
      makeRow({ value: true,  observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { breathlessness: rows } });
    const ast: RuleAst = {
      kind: 'call', func: 'persists',
      ref: { kind: 'fact', name: 'breathlessness' },
      n: 3, window: '7d',
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: false });
  });

  it('unresolvable when fewer than n readings exist in the window', () => {
    const rows = [makeRow({ value: true, observedAt: hoursAgo(0), timeUncertaintyHours: 0 })];
    const r = makeResolver({ histories: { breathlessness: rows } });
    const ast: RuleAst = {
      kind: 'call', func: 'persists',
      ref: { kind: 'fact', name: 'breathlessness' },
      n: 3, window: '7d',
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'breathlessness' });
  });

  it('unresolvable with NO fact name when ref is not a bare fact reference', () => {
    // v3.3: persists only supports a bare fact ref. If the ref isn't 'fact' kind,
    // there's no single fact name to attach — keep the generic unresolved singleton.
    const r = makeResolver({});
    const ast: RuleAst = {
      kind: 'call', func: 'persists',
      ref: { kind: 'call', func: 'count', fact: 'x', window: '7d' },
      n: 3, window: '7d',
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false });
  });
});

// ── time-uncertainty gate integration ─────────────────────────────────────────

describe('time-uncertainty gate', () => {
  it('excludes a ±24h reading from delta(weight, 48h) — 24 > 48*0.25=12', () => {
    const rows = [
      makeRow({ value: 70, observedAt: hoursAgo(24), timeUncertaintyHours: 24 }), // 24 > 12 → excluded
      makeRow({ value: 72, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '48h' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'weight' }); // only 1 gated reading
  });

  it('includes a ±24h reading in a 7d window — 24 <= 168*0.25=42', () => {
    const rows = [
      makeRow({ value: 70, observedAt: hoursAgo(48), timeUncertaintyHours: 24 }), // 24 <= 42 → included
      makeRow({ value: 72, observedAt: hoursAgo(0),  timeUncertaintyHours: 0 }),
    ];
    const r = makeResolver({ histories: { weight: rows } });
    const ast: RuleAst = { kind: 'call', func: 'delta', fact: 'weight', window: '7d' };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: 2 });
  });
});

// ── unresolvable propagation ──────────────────────────────────────────────────

describe('unresolvable propagation', () => {
  it('false AND unresolvable → unresolvable (no short-circuit)', () => {
    // CRITICAL: short-circuiting false AND X as false would silently miss data we never had
    const r = makeResolver({ currentValues: { a: false } }); // b is absent → unresolved
    const ast: RuleAst = {
      kind: 'and',
      left:  { kind: 'fact', name: 'a' },
      right: { kind: 'fact', name: 'b' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'b' });
  });

  it('true OR unresolvable → true (OR short-circuits on a resolved true)', () => {
    // A confirmed true operand settles the OR regardless of the other side --
    // unlike AND, short-circuiting here only ever accelerates ESCALATE, the
    // cheap-to-get-wrong direction (see ast-evaluator.ts's doc comment and
    // STATUS.md Round 4).
    const r = makeResolver({ currentValues: { a: true } }); // b is absent
    const ast: RuleAst = {
      kind: 'or',
      left:  { kind: 'fact', name: 'a' },
      right: { kind: 'fact', name: 'b' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('unresolvable OR true → true (short-circuits regardless of operand order)', () => {
    const r = makeResolver({ currentValues: { b: true } }); // a is absent
    const ast: RuleAst = {
      kind: 'or',
      left:  { kind: 'fact', name: 'a' },
      right: { kind: 'fact', name: 'b' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: true, value: true });
  });

  it('false OR unresolvable → unresolvable (no short-circuit on false)', () => {
    // Only a resolved TRUE short-circuits. A resolved false tells you nothing
    // about the other operand, so this must still propagate unresolved --
    // otherwise a confirmed-false report could mask an unasked, potentially
    // true, second symptom.
    const r = makeResolver({ currentValues: { a: false } }); // b is absent
    const ast: RuleAst = {
      kind: 'or',
      left:  { kind: 'fact', name: 'a' },
      right: { kind: 'fact', name: 'b' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'b' });
  });

  it('NOT unresolvable → unresolvable', () => {
    const r = makeResolver({ currentValues: {} });
    const ast: RuleAst = { kind: 'not', operand: { kind: 'fact', name: 'x' } };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'x' });
  });

  it('unresolvable AND unresolvable → propagates the LEFT side\'s fact name', () => {
    // Both sides unresolvable — arbitrary but deterministic: prefer left.
    const r = makeResolver({ currentValues: {} }); // both a and b absent
    const ast: RuleAst = {
      kind: 'and',
      left:  { kind: 'fact', name: 'a' },
      right: { kind: 'fact', name: 'b' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'a' });
  });

  it('compare with an unresolvable left operand propagates its fact name', () => {
    const r = makeResolver({ currentValues: { threshold: 5 } }); // 'reading' absent
    const ast: RuleAst = {
      kind: 'compare', op: '>',
      left:  { kind: 'fact', name: 'reading' },
      right: { kind: 'fact', name: 'threshold' },
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false, unresolvedFact: 'reading' });
  });

  it('n_of stays the generic unresolved singleton (no single culprit fact)', () => {
    const r = makeResolver({ currentValues: { a: true } }); // b and c unresolved
    const ast: RuleAst = {
      kind: 'call', func: 'n_of', n: 2,
      refs: [
        { kind: 'fact', name: 'a' },
        { kind: 'fact', name: 'b' },
        { kind: 'fact', name: 'c' },
      ],
    };
    expect(evaluateAst(ast, r, now, 0.25)).toEqual({ resolved: false });
  });
});
