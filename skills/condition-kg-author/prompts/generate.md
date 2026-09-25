# Generate Prompt — New KB

Follow these steps in order. Do not skip steps or batch them.

---

## Step 1 — Gather inputs

If the user has not provided both, ask for:

1. **Condition name** — the clinical procedure or disease (e.g. "Cataract Surgery", "Type 2 Diabetes")
2. **Context** — a brief description: what the condition is, typical patient profile, any specific care concerns. Even 2–3 sentences is enough. Mention any attached files if relevant.

Ask both together in a single message if either is missing. Do not proceed until you have both.

---

## Step 2 — Propose the KB structure

Using medical knowledge and the provided context, propose the KB structure. Present it in a readable format — NOT as raw JSON or YAML:

**Condition slug** (for the filename): e.g. `cataract-surgery`  
**ID slug** (for record IDs): e.g. `CATSURG` (3–6 uppercase letters)  
**Condition Type**: episodic / chronic / hybrid  
**Trigger**: which of the valid trigger events applies  
**Phase Model**: linear or cyclical (and why)  

**Classifications** (subtypes):
- Label: SHORT_LABEL — one-line description
- (repeat for each classification; if no meaningful subtypes exist, propose a single classification matching the condition name)

**Phases per classification** (or "all classifications share these phases" if uniform):
| Phase | Day Range | Focus |
|-------|-----------|-------|
| ... | ... | ... |

After presenting, ask:
> "Does this structure look right? Confirm or tell me what to change before I draft the full content."

Wait for explicit approval before proceeding.

---

## Step 3 — Draft full KB content

Once the structure is approved, draft all content. Work through each sheet in order:

### Symptoms (Sheet 2)
- Draft 8–15 symptoms relevant to the condition, classifications, and phases.
- For each, determine: Applicable Classifications, Applicable Phases, Base Severity, Severity Score, Phase Override (with detail if Yes), Clinical Notes.
- Reference `principles.md` for severity and override guidance.

### Assessment Questions (Sheet 3)
- For each symptom, write 2–4 branching questions.
- Questions must be voice-friendly (natural spoken language, no medical jargon). Do not reference "your discharge" or "after surgery" when the question applies to both episodic and chronic patients — use track-neutral phrasing ("as recommended", "as you have been doing").
- Wire `Next Q` values so each symptom chain terminates correctly (last question in chain has `Next Q = —`).
- Set `Risk Shift` and `Escalate?` values according to the scoring model in `principles.md`.
- **v3.2 required:** add `Patient Action A` and `Patient Action B` columns (after each `Escalate?` column). For every branch where `Escalate? = Yes`, set the corresponding `Patient Action`:
  - `ER_NOW`: life/limb/sight-threatening presentations (chest pain with radiation, loss of consciousness, breathlessness at rest, frothy sputum, sudden vision loss, etc.).
  - `FACILITY_TODAY`: all other escalating branches.
  - Non-escalating branches: `—`.

### Red Flags (Sheet 4)
- Draft 5–12 red flags covering the most clinically urgent presentations.
- Use `principles.md` for ESCALATE vs ADVISE and Urgency level guidance.
- Link to Symptom ID where applicable; use `—` for standalone red flags.
- **v3.2 required:** add `Patient Action` column between `Urgency` and `Context Note`. Required on every red flag row. `SELF_MONITOR` is not valid for red flags.
  - `Urgency = Immediate` → `ER_NOW`
  - `Urgency = Urgent` → `FACILITY_TODAY`
  - `Urgency = Routine` → `NURSE_CALLBACK`
- **v3.2 required:** `Context Note` must use decisive patient-facing language. No "contact your clinical team" or "tell your doctor". Commit to one of: "Go to the emergency room right now.", "Go to the clinic/hospital today.", or "Record this — your nurse will call you." See `principles.md` for the decisiveness rule.

