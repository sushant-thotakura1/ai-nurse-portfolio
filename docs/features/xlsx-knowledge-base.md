# Feature: XLSX Knowledge Base → JSON Knowledge Graph Generator

## Context

We have a medical voice assistant backend that performs post-operative patient risk stratification. Doctors maintain clinical protocols in structured `.xlsx` spreadsheets. This feature reads those spreadsheets and outputs a JSON knowledge graph that the LLM consumes at runtime for triage decisions.

The spreadsheet is the single source of truth. The JSON is a build artifact — never manually edited.

---

## What to Build

A Python module (or set of functions) that:

1. **Parses** a structured `.xlsx` file with 6 tabs: `Conditions & Phases`, `Symptoms`, `Assessment Questions`, `Red Flags`, `Instructions`, `Scoring Logic`.
2. **Validates** every row against the schema — catches missing IDs, broken cross-references (e.g., a question referencing a non-existent symptom ID), invalid severity values, orphaned questions with no symptom parent, and duplicate IDs.
3. **Generates** a single JSON knowledge graph file with typed entities, explicit relationships, scoring thresholds, and a traversal algorithm the LLM can follow.
4. **Reports** validation errors in a structured format (list of `{tab, row, column, error}`) so they can be surfaced back to the doctor or logged.

---

## Spreadsheet Schema

The `.xlsx` has these tabs and columns. Parse by **column header name**, not position — doctors may reorder columns.

### Tab: `Conditions & Phases`
- `Condition ID` — string, e.g., `COND_001`
- `Condition Name` — string
- `Surgery Type` — string, e.g., `CABG`, `VALVE`
- `Phase` — string: `Phase I`, `Phase II`, `Phase III`, or `—`
- `Day Range` — string, e.g., `0–7`, `7–30`, `30–90`
- `Focus` — string
- `Review Point` — string
- `Sheet Version` — string: `v1`, `v2`, `v3`
- `V1 Scope` — string: `Yes` or starts with `No`
- `Notes` — string (optional)

### Tab: `Symptoms`
- `Symptom ID` — string, e.g., `SYM_001`
- `Symptom Name` — string
- `Condition ID` — string: `ALL` or a specific condition ID from Tab 1
- `Applicable Phases` — comma-separated string, e.g., `Phase I, Phase II`
- `Base Severity` — string: `Low`, `Moderate`, `High`
- `Severity Score` — integer: 0, 1, or 2
- `Phase Override?` — string: `YES` or `No`
- `Override Detail` — string (required if Phase Override = YES)
- `Clinical Notes` — string (optional)

### Tab: `Assessment Questions`
- `Question ID` — string, e.g., `Q_001`
- `Symptom ID` — string, must exist in Symptoms tab
- `Order` — integer, sequence within a symptom's question set
- `Question Text (voice prompt)` — string, the exact text the voice assistant speaks
- `Answer A (label)` — string
- `Risk Shift A` — integer (can be negative)
- `Escalate? A` — string: `YES` or `No`
- `Answer B (label)` — string
- `Risk Shift B` — integer
- `Escalate? B` — string: `YES` or `No`
- `Next Q` — string: another Question ID or `—` (terminal)
- `Notes for Doctor` — string (optional, not included in JSON output)

### Tab: `Red Flags`
- `Red Flag ID` — string, e.g., `RF_001`
- `Symptom ID` — string, must exist in Symptoms tab (or `—` for standalone flags)
- `Trigger Condition` — string, free text describing when this fires
- `Applicable Phases` — string
- `Action` — string: `ESCALATE`, `ADVISE / ESCALATE`, etc.
- `Urgency` — string: `Immediate`, `Urgent`, `Moderate`
- `Context Note` — string (optional)
- `Clinical Rationale` — string

### Tab: `Instructions`
- `Instruction ID` — string, e.g., `INS_001`
- `Phase` — string
- `Category` — string: `Diet`, `Activity`, `Wound Care`, `Medication`, `Monitoring`, etc.
- `Instruction Text` — string
- `Issued At` — string
- `Replaces` — string: another Instruction ID, or `—`
- `Notes` — string (optional)

### Tab: `Scoring Logic`
This tab is a reference for the scoring model. Parse the rows with `Parameter` starting with `Threshold:` to extract the three action thresholds and their score ranges. Parse rows starting with `Traversal:` to extract the step-by-step algorithm.

---

## Output JSON Schema

Generate a JSON object with this structure:

