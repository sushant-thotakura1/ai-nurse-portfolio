---
name: pickup-work
description: Figure out what to work on next in this repo. Reads open GitHub issues and BACKLOG.md, checks for personal identity/role context (e.g. a local CLAUDE.local.md) to filter by suggested owner, and proposes a short prioritized plan. Invoked by trigger phrases such as "what should I work on", "what's next", "pick up work", "kickoff", or any request to start a session and be told what to do.
---

# pickup-work

Use this when a session is starting fresh and the user wants to know what to
work on, without specifying issue numbers or restating context by hand.

## Step 1 — Identify who's asking

Check whatever personal/local context is already loaded for this session
(e.g. a `CLAUDE.local.md` the user may have set up — see
[docs/guides/WORKING_WITH_CLAUDE.md](../../docs/guides/WORKING_WITH_CLAUDE.md)).
Look for a name or stated focus area (functional/design, non-functional/infra,
or implementation-only).

- If found, use it silently — don't ask the user to restate who they are.
- If not found, ask one question: "Who's picking this up, and what's your
  focus area — functional/design, infra/non-functional, or implementation?"
  Do not guess a role from the user's name or any other signal.

## Step 2 — Gather current state

1. Re-read [CLAUDE.md](../../CLAUDE.md)'s "Design Docs & Issues" section if it
   isn't already fresh in context.
2. `gh issue list --state open` — **all** open issues, not a hardcoded range.
   New issues will exist by the time this runs; don't assume the set from any
   prior session.
3. Read [BACKLOG.md](../../BACKLOG.md) for anything not yet turned into a
   tracked issue.
4. For any issue that looks relevant to the identified person, open it and
   follow its linked spec section before proposing it — never recommend work
   from the issue title alone.

## Step 3 — Filter and propose

Match issues to the person using the `functional`/`non-functional` and
`needs-design`/`spec-ready` labels, plus each issue's "Suggested owner" line:

- **Functional / design-capable person:** `needs-design` + `functional`
  issues first — that's where a judgment call is actually needed.
- **Non-functional / infra person:** `non-functional` issues; prefer
  `spec-ready` ones if this is their first pass at something unfamiliar.
- **Implementation-focused / less senior person:** `spec-ready` issues only.
  Do not propose a `needs-design` issue to someone whose role is
  implementation, even if nothing else is open — say so plainly instead of
  stretching the fit.

Present a short list — 3-5 items, not the whole backlog — and respect any
explicit blocking relationships between issues (e.g. "#146 is blocked by
#145").

## Step 4 — Before implementing anything

Once the user picks one, read its full issue body and linked spec section
end-to-end before writing any code. Don't start from the proposal summary
alone — it's a triage aid, not a substitute for the actual issue.
