# v3.2 KB Schema Reference

v3.2 is additive over v3.1. All new columns are backwards-compatible: v3.1 files without the new columns continue to parse and validate. New KBs should be authored in v3.2.

**What's new in v3.2:**
- `Track` column on Conditions & Phases (required) and Instructions (required) — supports hybrid conditions where the same classification has different phase content for episodic vs. chronic entry.
- `Patient Action` column on Red Flags (required), Assessment Questions (required when `Escalate?=Yes`), and Instructions (optional, only for threshold-type instructions) — enforces decisive, unambiguous patient-facing routing instead of vague "contact your clinical team" language.

## File naming

`knowledge-base/v3/<condition-slug>.xlsx`
Slug: condition name lowercased, spaces → hyphens (e.g. "Heart Failure" → `heart-failure.xlsx`).

## Workbook structure

Every XLSX has 6 required sheets, plus 4 optional: Facts (Sheet 7), Rules (Sheet 8), Settings (Sheet 9), Rule Tests (Sheet 10). Required sheets must appear in this order:

| # | Sheet name | Purpose |
|---|-----------|---------|
| 1 | Conditions & Phases | Phase timeline per classification × track |
| 2 | Symptoms | Symptoms the patient may report |
| 3 | Assessment Questions | Branching triage questions per symptom |
| 4 | Red Flags | Hard ESCALATE triggers |
| 5 | Instructions | Patient instructions per phase × track |
| 6 | Scoring Logic | Universal thresholds (identical across all KBs) |
| 7 | Facts | *(Optional)* Clinical fact vocabulary for rule expressions |
| 8 | Rules | *(Optional)* Clinical decision rules over Sheet 7 facts |
| 9 | Settings | *(Optional)* Condition-level configuration overrides |
| 10 | Rule Tests | *(Optional, but expected for any KB with rules)* Test cases proving each Sheet 8 rule fires and doesn't fire |

## Row structure (all sheets)

```
Row 1: Sheet title (single cell, plain text)
Row 2: One-line description of the sheet
Row 3: Blank
Row 4: Header row (column names)
Row 5+: Data rows
```

The parser treats any row with a non-blank value in the primary ID or Condition column as a data row. **Do not put footnotes, totals, or notes below the last data row.**

---

## Track vocabulary (v3.2)

`Track` mirrors the Condition Type vocabulary exactly — same three values, applied at the row level:

| Value | Meaning |
|---|---|
| `episodic` | Row applies only to patients who entered via an event trigger (surgery, discharge) |
| `chronic` | Row applies only to patients who entered via ambulatory trigger (enrollment, diagnosis) |
| `hybrid` | Row applies to all patients regardless of entry path (episodic or chronic) |

**Validity per Condition Type:**

| Condition Type | Allowed Track values |
|---|---|
| `episodic` | `episodic` only |
| `chronic` | `chronic` only |
| `hybrid` | `episodic`, `chronic`, or `hybrid` — must be explicit per row |

**When to use `Track = hybrid`:** phases that converge across entry paths (e.g., HF Phase III onwards — maintenance is identical whether the patient was discharged or enrolled chronically). Avoids duplicating rows with identical content.

---

## Patient Action vocabulary (v3.2)

`Patient Action` values:

| Value | Patient hears (script intent) | Nurse/ops action |
|---|---|---|
| `ER_NOW` | "Go to the emergency room right now. Do not wait." | Immediate alert |
| `FACILITY_TODAY` | "You need to visit the clinic/hospital today." | Urgent alert |
| `NURSE_CALLBACK` | "Record this. Your nurse will call you within 24 hours. You do not need to travel." | Queued for nurse outreach within SLA |
| `SELF_MONITOR` | "This is expected. Keep tracking at home." | No action |

**Mapping to existing thresholds (default when `Patient Action` is omitted from a v3.1 row):**

| Source | Default Patient Action |
|---|---|
| Red Flag Urgency `Immediate` | `ER_NOW` |
| Red Flag Urgency `Urgent` | `FACILITY_TODAY` |
| Red Flag Urgency `Routine` | `NURSE_CALLBACK` |
| Assessment Question branch with `Escalate?=Yes` | `FACILITY_TODAY` (author should specify `ER_NOW` where life/limb/sight-threatening) |
| Score → ADVISE | `NURSE_CALLBACK` |
| Score → REASSURE | `SELF_MONITOR` |

