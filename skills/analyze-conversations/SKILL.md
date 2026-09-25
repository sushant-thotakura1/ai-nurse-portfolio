---
name: analyze-conversations
description: Fetch a filtered, redacted batch of real patient conversations from the admin API and analyze them against the codebase using Claude Code, with an option to draft a GitHub issue from what's found. Invoked by trigger phrases such as "analyze conversations for <condition>", "let's look at conversations where...", "fetch conversations for analysis", or any request to bulk-fetch and analyze real patient conversations.
---

# analyze-conversations

Use this when a developer wants to inspect real patient conversations for
patterns, bugs, or clinical-quality issues, using Claude Code's own reasoning
against the codebase instead of a separate, billed analysis pipeline. See
[docs/specs/2026-08-26-conversation-analysis-skill-design.md](../../docs/specs/2026-08-26-conversation-analysis-skill-design.md)
for the full design.

## Scope — analysis only, no code changes

This skill is an **analysis tool only**. While following it, do not edit,
refactor, or otherwise change any application, script, or config code — not
even a "quick fix" for something the conversations reveal. The only writes
this skill produces are the exported conversation JSON (Step 3) and, with
explicit confirmation, a GitHub issue (Step 5). Anything that warrants a code
change is captured as an issue and handled as separate work on its own branch.

## Step 0 — One-time setup (skip if already done)

Check whether `.claude/conversation-analysis.local.json` exists. If not, tell
the developer to copy `scripts/conversation-analysis.local.example.json` to
that path and fill in their admin email, password, and the API base URL of
whichever backend they actually want to analyze — a locally running one
(`http://localhost:3000/v1/api`) or a deployed server (e.g. a non-prod/staging
URL). There is no default; ask which one they mean if it isn't obvious from
context. That path is gitignored — `.claude/` is ignored wholesale except
`.claude/commands/` — so it's never committed. Do not proceed until it exists.

## Step 1 — Resolve the tenant (not skippable)

Run `npx ts-node scripts/fetch-conversations.ts --list-tenants` and show the
developer the result. Ask which tenant to use. Unlike the filters below,
tenant has no "skip" option — the export endpoint's URL always requires one
(`/v1/api/:tenantId/calls/export`), so if the developer doesn't have a
preference, just ask them to pick one from the list. The chosen slug is also
needed for `--list-conditions` in Step 2.

## Step 2 — Resolve filters, one at a time, skip-able

If the developer already knows exactly which conversation(s) they want,
skip the questions below entirely and use `--session=<id>` instead
(comma-separated for more than one) — this targets specific conversations
by ID and satisfies the "at least one filter" requirement on its own. The
ID can be either the `CallSession.id` or the `messageSessionId` copied from
the admin Call Logs page's "Session ID" column — the export endpoint matches
on both.

Otherwise, ask, one question at a time, for:

- **Condition** (or skip) — first run
  `npx ts-node scripts/fetch-conversations.ts --list-conditions --tenant=<slug>`
  and show the developer the list it prints. They pick one **verbatim**, and
  you pass that exact string to `--condition=`. The export endpoint matches
  `--condition` exactly and case-sensitively, so never re-case it, snake_case
  it, or paraphrase it (`Heart Failure`, not `heart_failure`). If the
  developer wants a condition that is not in the printed list, it has no
  active knowledge graph and almost certainly no conversations — tell them
  that and get explicit confirmation before passing it, rather than running a
  guaranteed-empty query. If `--list-conditions` prints nothing, tell the
  developer condition filtering is unavailable for this tenant and move on to
  the other filters.
- **Date range** (from / to, `YYYY-MM-DD`) — or skip either or both
- **Outcome** — one of `ESCALATE`, `REASSURE`, `ADVISE`, or `IN_PROGRESS`
  (`IN_PROGRESS` means no outcome has been recorded for the conversation
  yet) — or skip
- **Channel** — `WHATSAPP_CHAT` or `VOICE` — or skip

Skipping a question means "no filter on that dimension." **But at least one
filter (or `--session`) must end up set** — the export endpoint rejects a
request with none of them (the script itself also checks this and will exit
with a clear message if you try to run it with zero filters). If the
developer skips everything and has no session ID either, tell them plainly
that at least one is required and ask again rather than silently picking a
default date range on their behalf.

## Step 3 — Run the script

Run `npx ts-node scripts/fetch-conversations.ts --tenant=<slug>` plus
whichever of `--condition=`, `--from=`, `--to=`, `--outcome=`, `--channel=`,
`--session=` were resolved in Step 2. Relay its final output line (either the
"0 results" message, or "Wrote N conversation(s) to <path>") to the developer
verbatim.

## Step 4 — Analyze

If conversations were written, tell the developer where (the folder path
from Step 3's output) and that they're already redacted (patient name/phone
stripped). From here, this is ordinary conversation — read the files, read
the relevant code paths, and reason about whatever the developer asks about
(a specific conversation, a pattern across several, whether an escalation
rule fired correctly, etc.). There is no separate "analysis mode" — just use
your normal file-reading and code-search tools against the exported JSON and
the codebase. Reading code is expected; changing it is not — see "Scope"
above. If the analysis points to a fix, note it for the Step 5 issue instead
of editing anything.

## Step 5 — Offer to report an issue

Once the developer indicates they're done analyzing (or the conversation
naturally wraps up), ask: **"Did this surface a real issue worth tracking?"**

If yes:
1. Draft a GitHub issue following this repo's convention (see `CLAUDE.md`'s
   "Design Docs & Issues" section): a 2-3 sentence restatement of the why,
   concrete acceptance criteria, and the correct `functional`/`non-functional`
   plus `needs-design`/`spec-ready` labels for what was found.
2. **Content rule, based on how many conversations were flagged:**
   - **One conversation** — quote that conversation's (already-redacted)
     transcript directly in the issue body.
   - **Multiple conversations** — do not dump every transcript. Write a
     synthesized summary of the common pattern/root cause (how many
     conversations, date range, redacted session IDs for traceability).
   - Either way, anything quoted stays redacted — never re-introduce a raw
     patient name or phone number into the issue body, even if it's sitting
     unredacted somewhere else in a file you read during analysis.
3. **Show the full drafted issue body to the developer and wait for explicit
   confirmation before running `gh issue create`.** Never post automatically
   — this matches how issue creation is always a confirm-first action.
4. Once confirmed, run `gh issue create --title "..." --body "..."` (or
   `--body-file` for anything long/multi-line) and share the resulting issue
   URL.

If no: nothing further to do — just wrap up normally.
