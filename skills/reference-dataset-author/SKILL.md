# Reference Dataset Author Skill

Generates a reference dataset (readable.csv + dataset.csv) for Arize evaluation experiments,
covering the full classification × phase × flag_path matrix for a condition.

## Prerequisites

1. Docker stack must be running (`docker compose up -d`). The backend container has the correct
   Prisma binary, Node runtime, and DB connectivity — always run generation inside it.
2. `OPENAI_API_KEY` must be set in the backend container (it is, via `docker-compose.yml`).
3. Know the tenant UUID — query it if unsure:
   ```bash
   docker exec ainurse-postgres psql -U ainurse -d ainurse \
     -c "SELECT id, name FROM tenants;"
   ```

## Usage

**Always run inside the backend container.** The host machine uses an ARM64 Prisma binary that
cannot connect to the database — running `ts-node` on the host will fail with a Prisma engine error.

```bash
# Full condition — all classifications
docker exec ainurse-backend npx ts-node src/eval/generate-dataset.ts \
  --condition keratoplasty \
  --tenant-id <tenant-uuid> \
  --overwrite

# Single classification only
docker exec ainurse-backend npx ts-node src/eval/generate-dataset.ts \
  --condition keratoplasty \
  --classification DALK \
  --tenant-id <tenant-uuid> \
  --overwrite
```

> **Fallback (no Docker):** If the stack is down and you need to generate offline, export the
> active KG JSON from the admin portal (Knowledge Graphs → Export JSON) and use `--kg-file`:
> ```bash
> OPENAI_API_KEY=sk-... npx ts-node src/eval/generate-dataset.ts \
>   --condition keratoplasty \
>   --kg-file exports/keratoplasty.json \
>   --overwrite
> ```
> This is the exception, not the rule.

## Core principle: eval must use the same code as channels

Every callable in `src/eval/callables.ts` **must delegate to the same production service or
function used by the live channels** — never reimplement the logic independently.

| Callable | Production path it must call |
|---|---|
| `runGreeting` | `generateGreeting()` from `messaging/bot-flows/greeting-copy.ts` |
| `runTurn` | `generateTurnResponse()` from `ai-agent/clinical/turn-response.ts` |
| `computeAssessment` | `TranscriptAssessmentService` from `ai-agent/clinical/transcript-assessment.service.ts` |

If you find a callable reimplementing logic that already exists in a channel service, that is
a bug. Extract the shared logic and have both paths call it.

## Assessment pipeline

Each generated scenario runs the full transcript through `TranscriptAssessmentService`
(`ClinicalEventExtractor` → `RiskScorer`) — the same pipeline used by WhatsApp session closing.
Assessment rows will correctly reflect risk levels (REASSURE / ADVISE / ESCALATE) based on
the scenario's symptom content.

## Output

```
reference-dataset/generated/
  {condition}/
    {classification}/
      readable.csv   — for SME review; expected as human-readable text
      dataset.csv    — for experiment runner; expected as JSON, includes history/transcript
```

## Reviewing the output

Open `readable.csv` in a spreadsheet. Rows marked `needs_review = true` need a human to
validate the `expected` field before running experiments. Greeting and assessment rows are
pre-drafted from the KG (`needs_review = false`). Turn rows always need review.

Assign the readable.csv to a reviewer via the Reviewer Portal.

## `--overwrite` flag

Required if output files already exist. This is intentional — silently overwriting a
previously reviewed dataset would orphan existing reviewer feedback.