```json
{
  "meta": {
    "source_file": "<filename>",
    "generated_at": "<ISO 8601 timestamp>",
    "version": "<derived from source or auto-increment>",
    "conditions_included": ["CABG", "VALVE"],
    "conditions_deferred": ["PAEDIATRIC", "THORACIC"],
    "required_inputs": ["surgery_type", "surgery_date"]
  },

  "conditions": {
    "<surgery_type>": {
      "name": "<full name>",
      "phases": {
        "PHASE_I":  { "day_range": [0, 7],  "focus": "...", "review": "...", "instruction_sheet": "v1" },
        "PHASE_II": { "day_range": [7, 30], "focus": "...", "review": "...", "instruction_sheet": "v2" },
        "PHASE_III":{ "day_range": [30,90], "focus": "...", "review": "...", "instruction_sheet": "v3" }
      }
    }
  },

  "symptoms": {
    "<symptom_id>": {
      "name": "...",
      "applicable_phases": ["PHASE_I", "PHASE_II"],
      "base_severity": "moderate",
      "severity_score": 1,
      "phase_override": null | {
        "PHASE_I": { "action": "REASSURE", "note": "..." },
        "PHASE_III": { "action": "ESCALATE", "note": "..." }
      },
      "assessment_questions": [
        {
          "id": "Q_001",
          "order": 1,
          "prompt": "...",
          "branches": {
            "A": { "label": "...", "risk_shift": -1, "escalate": false, "next": "Q_002" },
            "B": { "label": "...", "risk_shift": 2,  "escalate": true,  "next": null }
          }
        }
      ],
      "notes": "..."
    }
  },

  "red_flags": [
    {
      "id": "RF_001",
      "symptom_id": "SYM_001",
      "trigger": "...",
      "applicable_phases": ["PHASE_I", "PHASE_II", "PHASE_III"],
      "action": "ESCALATE",
      "urgency": "immediate",
      "context_note": "...",
      "rationale": "..."
    }
  ],

  "instructions": {
    "PHASE_I": [
      { "id": "INS_001", "category": "diet", "text": "...", "replaces": null, "notes": "..." }
    ],
    "PHASE_II": [...],
    "PHASE_III": [...]
  },

  "scoring": {
    "thresholds": {
      "REASSURE": { "max_score": 0, "action": "Reassure patient. Symptom expected at this phase." },
      "ADVISE":   { "min_score": 1, "max_score": 2, "action": "Provide guidance. Monitor. Follow up." },
      "ESCALATE": { "min_score": 3, "action": "Red flag. Contact clinical team immediately." }
    },
    "rules": {
      "escalate_override": "Any question branch with escalate=true → immediately ESCALATE regardless of score.",
      "phase_override": "If symptom has phase_override for current phase, use that action directly before scoring."
    }
  },

  "traversal": [
    "Collect surgery_type and surgery_date",
    "Calculate days_since_surgery → determine current phase",
    "Load phase-appropriate instructions and red flag thresholds",
    "Match reported symptom to symptoms registry",
    "Check phase_override — if exists for current phase, return that action",
    "Otherwise, initialize score = severity_score",
    "Walk assessment_questions in order, apply risk_shift from patient answers",
    "If any branch has escalate=true, immediately return ESCALATE",
    "Sum score → compare to thresholds → return action (REASSURE / ADVISE / ESCALATE)"
  ]
}
```

---

## Validation Rules

Flag an error for each of these:

- **Missing required columns** — any tab missing an expected column header
- **Duplicate IDs** — same Symptom ID, Question ID, etc. appearing more than once
- **Broken references** — a Question's `Symptom ID` not found in the Symptoms tab; a `Next Q` value not found in Questions tab; an Instruction's `Replaces` ID not found
- **Invalid severity** — `Base Severity` not in `{Low, Moderate, High}` or `Severity Score` not in `{0, 1, 2}`
- **Missing phase override detail** — `Phase Override? = YES` but `Override Detail` is empty
- **Orphaned questions** — questions referencing a symptom that has no entry in the Symptoms tab
- **Order gaps** — questions for the same symptom have non-sequential order values (e.g., 1, 3 — missing 2)
- **Empty voice prompts** — `Question Text` is blank (LLM will have nothing to say)

Return errors as:
```json
{
  "valid": false,
  "error_count": 3,
  "errors": [
    { "tab": "Assessment Questions", "row": 7, "column": "Symptom ID", "error": "References SYM_099 which does not exist in Symptoms tab" },
    ...
  ]
}
```

---

## Integration Notes

- This runs as part of the backend build/deploy pipeline — or as an on-demand endpoint
- Input: `.xlsx` file path or uploaded file buffer
- Output: JSON string (or written to file) + validation report
- Use `openpyxl` for parsing (read-only mode for performance)
- Parse by column header name, not index — doctors may insert columns
- Normalize phase strings: `Phase I` → `PHASE_I`, `Phase II` → `PHASE_II`, `Phase III` → `PHASE_III`
- Normalize severity: `Low` → 0, `Moderate` → 1, `High` → 2 (verify against Severity Score column)
- Parse day ranges: `0–7` → `[0, 7]` (handle both `–` en-dash and `-` hyphen)
- Strip whitespace from all cell values
- Ignore rows where the ID column is empty (spacer rows in spreadsheet)
- The `Notes for Doctor` column in Assessment Questions is intentionally excluded from JSON output — it's doctor-facing only
- The generated JSON should be deterministic — same input always produces same output (sort keys, stable ordering)