# Claude Code: Incremental Parser Update for Unified Knowledge Base Schema

## Context

You are working on a nurse agent system that uses Excel-based knowledge base files (.xlsx) to generate knowledge graphs for clinical triage. The parser currently supports post-surgical conditions (CABG, Valve) and Heart Failure.

We are extending the system to support chronic conditions (Hypertension, Diabetes, CKD, COPD, Atrial Fibrillation) that have fundamentally different temporal models — no surgery, no fixed recovery arc, indefinite management, and patients who can cycle between stable and unstable phases.

**This is an incremental update to a large, tested codebase. Do NOT rewrite or regenerate existing code. Extend it.**

---

## Golden Rule: Backward Compatibility

**Every existing knowledge base file (CABG, Valve, HF, and any experimental files) must continue to parse and produce identical knowledge graphs after your changes.** All new columns and formats are optional and default to current behavior when omitted.

Before making any code changes:
1. Run the full existing test suite and confirm everything passes
2. Save the test output as your regression baseline
3. After each change, re-run the full suite to confirm no regressions

---

## Change 1: Accept 3 New Optional Columns in Conditions & Phases

### What to do

Add support for 3 new columns in the `Conditions & Phases` sheet. These columns may or may not be present. When absent, default to the values shown below.

| New Column | Valid Values | Default (if column missing or cell empty) |
|---|---|---|
| `Condition Type` | `episodic`, `chronic`, `hybrid` | `episodic` |
| `Trigger` | `surgery_date`, `discharge_date`, `enrollment_date`, `diagnosis_date`, or pipe-delimited combinations (e.g., `discharge_date \| enrollment_date`) | `surgery_date` |
| `Phase Model` | `linear`, `cyclical` | `linear` |

### How to implement

- In the parser module that reads the `Conditions & Phases` sheet, locate where column headers are mapped to indices.
- Add detection for the 3 new column headers. If a header is not found in the sheet, skip it and use the default value for all rows.
- If a header IS found but a specific row's cell is empty, use the default value for that row.
- Store these values in whatever data structure represents a condition-phase row (object, dict, struct, etc.) alongside the existing fields.
- **Do NOT rename or remove any existing columns.** The column previously called `Surgery Type` or `HF Classification` can remain as-is in existing files. Internally, you may normalize this to a generic field name like `classification` if it helps, but the parser must accept any column header string in that position.

### Validation rules

- `Condition Type` must be one of: `episodic`, `chronic`, `hybrid` (case-insensitive). Reject anything else with a clear error message.
- `Trigger` must contain only valid trigger names separated by `|` with optional whitespace. Valid names: `surgery_date`, `discharge_date`, `enrollment_date`, `diagnosis_date`. Reject unknown trigger names.
- `Phase Model` must be one of: `linear`, `cyclical` (case-insensitive). Reject anything else.

### Tests to add

- Test that existing CABG file parses identically (no new columns present → defaults applied).
- Test that HF file with the 3 new columns populated parses correctly.
- Test that a file with only some of the 3 new columns present works (partial presence).
- Test that invalid values in each new column produce clear validation errors.
- Test pipe-delimited Trigger values parse into a list of trigger types.

---

## Change 2: Flexible Day Range Format

### What to do

Modify the Day Range parser to accept 3 formats instead of 1.

| Format | Example | Meaning | Regex |
|---|---|---|---|
| `{start}–{end}` | `0–14`, `30-90` | Fixed window (current behavior) | `^\d+[\u2013\-]\d+$` |
| `{start}+` | `90+` | Open-ended: from start day onward, no end | `^\d+\+$` |
| `ongoing` | `ongoing` | Always active, no day calculation needed | `^ongoing$` (case-insensitive) |

### How to implement

- Locate the Day Range parsing function. It currently splits on `-` or `–` and expects two integers.
- Add two new branches BEFORE the existing split logic:
  1. Check if the value (trimmed, lowercased) equals `ongoing`. If so, set start_day = 0, end_day = infinity (or null/None with a flag indicating ongoing), and return.
  2. Check if the value ends with `+`. If so, strip the `+`, parse the remaining string as an integer (start_day), set end_day = infinity (or null/None with a flag indicating open-ended), and return.
  3. Fall through to existing logic for the `{start}–{end}` format.
- The phase determination logic (given days_since_event, which phase is the patient in?) needs to handle open-ended ranges: if end_day is infinity/null, then any day >= start_day matches this phase.
- For `ongoing`, the phase always matches regardless of days_since_event.

### Critical: phase ordering

When multiple phases could match (e.g., day 45 matches both `30–90` and `90+` if boundaries overlap), the parser should use the MOST SPECIFIC match — the narrowest range. If no overlap exists (which is the expected case), this is a non-issue. But add a guard: if a day falls into two phases, log a warning and pick the one with the higher start_day.

### Validation rules

- Start day must be a non-negative integer.
- For `{start}–{end}` format: end must be > start.
- For `{start}+` format: start must be a non-negative integer.
- Reject anything that doesn't match one of the 3 formats with a clear error listing the accepted formats.

### Tests to add

