# KB Smoke Test Scenarios

These scenarios are used to automatically verify that each knowledge base produces the correct clinical outcome for a representative set of patient responses. All scenarios currently pass.

Experts are asked to review whether the **expected outcome** is clinically appropriate for the described patient presentation.

---

## How to read this table

- **Trigger** — the date used to calculate how far the patient is into their care journey (e.g. 3 days post-discharge, 3 days post-diagnosis).
- **Patient responses** — a simplified description of the answer path taken through the assessment questions (e.g. "breathless at rest" = patient chose the more severe answer on the breathlessness question).
- **Expected outcome** — what the system should recommend: `ESCALATE` (urgent action needed), `ADVISE` (non-urgent guidance), or `REASSURE` (no immediate concern).
- **Track** — whether the patient entered via an acute event (`episodic`, e.g. post-discharge) or as a long-term enrolled patient (`chronic`).
- **Phase** — the care phase the patient is in, derived from how many days have passed since their trigger date.

---

## Heart Failure

| # | Days since trigger | Trigger type | Patient presentation | Expected outcome | Track | Phase |
|---|-------------------|--------------|----------------------|-----------------|-------|-------|
| 1 | 3 | Discharge date | Reports breathlessness **at rest** | ESCALATE | Episodic | Phase I (episodic) |
| 2 | 3 | Discharge date | Has been checking weight daily; gained **≥1 kg in a day** with new swelling and breathlessness | ESCALATE | Episodic | Phase I (episodic) |
| 3 | 3 | Enrolment date | Reports breathlessness **at rest** | ESCALATE | Chronic | Phase I (chronic) |
| 4 | 180 | Enrolment date | Mood low but **not severely impaired**, no change in symptoms, functioning reasonably well | REASSURE | Chronic | Hybrid phase (episodic and chronic tracks have converged) |

---

## Cardiac Surgery (CABG)

| # | Days since trigger | Trigger type | Patient presentation | Expected outcome | Track | Phase |
|---|-------------------|--------------|----------------------|-----------------|-------|-------|
| 5 | 3 | Surgery date | Reports breathlessness **at rest** | ESCALATE | Episodic | Phase I |
| 6 | 3 | Surgery date | Wound pain present but **mild, no redness, no fever, no discharge** | REASSURE | Episodic | Phase I |

---

## Glaucoma

| # | Days since trigger | Trigger type | Patient presentation | Expected outcome | Track | Phase |
|---|-------------------|--------------|----------------------|-----------------|-------|-------|
| 7 | 3 | Diagnosis date | Reports **cannot see at all / sudden complete vision loss** | ESCALATE | Chronic | Initiation |
| 8 | 3 | Diagnosis date | Reports **running low on or out of eye drops** | ESCALATE | Chronic | Initiation |

---

## Keratoplasty (PKP)

| # | Days since trigger | Trigger type | Patient presentation | Expected outcome | Track | Phase |
|---|-------------------|--------------|----------------------|-----------------|-------|-------|
| 9 | 3 | Surgery date | Reports **sudden or significant vision loss** | ESCALATE | Episodic | Phase I |
| 10 | 3 | Surgery date | Reports **watering / tearing**, mild, no pain, no vision change | REASSURE | Episodic | Phase I |

---

## Notes for reviewers

1. Scenarios 1, 3, 5, 7, 9 test the most severe branch of each primary symptom — the system should escalate immediately.
2. Scenarios 6, 10 test the low-risk all-clear path — the system should reassure.
3. Scenario 4 specifically tests that a patient enrolled for 180 days is placed in the correct long-term (hybrid) phase, not the acute post-event phase.
4. Scenario 8 (running out of eye drops) escalates because non-adherence to glaucoma drops carries a real risk of pressure spike and vision loss — please confirm this severity is appropriate.
5. If any expected outcome should be different, please note the scenario number and the correct outcome.