### Instructions (Sheet 5)
- Draft 15–25 instructions covering the full phase timeline.
- Use all relevant categories: medication, monitoring, education are typically mandatory; add diet, exercise, sleep, other as appropriate.
- Write in plain patient language. No "contact your clinical team", "tell your doctor", or "seek medical attention" phrasing.
- For subtype-specific instructions (e.g. posturing for one surgical variant), set the correct `Applicable Classifications`.
- **v3.2 required:** add `Track` column after `Phase`. Use same values as Sheet 1: `episodic | chronic | hybrid`. For hybrid conditions, split Phase I/II instructions by track where content differs; use `Track = hybrid` for content that applies equally to both entry paths.
- **v3.2 required:** add `Patient Action` column after `Instruction Text`. Only required for threshold-type instructions (those with "if X happens…" language). Set to `—` for pure education or adherence instructions.
  - "If this happens, go to the hospital today" → `FACILITY_TODAY`
  - "If this happens, go to the emergency room" → `ER_NOW`
  - "If this happens, record it — your nurse will call you" → `NURSE_CALLBACK`

### Conditions & Phases (Sheet 1)
- Build the rows from the approved structure.
- **v3.2 required:** include the `Track` column between `Day Range` and `Focus`.
  - `episodic` conditions: all rows `Track = episodic`.
  - `chronic` conditions: all rows `Track = chronic`.
  - `hybrid` conditions: Phase I and Phase II need **two rows per classification** — one `Track = episodic` (event-triggered entry, e.g. post-discharge) and one `Track = chronic` (ambulatory enrolled). Later phases that have identical content for both entry paths use a single row with `Track = hybrid`.
- All required columns must be filled (no empty required cells).

### Scoring Logic (Sheet 6)
- Use the standard content exactly as specified in `schema.md`. Do not modify it.

---

## Authoring Sheets 7, 8, and 10 (Facts, Rules, and Rule Tests)

### Sheet 7 — Facts

For each clinical signal the SME wants to track, add a row in Sheet 7:
- Choose a `Machine Name` that is snake_case and uniquely identifies the measurement (e.g. `systolic_bp`, `medication_taken`, `breathlessness`)
- Set `Type` to `number` (for measured values), `boolean` (for yes/no symptoms), or `categorical` (for discrete states like mood)
- Set `Valid For` to how long a reading stays clinically relevant — 7d for most vitals, shorter for acute symptoms
- Mark as `Required = Yes` if the absence of this reading should trigger a check-in

> **Extraction Hint — hard constraint.** Describe only how patients *phrase* this fact:
> synonyms, units, colloquialisms. **Never** mention a threshold, range, action, or why
> it matters clinically. The hint goes verbatim into the extraction prompt, and perception
> must stay blind to Sheet 8 (spec §8.4). If your hint contains a number that is a
> threshold, or any word like "critical", "escalate", "watch for", or "important" — it is
> wrong. Rewrite it as a description of language.

### Sheet 8 — Rules

Rules connect Sheet 4 Red Flags to observable conditions. For each rule:
1. Reference an existing `Red Flag ID` from Sheet 4
2. Write an `Expression` using the expression language (see schema.md)
3. Choose an `Action`: `ESCALATE` (urgent), `ADVISE` (informational), `REASSURE` (downgrade)
4. If adding `no_reading` rules, give them the highest `Order` number in their Red Flag group

> **Safety guardrail:** Never author a rule with `Action = REASSURE` unless the SME has explicitly asked for that downgrade. Sheet 4 contains only `ESCALATE`/`ADVISE` flags, so there is no source material in the prose for a REASSURE rule — inventing one is the single way an ungated rule becomes unsafe, because a wrong downgrade fires and *suppresses* an escalation, whereas a wrong ESCALATE rule simply fails to match and falls through to the prose path.

### Sheet 10 — Rule Tests

**Every rule must ship with test cases in Sheet 10 — at least one FIRES and one
NOT_FIRES.** A rule that always fires is as broken as one that never fires, and only
the negative case catches it.

