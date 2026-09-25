---
name: condition-kg-author
description: Generate or refine a v3.2 clinical knowledge base (KB) for a medical condition. Invoked by name: "Use the condition-kg-author skill" or "/condition-kg-author". Mode is inferred from context — generation if starting fresh, refinement if an existing XLSX path is provided or expert feedback is being applied.
---

# condition-kg-author

Read `principles.md` and `schema.md` from this skill folder before doing any work. They are authoritative — schema.md defines valid field values, principles.md defines clinical reasoning rules. Do not rely on memory.

## Mode detection

- **Generate**: user provides a condition name and/or description, no existing KB mentioned → follow `prompts/generate.md`
- **Refine**: user references an existing XLSX file or describes changes to apply to one → follow `prompts/refine.md`

If the mode is ambiguous, ask one clarifying question: "Are you starting a new KB or refining an existing one?"

## Output location

All generated KBs land in `knowledge-base/v3/<condition-slug>.xlsx` where `<condition-slug>` is the condition name lowercased with spaces replaced by hyphens (e.g., "Heart Failure" → `heart-failure.xlsx`).

## Validation

Every write — generate or refine — must pass validation before reporting success:

```bash
node scripts/kg-tools/validate.js knowledge-base/v3/<slug>.xlsx
```

If validation fails, fix all errors and re-validate. Repeat up to 3 rounds. If errors persist after 3 rounds, report the remaining errors to the user with a clear diagnosis rather than continuing to loop.

## Completion criteria

Only report the task as complete when:
1. `knowledge-base/v3/<slug>.xlsx` exists
2. Validation passes with zero errors
3. A brief summary is shown: condition, classifications, phase count, symptom count, red flag count, instruction count
