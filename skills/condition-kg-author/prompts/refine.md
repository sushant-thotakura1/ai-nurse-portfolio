# Refine Prompt — Apply Expert Feedback

Follow these steps in order.

---

## Step 1 — Identify the target

Confirm which file is being refined. If not explicit, ask:
> "Which KB file should I update? (e.g. `knowledge-base/v3/keratoplasty.xlsx`)"

---

## Step 2 — Parse the feedback

Read the user's feedback. It may be:
- **Natural language**: "Change the Vascularisation symptom severity to Moderate" or "The posturing instruction for DSEK should say face-up for 2–3 days only"
- **Structured list**: explicit field-by-field changes
- **Attached file / pasted content**: expert's annotated notes
- **Track or Patient Action changes** (v3.2): "Add a chronic track variant of Phase I", "Change the Patient Action on RF_HF_001 to ER_NOW", "This instruction should say FACILITY_TODAY not NURSE_CALLBACK"

Translate the feedback into a concrete list of patches. Present them for confirmation before applying:

> I'll apply the following changes:
> - **Symptoms** | `SYM_KERAT_005` (Vascularisation) | Base Severity: High → **Moderate**, Severity Score: 2 → **1**
> - **Instructions** | `INS_KERAT_008` (Posturing) | Instruction Text: updated to "face-up for first 2–3 days only..."
>
> Correct? (yes / adjust)

Wait for confirmation.

---

## Step 3 — Look up IDs if needed

If the user's feedback references a symptom/instruction by name rather than ID, load the current sheet to find the correct ID:

```bash
node -e "
const XLSX = require('xlsx');
const wb = XLSX.readFile('knowledge-base/v3/<slug>.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Symptoms'], {header:1, defval:''});
rows.slice(4).forEach((r,i) => console.log(r[0], r[1]));
"
```

Confirm the ID before patching.

---

## Step 4 — Apply patches

Run:
```bash
node scripts/kg-tools/patch-by-id.js knowledge-base/v3/<slug>.xlsx '<patches-json>'
```

Where `<patches-json>` is a JSON array:
```json
[
  {
    "sheet": "Symptoms",
    "idColumn": "Symptom ID",
    "idValue": "SYM_KERAT_005",
    "updates": { "Base Severity": "Moderate", "Severity Score": 1 }
  },
  {
    "sheet": "Instructions",
    "idColumn": "Instruction ID",
    "idValue": "INS_KERAT_008",
    "updates": { "Instruction Text": "If you had DSEK or DMEK: lie flat face-up..." }
  }
]
```

---

## Step 5 — Inspect and validate

### 5a — Content inspection

After applying patches, run the content inspector to catch any issues the schema validator cannot see:

```bash
node scripts/kg-tools/inspect.js knowledge-base/v3/<slug>.xlsx --all
```

Fix any issues before proceeding:
- **Banned phrasing** in Instruction Text or Red Flag Context Notes → rewrite with decisive Patient Action language.
- **Patient Action missing** on Escalate?=Yes branches or Red Flags → patch with `patch-by-id.js`.
- **Broken question chain** (Next Q references non-existent ID) → patch the Next Q value.
- **Escalating branches** showing `FACILITY_TODAY` → confirm each is not life/limb/sight-threatening; promote to `ER_NOW` if needed.

### 5b — Schema validation

```bash
node scripts/kg-tools/validate.js knowledge-base/v3/<slug>.xlsx
```

If errors: fix them (via additional patches or by rewriting the affected rows) and re-run both 5a and 5b. Up to 3 rounds.

---

## Adding or Updating Sheets 7, 8, 9, and 10

When the SME wants to add clinical rules to an existing workbook:

1. **Add Sheet 7 (Facts)** — list every clinical signal the rules will reference. Validate with `validate.js` before authoring rules.

   > **Extraction Hint — hard constraint.** Describe only how patients *phrase* this fact:
   > synonyms, units, colloquialisms. **Never** mention a threshold, range, action, or why
   > it matters clinically. The hint goes verbatim into the extraction prompt, and perception
   > must stay blind to Sheet 8 (spec §8.4). If your hint contains a number that is a
   > threshold, or any word like "critical", "escalate", "watch for", or "important" — it is
   > wrong. Rewrite it as a description of language.
2. **Add Sheet 8 (Rules)** — author rules referencing only facts declared in Sheet 7. Run `validate.js` after each rule to get immediate feedback.
3. **Add Sheet 10 (Rule Tests) alongside every rule from step 2** — do not treat this as a later pass.

   **Every rule must ship with test cases in Sheet 10 — at least one FIRES and one
   NOT_FIRES.** A rule that always fires is as broken as one that never fires, and only
   the negative case catches it.

   Write the `Scenario` in plain clinical language — this is what the SME reads and judges.
   Write `Facts` as the observations that scenario implies. **They must agree**: only the
   Facts execute, so a scenario that says "gained 2 kg" alongside facts showing 1 kg is
   worse than no case at all.

   Prefer a NOT_FIRES case that is *close to the boundary* (1.8 kg where the rule needs 2)
   over an obviously-unrelated one — near-miss cases are what catch a threshold set wrong.

   See schema.md Sheet 10 section for the column list and Facts cell grammar.
4. **Add Sheet 9 (Settings)** — only if the SME wants non-default cadence or question limits. See schema.md Sheet 9 section for the XLSX column structure (two columns: `Setting` and `Value`).

> **Safety guardrail:** Never author a rule with `Action = REASSURE` unless the SME has explicitly asked for that downgrade. A wrong REASSURE suppresses an escalation; a wrong ESCALATE simply fails to match.

**Validating expressions:** `validate.js` will report expression parse errors and unknown fact references. Fix these before asking the SME to review — they should review clinical intent, not syntax.

`validate.js` also surfaces the Sheet 10 coverage warning (a rule missing a FIRES or NOT_FIRES case) and Sheet 10 errors (unknown Rule ID, unknown fact, type mismatch, malformed offset). Fix warnings by adding the missing case before asking the SME to review.

---

## Step 6 — Report

Confirm what changed:

```
✓ Patches applied and validated — 0 errors

Changes made:
- Symptoms | SYM_KERAT_005: Base Severity Moderate, Severity Score 1
- Instructions | INS_KERAT_008: Instruction text updated

knowledge-base/v3/keratoplasty.xlsx is ready for upload.
```