**Decisiveness rule:** Never use ambiguous language like "contact your clinical team" or "tell your doctor" in instruction text or context notes. Every action-triggering row MUST commit to one of the four values above. See principles.md for the full decisiveness rule.

---

## Sheet 1: Conditions & Phases

| Column | Required | Valid values |
|--------|----------|-------------|
| Condition | Yes | Plain condition name (e.g. "Heart Failure") |
| Condition Type | Yes | `episodic` \| `chronic` \| `hybrid` |
| Trigger | Yes | `surgery_date` \| `discharge_date` \| `enrollment_date` \| `diagnosis_date` \| `lmp_date`. Multiple triggers separated by ` \| ` for hybrid. |
| Phase Model | Yes | `linear` \| `cyclical` |
| Classification | Yes | Plain label (e.g. "HFrEF") |
| Phase | Yes | Phase name string |
| Day Range | Yes | `{n}–{m}` \| `{n}+` \| `ongoing` |
| Track | Yes (v3.2) | `episodic` \| `chronic` \| `hybrid`. See validity rules above. |
| Focus | Yes | 1–2 sentence clinical focus |
| Review Point | Yes | When/how to review |
| Sheet Version | No | Version string (e.g. "v1") |
| Notes | No | Free text |

One row per (Classification × Phase × Track) combination. For hybrid conditions, Phase I and early phases typically need separate `episodic` and `chronic` rows with different Focus/Review Point text; later phases often converge to a single `hybrid` row.

---

## Sheet 2: Symptoms

No changes in v3.2. Symptoms are pathophysiology-based and track-agnostic.

| Column | Required | Valid values / notes |
|--------|----------|---------------------|
| Symptom ID | Yes | `SYM_{SLUG}_{NNN}` |
| Symptom Name | Yes | Plain name |
| Applicable Classifications | Yes | `ALL` or comma-separated classification labels |
| Applicable Phases | Yes | `ALL` or comma-separated phase names |
| Base Severity | Yes | `Low` \| `Moderate` \| `High` (title case) |
| Severity Score | Yes | `0` (Low), `1` (Moderate), `2` (High) |
| Phase Override? | Yes | `Yes` \| `No` |
| Override Detail | No | Free text (required if Phase Override = Yes) |
| Clinical Notes | No | Free text |

---

## Sheet 3: Assessment Questions

| Column | Required | Valid values / notes |
|--------|----------|---------------------|
| Question ID | Yes | `Q_{SLUG}_{NNN}` |
| Symptom ID | Yes | Must match a Symptom ID in Sheet 2 |
| Order | Yes | Integer (1 = first question for this symptom) |
| Question Text (voice prompt) | Yes | Plain spoken language |
| Answer A (label) | Yes | Short label (e.g. "Yes", "Mild") |
| Risk Shift A | Yes | Integer (typically -1, 0, or +1) |
| Escalate? A | Yes | `Yes` \| `No` |
| Patient Action A | Yes if `Escalate? A = Yes`, else optional (v3.2) | `ER_NOW` \| `FACILITY_TODAY` \| `NURSE_CALLBACK` \| `SELF_MONITOR` \| `—` |
| Answer B (label) | Yes | Short label |
| Risk Shift B | Yes | Integer |
| Escalate? B | Yes | `Yes` \| `No` |
| Patient Action B | Yes if `Escalate? B = Yes`, else optional (v3.2) | Same values as Patient Action A |
| Next Q | No | Question ID to follow, or `—` if terminal |
| Notes for Doctor | No | Free text |

---

## Sheet 4: Red Flags

| Column | Required | Valid values / notes |
|--------|----------|---------------------|
| Red Flag ID | Yes | `RF_{SLUG}_{NNN}` |
| Symptom ID | No | Linked symptom ID, or `—` |
| Trigger Condition | Yes | Clinical description of when flag fires |
| Applicable Classifications | Yes | `ALL` or comma-separated labels |
| Applicable Phases | Yes | `ALL` or comma-separated phase names |
| Action | Yes | `ESCALATE` \| `ADVISE` |
| Urgency | Yes | `Immediate` \| `Urgent` \| `Routine` |
| Patient Action | Yes (v3.2) | `ER_NOW` \| `FACILITY_TODAY` \| `NURSE_CALLBACK`. `SELF_MONITOR` not valid for red flags. |
| Context Note | No | Patient-facing note. Must use decisive language per v3.2 decisiveness rule. |
| Clinical Rationale | No | Clinical reasoning |