- Test `0–14`, `14–30`, `30–90` still work (regression).
- Test `90+` parses correctly with start_day=90 and open-ended flag.
- Test `ongoing` parses correctly.
- Test phase matching: day 100 matches `90+` but not `30–90`.
- Test phase matching: `ongoing` matches any day value.
- Test that `90–365+` is still rejected (it's not a valid format — only pure `{start}+` is accepted).
- Test that negative numbers, non-numeric values, and empty strings are rejected.

---

## Change 3: Remove Phase Name Whitelist

### What to do

The parser currently validates that phase names are one of `Phase I`, `Phase II`, `Phase III` (and possibly `Phase IV`). Remove this whitelist. Accept any non-empty string as a valid phase name.

### How to implement

- Locate the phase name validation logic. It likely has a list/set/array of allowed phase names.
- Replace the whitelist check with a simple non-empty check: the phase name must be a non-empty, non-whitespace string.
- **Keep the cross-sheet consistency validation.** Every phase name referenced in Symptoms, Assessment Questions, Red Flags, and Instructions must still exactly match a phase name defined in Conditions & Phases. This validation is critical and must NOT be removed.
- Update any error messages that reference specific phase names (e.g., "must be Phase I, Phase II, or Phase III") to instead say something like "must match a phase defined in the Conditions & Phases sheet."

### Tests to add

- Test that `Phase I`, `Phase II`, `Phase III` still work (regression).
- Test that custom names like `Initiation`, `Titration`, `Maintenance` are accepted.
- Test that a phase name referenced in Red Flags but NOT defined in Conditions & Phases still produces a validation error.
- Test that empty or whitespace-only phase names are rejected.

---

## Change 4: Cyclical Phase Re-Entry Logic

### What to do

Add logic to the knowledge graph traversal engine (not just the parser) that supports cyclical phase models. When a patient's condition has `Phase Model = cyclical`, the system should support resetting the patient's phase timeline when a new triggering event occurs (e.g., readmission).

### How to implement

This is the most nuanced change. It affects the runtime traversal, not just the parsing.

**Step 1: Store Phase Model in the knowledge graph.**
When the parser builds the knowledge graph from the Excel file, include the `Phase Model` value (`linear` or `cyclical`) as a property of the condition node.

**Step 2: Add a re-entry check to the traversal engine.**
In the traversal logic (where the agent determines the patient's current phase based on days since event):
- If `Phase Model = linear`: current behavior. Calculate days since the original trigger date and determine the phase. The patient can only move forward.
- If `Phase Model = cyclical`: same calculation, BUT the agent should also check if a newer trigger event exists. If the patient has a more recent discharge_date than the original one (i.e., they were readmitted), use the MOST RECENT trigger date for phase calculation.

**Step 3: Add re-entry to Scoring Logic traversal.**
In the Scoring Logic tab's traversal steps, add a new step (Step 0 or modify Step 1):
- "Read Condition Type, Trigger, and Phase Model from the condition node."
- "If Phase Model = cyclical, check for the most recent trigger event date before calculating days_since_event."

**Step 4: Surface the re-entry in the agent's behavior.**
When a cyclical re-entry is detected (patient was in Phase III but now has a new discharge_date that puts them back in Phase I), the agent should:
- Load the Phase I instruction set, symptom priorities, and red flags.
- Inform the clinical context that this is a re-entry (e.g., add a flag like `is_reentry: true` to the patient context).
- The agent can use this flag to adjust its dialogue (e.g., "Since your recent hospital stay, let's go through your current symptoms..." vs. first-time onboarding language).

### Important: do NOT auto-detect re-entry from symptom scores.

Re-entry should only happen when a NEW trigger event date is provided (e.g., a new discharge_date from a readmission). It should NOT happen automatically because a patient's symptom score hits ESCALATE. Escalation and re-entry are different:
- ESCALATE = tell the patient to contact their clinical team NOW.
- Re-entry = the clinical team has already intervened (hospitalization), and the patient is starting a new phase cycle.

### Tests to add

- Test linear phase model: patient at day 45 is in Phase II. Adding a newer trigger date does NOT change their phase (linear doesn't support re-entry).
- Test cyclical phase model: patient at day 100 (Phase III/Maintenance). A new discharge_date 3 days ago puts them in Phase I (day 3 of new cycle).
- Test cyclical with no new trigger: patient stays in their current phase as normal.
- Test that `is_reentry` flag is set correctly when a re-entry is detected.
- Test that the re-entry uses the correct trigger type (if condition has `discharge_date | enrollment_date`, a re-entry should use the new discharge_date, not enrollment_date).

---

## Change 5: Support Multiple Trigger Types

### What to do

Allow the `Trigger` column to contain pipe-delimited values (e.g., `discharge_date | enrollment_date`). The traversal engine should determine which trigger to use based on what's available in the patient context.

### How to implement

- Parse the Trigger field by splitting on `|` and trimming whitespace. Store as an ordered list.
- The order matters: the first trigger in the list is the PREFERRED trigger. Fall back to subsequent triggers if the preferred one is not available in the patient context.
- In the traversal engine, when calculating days_since_event:
  1. Iterate through the trigger list in order.
  2. For each trigger type, check if the patient context has a value for it (e.g., does the patient have a `discharge_date`?).
  3. Use the FIRST available trigger date.
  4. If NONE of the trigger dates are available, prompt the agent to collect the required date from the patient or clinical system. Do not proceed with phase calculation until a trigger date is available.

### For cyclical re-entry

When checking for re-entry (Change 4), the system should look for new dates in ALL trigger types, not just the first one. But prioritize: a new discharge_date (indicating readmission) takes precedence over a new enrollment_date.

### Tests to add

- Test single trigger value (`surgery_date`) works as before.
- Test pipe-delimited trigger: `discharge_date | enrollment_date` where discharge_date is available → uses discharge_date.
- Test pipe-delimited trigger: `discharge_date | enrollment_date` where only enrollment_date is available → falls back to enrollment_date.
- Test pipe-delimited trigger: neither date available → system prompts for date collection.
- Test cyclical re-entry with multiple triggers: new discharge_date takes precedence.

---

## Change 6: Update Validation Error Messages

### What to do

Review all existing validation error messages and update them to reflect the new flexibility. The goal is that when a provider uploads a knowledge base file and gets an error, the message is immediately actionable.

### Specific messages to update

| Current message (or similar) | Updated message |
|---|---|
| "Day Range must be in format {start}–{end} with plain integers" | "Day Range must be in one of these formats: {start}–{end} (e.g., 0–14), {start}+ (e.g., 90+), or 'ongoing'. Both start and end must be non-negative integers." |
| "Phase must be one of: Phase I, Phase II, Phase III" | "Phase name '{value}' in {sheet} sheet does not match any phase defined in the Conditions & Phases sheet. Defined phases are: {list of defined phases}." |
| "Invalid Surgery Type" or similar | "Invalid Classification value. This field accepts any condition-specific subtype (e.g., CABG, HFrEF, Type 2 DM)." |
| (new) | "Invalid Condition Type '{value}'. Must be one of: episodic, chronic, hybrid." |
| (new) | "Invalid Trigger '{value}'. Must be one or more of: surgery_date, discharge_date, enrollment_date, diagnosis_date (pipe-separated for multiple)." |
| (new) | "Invalid Phase Model '{value}'. Must be one of: linear, cyclical." |

### Tests to add

- Test that each new error message is produced for the corresponding invalid input.
- Test that the "Defined phases are: ..." message dynamically lists the actual phases from the file.

---

## Order of Implementation

Execute these changes in this order. Run the full test suite after each step.

1. **Change 3** (Remove Phase Name Whitelist) — smallest change, unblocks everything else.
2. **Change 2** (Flexible Day Range) — next smallest, no dependencies on other changes.
3. **Change 1** (3 New Columns) — adds the new fields that Changes 4 and 5 depend on.
4. **Change 5** (Multiple Trigger Types) — needed before Change 4.
5. **Change 4** (Cyclical Re-Entry) — most complex, depends on Changes 1, 3, and 5.
6. **Change 6** (Error Messages) — last, covers everything.

After all 6 changes: run the full test suite one final time and confirm zero regressions. Then run against the CABG, Valve, HF, and any experimental files to confirm they all still parse correctly.

---

## Test File Expectations

After your changes, the parser should handle ALL of these correctly:

**Existing files (must still work identically):**
- CABG knowledge base (no new columns, Phase I/II/III, day ranges like 0–7)
- Valve knowledge base (same structure as CABG)
- HF knowledge base (Phase I through Phase III, day ranges like 0–14, 90–365)

**New files (will be provided after parser update):**
- Hypertension: Condition Type = chronic, Trigger = enrollment_date, Phase Model = cyclical, phases named Initiation/Titration/Maintenance, Day Range includes 90+
- Type 2 Diabetes: Condition Type = chronic, Trigger = enrollment_date | diagnosis_date, Phase Model = cyclical, phases named Assessment/Stabilization/Optimization/Maintenance, Day Range includes 180+
- Updated HF: Condition Type = hybrid, Trigger = discharge_date | enrollment_date, Phase Model = cyclical, Day Range 90+ instead of 90–365

---

## What NOT to Do

- **Do NOT rewrite or regenerate existing modules.** Extend them.
- **Do NOT change the structure of the other 5 sheets** (Symptoms, Assessment Questions, Red Flags, Instructions, Scoring Logic). They remain unchanged. The only sheet with new columns is Conditions & Phases.
- **Do NOT change the Scoring Logic thresholds** (REASSURE ≤ 0, ADVISE 1–2, ESCALATE ≥ 3). These are universal.
- **Do NOT add any new required columns.** All 3 new columns are optional and default to episodic/surgery_date/linear when absent.
- **Do NOT break the knowledge graph output format.** Downstream consumers of the knowledge graph should not need changes. The new fields (Condition Type, Trigger, Phase Model) should be ADDED to condition nodes as new properties, not replace existing ones.
- **Do NOT remove any existing tests.** Only add new ones.
