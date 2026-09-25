# Clinical & Schema Principles

## Engagement — "Felt need beats abstract need"

**Lead with what the patient is worried about; follow with what we want them to do.**

Patients (and providers) value risk detection and early intervention over preventive / behavioural content. Leading with adherence or lifestyle advice feels preachy and drives disengagement. Trust is earned by solving the patient's immediate concern first, then spent on behaviour change.

**Applies even for chronic asymptomatic conditions** (Glaucoma, Hypertension, Diabetes). It's tempting to load these KBs with adherence content because adherence drives outcomes — resist that temptation. Symptoms-first framing wins engagement; engagement earns the behaviour change.

**How to apply when drafting Symptoms:**
- **Clinical / risk-detection symptoms: 8–10 entries.** Drive triage volume. Own the ESCALATE paths. Examples: acute angle closure (for glaucoma), severe headache (for hypertension), severe hypoglycaemia (for diabetes). This is what providers trust and what patients call about.
- **Behavioural / adherence topics: 5–7 entries.** Sit alongside but do not lead. Examples: missed doses, running out of medication, side effects, cost/access barriers, "I feel fine so why take it?" beliefs.
- **ESCALATE goes to clinicians**; behavioural lapses escalate to counsellor outreach at most.

**Conversation opener** (inbound or outbound): "How are you feeling? Any changes or discomfort?" before "Have you been taking your medication?"

**Fear-appeal / disease education** belongs in the Instructions sheet (`category: education`), delivered at phase boundaries. That's proactive content, not triage — it doesn't compete with felt-need symptom handling.

---

## Terminology (non-negotiable)

- **Condition**: the disease or procedure name. Plain, human-readable (e.g. "Heart Failure", "Keratoplasty"). Never use `COND_` prefix or database ID synonyms.
- **Classification**: the clinical subtype within a condition (e.g. "HFrEF", "PKP"). Plain label. Never use `CLS_` prefix.
- Any field named something other than `Condition` or `Classification` for these concepts is wrong.

## ID naming convention

All IDs embed a short uppercase slug derived from the condition name (3–6 chars, letters only):

| Sheet | Format | Example (Heart Failure) |
|-------|--------|------------------------|
| Symptoms | `SYM_{SLUG}_{NNN}` | `SYM_HF_001` |
| Assessment Questions | `Q_{SLUG}_{NNN}` | `Q_HF_001` |
| Red Flags | `RF_{SLUG}_{NNN}` | `RF_HF_001` |
| Instructions | `INS_{SLUG}_{NNN}` | `INS_HF_001` |

Number sequentially from `001`. IDs must be unique within their sheet.

## Clinical conservatism

- Default to **ADVISE** for symptoms that are concerning but not immediately dangerous.
- Reserve **ESCALATE** for situations that are time-critical or life/sight/organ threatening.
- **REASSURE** when a symptom is an expected, normal part of recovery.
- When in doubt, ADVISE is safer than either extreme.

## Decisiveness (v3.2 — non-negotiable)

**Never use ambiguous doctor-visit language in patient-facing text.** Phrases like "contact your clinical team", "tell your doctor", "inform your doctor", "speak to your care team", or "seek medical attention" are banned from Instruction Text and Red Flag Context Notes. In many LMIC contexts patients cannot casually call a doctor — "tell your doctor" is heard as "go to the facility", which may not be the right action.

**Every action-triggering row must commit to one of four Patient Action values:**

| Patient Action | Use when | Patient-facing language |
|---|---|---|
| `ER_NOW` | Life/limb/sight-threatening. Cannot wait for a nurse call. | "Go to the emergency room right now. Do not wait." |
| `FACILITY_TODAY` | Urgent but not life-threatening. Needs same-day clinical assessment. | "Go to the clinic/hospital today." |
| `NURSE_CALLBACK` | Concerning but not urgent. Nurse will triage and decide next step. | "Record this. A nurse will call you within 24 hours. You do not need to travel yet." |
| `SELF_MONITOR` | Expected or low-severity. Home tracking is sufficient. | "This is expected. Keep tracking it at home." |

**Operational assumption:** a nurse monitors the daily log and proactively reaches out to every patient tagged `NURSE_CALLBACK`, `FACILITY_TODAY`, or `ER_NOW`. The KB does not need to tell the patient to initiate contact for `NURSE_CALLBACK` — that pull happens on the ops side.

**Red Flags cannot be `SELF_MONITOR`.** If it were self-monitorable, it wouldn't be a red flag.

**Instruction text pattern for threshold-type instructions:**