---

## Sheet 5: Instructions

| Column | Required | Valid values / notes |
|--------|----------|---------------------|
| Instruction ID | Yes | `INS_{SLUG}_{NNN}` |
| Applicable Classifications | Yes | `ALL` or comma-separated labels |
| Phase | Yes | Phase name or `ALL` |
| Track | Yes (v3.2) | `episodic` \| `chronic` \| `hybrid`. Same validity rules as Conditions & Phases. |
| Category | Yes | `medication` \| `vitals` \| `diet` \| `exercise` \| `sleep` \| `stress` \| `symptom` \| `monitoring` \| `education` \| `other` |
| Instruction Text | Yes | Plain patient language. Must use decisive language per v3.2 decisiveness rule — no "contact your clinical team" phrasing. |
| Patient Action | No (v3.2) | Required when instruction describes a threshold/trigger (e.g., "if X happens..."). Omit (`—`) for pure education / routine adherence instructions. |
| Issued At | No | When issued (e.g. phase name, "Discharge") |
| Replaces | No | Instruction ID being superseded, or `—` |
| Notes | No | Clinical notes |

---

## Sheet 6: Scoring Logic

> **Note:** Sheet 6 (Scoring Logic) is planned for retirement in Part 2. Do not build new conditions that depend on it.

Standard content, identical for every KB. Use this exact data:

```
Row 1: Scoring Logic
Row 2: Universal thresholds. Do NOT modify per condition.
Row 3: (blank)
Row 4: Component | Details
Row 5: Base Severity 0 (Low) | Symptom expected; no added risk
Row 6: Base Severity 1 (Moderate) | Worth monitoring; may add risk
Row 7: Base Severity 2 (High) | Concerning; likely escalation
Row 8: Threshold REASSURE | score ≤ 0 — Patient Action SELF_MONITOR. Symptom expected.
Row 9: Threshold ADVISE | score 1–2 — Patient Action NURSE_CALLBACK. Nurse reaches out within SLA; patient does not travel.
Row 10: Threshold ESCALATE | score ≥ 3 — Patient Action FACILITY_TODAY (default) or ER_NOW (life/limb/sight-threatening).
Row 11: Escalate override | Any question branch with Escalate=Yes → ESCALATE regardless of score. Patient Action comes from the branch.
Row 12: Phase override | If symptom has Phase Override for current phase, use that action directly.
Row 13: Cyclical re-entry | If Phase Model = cyclical, use most recent trigger date across all trigger types.
Row 14: Track selection | For hybrid conditions, select phase and instruction rows whose Track matches the patient's entry trigger (discharge/surgery → episodic; enrollment/diagnosis → chronic). Rows marked Track=hybrid apply regardless.
```

---

### Sheet 7 — Facts (Optional)

Declares the clinical fact vocabulary. Every identifier used in Sheet 8 Rule expressions must be declared here.

| Column | Required | Notes |
|--------|----------|-------|
| Machine Name | Yes | Unique identifier used in expressions. Snake_case, e.g. `systolic_bp` |
| Display Name | Yes | Human-readable name spoken during check-in, e.g. "Systolic Blood Pressure" |
| Type | Yes | `number` \| `boolean` \| `categorical` |
| Unit | If Type=number | e.g. `kg`, `mmHg`, `bpm` |
| Valid For | Yes | How long a reading stays fresh. Duration: `7d`, `48h`, `2w` |
| Required | Yes | `Yes` or `No`. Required facts trigger INCOMPLETE when stale |
| Area | Yes | `vitals` \| `medication` \| `nutrition` \| `exercise` \| `appointment` \| `stress` \| `symptom` |
| Applicable Classifications | Yes | `ALL` or comma-separated classification names |
| Applicable Phases | Yes | `ALL` or comma-separated phase names |
| Extraction Hint | No | How patients *talk* about this fact — phrasings, units, synonyms. **MUST NOT mention thresholds, ranges, actions, or why the fact matters clinically.** See below. |

#### ⚠️ Extraction Hint must never carry clinical significance