Write the `Scenario` in plain clinical language — this is what the SME reads and judges.
Write `Facts` as the observations that scenario implies. **They must agree**: only the
Facts execute, so a scenario that says "gained 2 kg" alongside facts showing 1 kg is
worse than no case at all.

Prefer a NOT_FIRES case that is *close to the boundary* (1.8 kg where the rule needs 2)
over an obviously-unrelated one — near-miss cases are what catch a threshold set wrong.

Draft cases immediately after each rule, not as a separate pass. See `schema.md` Sheet 10 for the column list and Facts cell grammar.

---

## Step 4 — Write the XLSX

Write a Node.js script inline (do not save it as a file) that:

1. Requires `xlsx` (already installed as a dev dep)
2. Builds all 6 sheets using `XLSX.utils.aoa_to_sheet()` following the row structure in `schema.md` (row 1=title, row 2=description, row 3=blank, row 4=header, row 5+=data)
3. Includes all v3.2 columns in the correct positions:
   - Sheet 1: `Track` between `Day Range` and `Focus`
   - Sheet 3: `Patient Action A` after `Escalate? A`; `Patient Action B` after `Escalate? B`
   - Sheet 4: `Patient Action` between `Urgency` and `Context Note`
   - Sheet 5: `Track` after `Phase`; `Patient Action` after `Instruction Text`
4. Writes to `knowledge-base/v3/<slug>.xlsx`

Run it with `node -e '<script>'` or by piping to `node`. Do NOT save a permanent `.js` file for the generated content — the XLSX is the artifact.

---

## Step 5 — Inspect and validate

### 5a — Content inspection

Run the content inspector **before** schema validation. It catches issues the parser cannot see.

```bash
node scripts/kg-tools/inspect.js knowledge-base/v3/<slug>.xlsx --all
```

The inspector runs four checks:

**Banned phrasing** — scans Instruction Text and Red Flag Context Notes for phrases like "contact your clinical team", "tell your doctor", "seek medical attention". Every flagged item must be rewritten using decisive Patient Action language (see `principles.md` decisiveness rule).

**Escalating branches** — lists every Assessment Question branch where `Escalate? = Yes`, showing the current Patient Action (`FACILITY_TODAY` or `ER_NOW`). Review each one:
- `ER_NOW` — correct for: sudden vision loss, severe chest pain, breathlessness at rest, loss of consciousness, frothy sputum, uncontrolled bleeding, severe eye pain with halos+nausea, signs of acute organ failure.
- `FACILITY_TODAY` — correct for all other escalating presentations.

To change a branch to `ER_NOW`:
```bash
node scripts/kg-tools/patch-by-id.js knowledge-base/v3/<slug>.xlsx \
  '[{"sheet":"Assessment Questions","idColumn":"Question ID","idValue":"Q_XXX","updates":{"Patient Action A":"ER_NOW"}}]'
```

**Question chain integrity** — verifies every `Next Q` value points to an existing Question ID. Any broken reference must be fixed before upload.

**Patient Action completeness** — verifies every `Escalate? = Yes` branch has a Patient Action value, every Red Flag has a Patient Action, and no Red Flag uses `SELF_MONITOR`.

Fix all issues flagged by the inspector before proceeding.

### 5b — Schema validation

```bash
node scripts/kg-tools/validate.js knowledge-base/v3/<slug>.xlsx
```

Parse the JSON output. If `valid: true` → proceed to Step 6.

If errors exist:
- Read each error carefully (tab, row, column, message).
- Fix by regenerating the affected rows in the XLSX (re-run the write step with corrections).
- Re-run both 5a and 5b after each fix.
- Repeat up to 3 rounds total.
- After 3 failed rounds, report remaining errors to the user with a clear explanation.

---

## Step 6 — Report

Show a completion summary:

```
✓ knowledge-base/v3/<slug>.xlsx — validated, 0 errors

Condition:        <name>
Classifications:  <list>
Phases:           <count> (<list of phase names>)
Symptoms:         <count>
Red flags:        <count>
Instructions:     <count>

Next step: review the file, then use refine mode to apply any changes.
```