Good:
> "If you gain more than 1 kg in a day and also feel more breathless, go to the hospital today. If the weight changes without other symptoms, record it — your nurse will call you."

Bad:
> "Contact your clinical team immediately if you notice rapid weight gain." (ambiguous — doesn't tell the patient whether to travel or wait)

## Scoring model

| Outcome | Condition |
|---------|-----------|
| REASSURE | total score ≤ 0 |
| ADVISE | total score 1–2 |
| ESCALATE | total score ≥ 3 OR any question branch has `Escalate? = Yes` |

- **Base Severity** drives the starting score: Low=0, Moderate=1, High=2.
- **Risk Shift** values on question answers adjust the running score (+1, 0, -1).
- Do not set Base Severity=High and Risk Shifts=+1 on all branches — that will ESCALATE every presentation of that symptom regardless of patient responses.

## Elicitation model — Chief Complaint → HPI → Review of Systems

Every condition's conversation follows the same three-stage structure:
**Chief Complaint** (patient-led, open-ended) → **History of Present
Illness** (drill into what the patient raised, OPQRST-style) → **Review of
Systems** (a short, fixed, condition-specific safety sweep, asked every
session regardless of what was said). Full rationale, the OPQRST table, and
a worked example: [CONCEPTS.md §11](../../docs/superpowers/CONCEPTS.md#11-chief-complaint--hpi--review-of-systems--the-elicitation-model).

**How this affects authoring today:**

- **Assessment Questions (Sheet 3):** structure each symptom's question chain
  along OPQRST dimensions — onset, provocation/palliation, quality,
  region/radiation, severity, timing — not arbitrary follow-ups. `Next Q`
  chains should move through these in clinically sensible order, one
  dimension per question. This is what "avoid redundancy" below is really
  protecting against — two questions quietly probing the same dimension.
- **Symptoms (Sheet 2):** if a symptom functions as a mandatory safety
  screen — time-critical, and patients reliably don't volunteer it unprompted
  (e.g. early graft-rejection signs) — say so explicitly in `Clinical Notes`
  (e.g. "ROS item — ask every session regardless of chief complaint").
  **There is no dedicated schema column for this yet** — a screening flag is
  planned (tracked in issue #142) but not implemented. Do not invent a column
  for it; `Clinical Notes` is the interim signal until the schema catches up.
- **Escalation still wins.** None of this changes red-flag design below — a
  red flag firing mid-conversation short-circuits everything else,
  regardless of where the conversation currently is in CC/HPI/ROS.

## Symptom design

- 8–15 symptoms per condition is typical; fewer is better than padding.
- Each symptom needs at minimum 2 assessment questions.
- `Applicable Classifications`: use `ALL` unless a symptom is genuinely specific to one subtype.
- `Applicable Phases`: list only phases where the symptom is clinically relevant, comma-separated phase names.
- `Phase Override?`: `Yes` only when the recommended action changes meaningfully by phase (e.g., a symptom that is REASSURE in Phase I but ESCALATE in Phase III).
- If a symptom is a mandatory ROS screening item, mark it per "Elicitation model" above.

## Assessment question design

- Questions must be voice-friendly (read naturally as spoken language — no clinical jargon).
- Two-answer branching (A/B) only; do not add C/D options.
- `Next Q`: the Question ID to follow after this answer, or `—` if terminal.
- Avoid redundancy — do not ask the same thing twice in a symptom's question chain.
- Chain questions along OPQRST dimensions per "Elicitation model" above.

## Red flag design

- Red flags trigger ESCALATE regardless of score.
- Use only for presentations that cannot wait: severe pain, sudden vision loss, signs of rejection, anaphylaxis, etc.
- `Trigger Condition`: a concise clinical description of when the flag fires (e.g. "Pain score ≥ 8 and not relieved by prescribed analgesia").
- `Applicable Phases`: use `ALL` unless the flag is genuinely phase-specific.

## Instruction design

- Instructions must be written in plain patient language (not clinical language).
- Cover all relevant categories from the valid set: medication, monitoring, education, other are most common.
- `Issued At`: the phase name or "Discharge" / "All phases".
- `Replaces`: use `—` unless this instruction supersedes a prior one.
- Posture-specific or subtype-specific instructions must have the correct `Applicable Classifications` (not `ALL`).

## Phase design

- Phase names should be short and human-readable (e.g. "Phase I — Acute", "Stable", "Month 1–3").
- Day ranges: use `0–14` (fixed), `90+` (open-ended), or `ongoing`.
- `Focus` and `Review Point` are 1–2 sentence summaries; keep them clinical and concise.
- If all classifications share the same phases, define them once for each classification row (repeat the row).