This field is inserted **verbatim** into the fact-extraction prompt. Perception is
deliberately **blind to Sheet 8** — the extractor must not know what value would be
alarming. An extractor that knows the threshold stops *reporting* and starts
*confirming*: given "about the same, maybe a bit up" and knowledge that 2 kg is the
line, it writes 2.1. From the outside you cannot tell that from a real measurement.

**A hint may describe how patients talk. It may never describe why the fact matters.**

| ❌ Never | ✅ Correct |
|---|---|
| "Critical for detecting decompensation — watch for gains over 2 kg" | "may say kilos or pounds; convert to kg" |
| "Escalate if below 95%" | "patient may say 'my oxygen number'" |
| "Key indicator of deterioration" | "may say 'puffy', 'my shoes don't fit'" |
| "Important — flag if severe" | "top / bigger number" |

#### ⚠️ Threshold facts vs. trend facts — do not let one hint answer for both

**Found via live testing, 2026-07-23 (see STATUS.md, Round 4 and the cross-cutting SME review queue).** Some symptoms have two genuinely independent facts: a **threshold** fact (at what level of exertion/severity does it show up — e.g. `breathlessness_at_rest`) and a **trend** fact (is it changing over time compared to before — e.g. `breathlessness_worsening_trend`). These ask different questions, and a patient can answer one with zero information about the other: "I get breathless climbing stairs" says nothing about whether that's new, stable, or getting worse.

**The failure this caused in practice:** a patient described breathlessness only on exertion, with no comparison to an earlier point in time. The extractor still returned `breathlessness_worsening_trend = true` — it read "patient is reporting a real symptom" as "the symptom is worsening," which are different claims. The hint's example phrasings were themselves fine (comparative language like "more short of breath than a few days ago"); the gap was that nothing told the model what to do when the patient's statement contains *no* comparison at all.

**The rule: a trend fact's hint must require an explicit before/after comparison, and say so — not just show comparative examples.** If the patient's statement doesn't contain a comparison, the fact should resolve as unresolved (not asked / not answered), never as an inferred `true` or `false`. This is a stricter version of the same "may describe how patients talk, never why it matters" rule above — it doesn't leak clinical significance, it just closes a gap the phrasing-only version of the hint left open.

