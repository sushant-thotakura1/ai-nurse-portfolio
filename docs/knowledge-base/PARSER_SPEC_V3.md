# Knowledge Base Parser Spec — v3 (Superseded, do not use)

**⚠️ Deprecated 2026-08-24.** This document describes the KB schema as it
existed at a single commit in April 2026 — v3, before v3.1 or v3.2 — and was
never updated afterward. It does not reflect the current schema.

**Current spec:** [skills/condition-kg-author/schema.md](../../skills/condition-kg-author/schema.md)
— covers the full v3.2 schema (all ten sheets, including Facts/Rules/Settings/
Rule Tests, plus the Track and Patient Action columns), and is the document
`scripts/generate-knowledge-graph.py` actually implements today. It's also
what the `condition-kg-author` skill reads before every KB generation or
refinement — if a doc and this skill ever disagree, `schema.md` wins.

**What changed since this file was written, for anyone trying to reconcile
old references against it:**

- **ID scheme.** This file documents `COND_*`/`CLS_*` prefixed IDs for
  Condition and Classification. That scheme is explicitly rejected by current
  convention — see [docs/principles.md](../principles.md) §1: Condition and
  Classification are plain, human-readable labels now, with no ID fields at
  all.
- **v3.1** unified terminology down to exactly two clinical concepts
  (Condition, Classification).
- **v3.2** added the Track and Patient Action columns.
- **Sheets 7–10** (Facts, Rules, Settings, Rule Tests) — the KB-authored
  content that drives the deterministic decision engine — did not exist when
  this file was written and are not covered here at all.

This file is kept in place (rather than deleted) only so that old links —
including, until recently, `scripts/generate-knowledge-graph.py`'s own
docstring — don't dead-end. The original v3-era content has been removed to
avoid anyone skimming past this notice and trusting stale schema; see git
history on this file for the original text if it's ever needed for
archaeology.