| ❌ Insufficient (shows what a positive case sounds like, doesn't gate the negative) | ✅ Correct (requires the comparison, names the no-comparison case explicitly) |
|---|---|
| "Breathlessness that has been getting worse over recent days — patient may say 'more short of breath than a few days ago'." | "Requires the patient to explicitly compare against an earlier point in time — e.g. 'worse than yesterday', 'used to manage fine, now I can't'. A description of the symptom occurring at some activity level (e.g. 'breathless on stairs') with no stated comparison is NOT a trend report — leave unresolved rather than inferring a direction." |

**When authoring Sheet 7 for a new condition:** if a symptom naturally splits into a threshold fact and a trend fact (pain severity vs. worsening, fatigue level vs. trend, wound status vs. change, etc.), apply this discipline to the trend fact's hint from the start, and make sure the threshold fact's hint doesn't itself smuggle in a comparison. Don't wait for a live-testing round to catch it.

---

### Sheet 8 — Rules (Optional)

Clinical decision rules. Each rule is an expression over Sheet 7 facts. Rules are grouped by Red Flag ID (from Sheet 4); within a group, Order determines evaluation sequence (lower Order = higher priority).

| Column | Required | Notes |
|--------|----------|-------|
| Rule ID | Yes | Unique identifier, e.g. `RF001_WEIGHT_HIGH` |
| Red Flag ID | Yes | Must match a Red Flag ID in Sheet 4 |
| Order | Yes | Integer. Lower = evaluated first. no_reading rules must have the highest Order in their group |
| Expression | Yes | Boolean expression over Sheet 7 facts. See Expression Language below |
| Action | Yes | `REASSURE` \| `ADVISE` \| `ESCALATE`. **Never author REASSURE unless the SME explicitly requested a downgrade** |
| Patient Action | No | `ER_NOW` \| `FACILITY_TODAY` \| `NURSE_CALLBACK` \| `SELF_MONITOR` |
| Applicable Classifications | Yes | `ALL` or comma-separated |
| Applicable Phases | Yes | `ALL` or comma-separated |
| Reviewed By | No | Clinician name — not a validation gate |
| Reviewed At | No | Review date — not a validation gate |

**no_reading rules must have the highest Order number in their group.** A no_reading rule fires only when no clinical rule matched — giving a clinical signal priority is correct and required.

---

### Sheet 9 — Settings (Optional)

Condition-level configuration. All settings have safe defaults — omit this sheet if the defaults are appropriate.

**Sheet structure:** The Excel sheet must have exactly two column headers on row 4:

| Column | Required | Notes |
|--------|----------|-------|
| Setting | Yes | Setting key name — must match one of the names below |
| Value | Yes | Setting value — type depends on the setting (integer, duration like `3d`, float, or string) |

| Setting | Default | Type | Notes |
|---------|---------|------|-------|
| max_questions_per_checkin | 6 | integer | Maximum questions per check-in session |
| min_days_between_checkins | 3d | duration | Minimum cadence between check-ins (h/d/w) |
| checkin_trigger_stale_count | 1 | integer | Number of stale Required facts that triggers a check-in |
| time_uncertainty_tolerance | 0.25 | float | Fraction of Valid For window treated as tolerable drift |
| escalation_message | *(omit — uses the platform's default escalation message)* | string (v3.3) | Full replacement for the entire patient-facing escalation message whenever this turn escalates — NOT appended to the default, it REPLACES it. Free text: author writes the complete message (what to do, who to contact, any numbers). Not parsed or validated. Translated to the patient's locale at send time, same mechanism as question prompts. Omit this to keep the platform's generic, SME-reviewed default message. |

---

### Sheet 10 — Rule Tests (Optional, but expected for any KB with rules)

**Tab name must be exactly `Rule Tests`** — the parser looks sheets up by name.

Test cases for Sheet 8 rules. **Every rule ships with test cases** — drafting a rule and drafting its cases are the same step, not a follow-up. Validation only proves a rule is well-formed, never that it fires or fails to fire; a rule like `delta(weight,48h) >= 5` can validate cleanly and still be practically unfireable. Cases also turn rule review into something an SME can judge directly: "should this patient escalate?" is answerable; "is this boolean expression correct?" is not.

| Column | Required | Notes |
|--------|----------|-------|
| Test ID | Yes | `T_{SLUG}_{NNN}{a,b,c}` |
| Rule ID | Yes | Must match a Rule ID in Sheet 8 |
| Scenario | Yes | Plain clinical language — **this is what the SME reads and judges** |
| Facts | Yes | The fact history that executes against the rule. Grammar below |
| Expect | Yes | `FIRES` \| `NOT_FIRES` |
| Notes | No | Reviewer comments |

**Worked example:**

| Test ID | Rule ID | Scenario | Facts | Expect |
|---|---|---|---|---|
| `T_HF_001a` | `R_HF_001` | Gained 2 kg in two days, now breathless | `weight = 70 @ -2d`<br>`weight = 72`<br>`breathlessness = true` | FIRES |
| `T_HF_001b` | `R_HF_001` | Gained 2 kg but feels fine | `weight = 70 @ -2d`<br>`weight = 72`<br>`breathlessness = false`<br>`edema = false` | NOT_FIRES |
| `T_HF_001c` | `R_HF_001` | Slow 1 kg gain over a week, breathless | `weight = 71 @ -7d`<br>`weight = 72`<br>`breathlessness = true` | NOT_FIRES |
| `T_HF_002a` | `R_HF_002` | Reports feeling low and irritable | `mood = 'irritable'` | FIRES |

Categorical values may be quoted or bare — `mood = 'irritable'` and `mood = irritable` both parse; quotes are stripped. Prefer quoting, as shown, since it matches how categorical comparisons are written in Sheet 8 expressions (`mood == 'low'`).

#### Facts cell grammar

One observation per line within the cell (Alt+Enter in Excel):

```ebnf
observation = identifier "=" value [ "@" offset ] ;
value       = number | "true" | "false" | string ;
offset      = "-" duration ;                        (* same duration grammar as Sheet 8 expressions, negated *)
```

- **Omitted `@ offset` means "now"** — the common case (`systolic_bp = 185`) stays clean.
- The offset reuses the same duration grammar Sheet 8 expressions use (`-2d`, `-48h`, `-1w`) — no new syntax to learn.
- **A fact absent from the list has no readings** — exactly what `no_reading()` needs, with no special syntax.
- Repeat a fact at different offsets to build the history `delta`/`count`/`sum`/`persists` require.
- `timeUncertaintyHours` is always 0 in test cases — that gate is exercised by unit tests, not KB cases.

Line-based parsing (rather than nested comma/semicolon delimiters) keeps the cell readable enough that a reviewer can check the `Facts` actually match the `Scenario` — a drafted scenario and its facts *can* diverge, and only the facts execute.

#### Validation

**Errors** (block validation): unknown `Rule ID` · unknown fact name (not declared in Sheet 7) · a value that doesn't typecheck against the fact's Sheet 7 `Type` · a malformed offset · an invalid `Expect` value.

**Warning** (does not block validation): a rule in Sheet 8 with no `FIRES` case, or no `NOT_FIRES` case, in Sheet 10. This is what makes "at least one positive and one negative case per rule" real rather than aspirational — a rule that always fires is as broken as one that never fires, and only the negative case catches it.

**`validate.js` only proves a case is well-formed** — the Rule ID exists, the fact names are declared, the values typecheck. It does not prove your `Expect` value is correct. That requires actually executing the case, covered next.

#### Execution — cases have real teeth, but not yet wired to every KB

Cases are not just documentation: `src/decision/rule-test-runner.ts` (`runRuleTest`) builds synthetic fact readings from a case's `Facts` observations, runs them through the real `rulePass` (the same evaluator a live check-in uses), and compares the outcome to `Expect`. It re-implements no evaluation logic.

**Today that runner only executes against a committed internal fixture** — `tests/fixtures/kb-sample.xlsx`, emitted as `src/decision/__tests__/fixtures/kb-sample.json` and run by `kb-contract.test.ts` (the Python↔TypeScript contract test). **It is not yet wired to run automatically against an arbitrary authored condition KB** (e.g. a freshly drafted `knowledge-base/v3/<slug>.xlsx`) — that wiring is out of scope for this plan and lands later.

So: a green `validate.js` run on a real condition KB is necessary but not sufficient. It does not confirm the scenario you wrote actually fires the rule the way you expect — for a newly authored KB, nothing currently does that automatically.

#### Scope

A Rule Tests case asserts whether **one rule** fires — nothing about merging, `INCOMPLETE`, or the overall `patient_action` outcome. That's whole-outcome behavior and belongs to the eval dataset, not here.

---

### Expression Language

Expressions in Sheet 8 Rules are typed boolean expressions over Sheet 7 Machine Names.

**Grammar (simplified):**
```
expr       = or_expr
or_expr    = and_expr (OR and_expr)*
and_expr   = not_expr (AND not_expr)*
not_expr   = NOT not_expr | primary
primary    = bool_call | comparison | ( expr ) | bool_fact
comparison = num_operand OP (num_operand | 'string')
```

**Operators:** `>=`, `<=`, `==`, `!=`, `>`, `<`

**Duration format:** integer + unit: `7d` (days), `48h` (hours), `2w` (weeks)

**Functions:**

| Function | Returns | Usage |
|----------|---------|-------|
| `delta(fact, window)` | number | Change in `fact` over `window` |
| `count(fact, window)` | number | Number of readings of `fact` in `window` |
| `sum(fact, window)` | number | Sum of numeric readings in `window` |
| `no_reading(fact, window)` | boolean | True if no reading received in `window` |
| `new_onset(fact, window)` | boolean | True if first reading of `fact` in `window` |
| `persists(ref, n, window)` | boolean | True if `ref` is true in at least `n` readings in `window` |
| `n_of(n, [ref1, ref2, ...])` | boolean | True if at least `n` of the listed conditions are true |

**Type rules:**
- `boolean` facts can be used bare in boolean context: `breathlessness AND edema`
- `number` facts must appear in a comparison: `weight >= 80`
- `categorical` facts support only `==` and `!=`: `mood == 'low'`
- `delta`, `count`, `sum` require `number` facts
- `no_reading`, `new_onset` accept any fact type
- `persists` accepts a bare `boolean` fact or a comparison

**Examples:**
```
weight >= 80
delta(weight, 48h) >= 2 AND (breathlessness OR edema)
no_reading(weight, 7d)
count(missed_drops, 7d) >= 3
persists(breathlessness, 3, 7d)
n_of(2, [redness, pain >= 5, swelling])
mood == 'low'
```

---

## Placeholder values

Use `—` (em dash) for intentionally empty optional cells. Do not leave required cells empty.
