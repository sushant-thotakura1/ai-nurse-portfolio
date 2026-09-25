# Working With Claude on This Repo — Issues, Specs, and Context Handoff

**Audience:** anyone on the team picking up work tracked as a GitHub issue in
this repo, especially when using Claude Code to implement it.

## Why this changed

We used to track design decisions and task lists in one growing markdown doc.
That works solo; it doesn't support assigning work across a team or tracking
status. So we split it:

- **Design rationale** — why we decided something, root causes, trade-offs —
  lives in versioned docs under [`docs/specs/*.md`](../specs/), reviewed via
  PR, same as code.
- **Status** — who owns it, what's done, what's next — lives in
  [GitHub issues](https://github.com/REAN-Foundation/ai-nurse-poc/issues).

The full convention is codified in [`CLAUDE.md`](../../CLAUDE.md) at the repo
root, under "Design Docs & Issues" — that file is git-tracked, so it's
identical on every laptop the moment you check out a branch. This doc is a
walkthrough of what that convention means in practice; `CLAUDE.md` is the
source of truth if the two ever disagree.

**For branching and PR process:** follow `CLAUDE.md`'s "Branching" section
(`develop` is the integration branch; `main` auto-deploys to non-prod, never
target it directly). `CONTRIBUTING.md` now points at the same section rather
than duplicating it, so the two won't drift apart again.

## What makes an issue usable

Every issue in this repo should be self-sufficient: readable cold, without
digging through chat history or asking the person who filed it. Concretely,
each one includes:

- A link to the **specific spec section** it implements (not just the doc).
- A **2-3 sentence restatement** of the why — you shouldn't have to click
  through just to understand the point.
- **Acceptance criteria** — a concrete "done" state.

Live examples: [#139](https://github.com/REAN-Foundation/ai-nurse-poc/issues/139)
is a tracking issue with a checklist of child issues
([#140](https://github.com/REAN-Foundation/ai-nurse-poc/issues/140),
[#141](https://github.com/REAN-Foundation/ai-nurse-poc/issues/141),
[#142](https://github.com/REAN-Foundation/ai-nurse-poc/issues/142));
[#143](https://github.com/REAN-Foundation/ai-nurse-poc/issues/143)–[#146](https://github.com/REAN-Foundation/ai-nurse-poc/issues/146)
are standalone. Use any one of them as a template when writing a new issue.

### Labels

| Label | Meaning |
|---|---|
| `functional` | Product / clinical behavior |
| `non-functional` | Infrastructure, platform, harness |
| `needs-design` | Still requires a judgment call — not ready to implement |
| `spec-ready` | Fully specified — safe to implement directly |

Use these to route work: `needs-design` issues need someone who can make the
call; `spec-ready` issues need someone who can execute a written plan.

## Starting a fresh session

Don't hand-assemble a kickoff prompt. Just ask, in your own words — "what
should I work on next?", "pick up work", "kickoff" — and it routes to the
[`pickup-work`](../../skills/pickup-work/SKILL.md) skill via `CLAUDE.md`'s
Skills table, which is loaded automatically before you type anything, so
there's no file you need to already know about to trigger this. It reads the
open issues, `BACKLOG.md`, and (if you've set one up — see below) your
personal `CLAUDE.local.md` to know your focus area, then proposes a short,
prioritized list filtered to what actually fits you.

**Set up your own `CLAUDE.local.md` once** so this works without you typing
anything: create `CLAUDE.local.md` at the repo root, exclude it from git via
`.git/info/exclude` (never commit it — it's personal to your machine, same
pattern as any per-developer account/environment notes), and state your name
and focus area in one line, e.g. `I'm Sushant — infra/non-functional work.`
It loads automatically every session on that machine. If you use more than
one machine, set it up on each — it doesn't travel with you, same as nothing
else in a Claude session does (see below).

## How to pick up an issue

1. Read the issue top to bottom — it should explain what and why without
   outside help.
2. Follow the link to the spec section for full rationale before writing any
   code. The issue is a summary, not the source.
3. If it's `spec-ready`, the plan is already decided — implement it. If you
   hit a real design fork the issue doesn't answer, stop and flag it (comment
   on the issue, tag whoever owns that decision area) rather than deciding it
   solo.
4. If it's `needs-design`, it isn't ready for implementation — that decision
   needs to be made first.

## Why the issue has to carry everything — read this before you start

**Claude's memory of a conversation lives only on the machine it ran on.**
If one person has a long conversation with Claude about why a decision was
made, that reasoning is not automatically available to Claude on anyone
else's machine — even for the exact same issue, even for the same person on
a different laptop. Claude doesn't "know" what was discussed unless it's
written down somewhere it can read fresh: the repo.

Concretely:

- **Don't assume Claude "remembers" a decision** just because it was
  discussed at some point, by someone, somewhere. If it isn't in the spec
  doc or the issue body, a fresh Claude session has never seen it.
- **When starting work on an issue, point your Claude session at the issue
  and its linked spec section first.** Don't just say "implement issue
  #142" — paste or open the actual content so it isn't guessing.
- **If you or your Claude session make a real decision while working** — a
  design call, a scope change, something that contradicts what the issue
  originally said — write it down in the repo before moving on: update the
  issue body, leave a PR comment, or propose an edit to the spec doc if it's
  substantial rationale. If it only lives in your terminal scrollback, it's
  invisible to your teammates, and to your own Claude session next week.
- **Before closing an issue**, make sure its acceptance criteria reflect
  what actually happened, not just the original plan. The next reader —
  teammate or a future Claude session — shouldn't have to reconstruct what
  changed.

One thing you don't need to do: sync any config by hand. `CLAUDE.md` already
travels with the repo — nothing to keep in sync manually; git does that part.
What doesn't travel is a conversation that only happened in one person's
terminal.

## For status tracking (PM / leads)

A tracking issue like [#139](https://github.com/REAN-Foundation/ai-nurse-poc/issues/139)
renders its child checklist as a progress bar automatically on GitHub.
Filtering the issue list by `functional`/`non-functional` gives a quick read
on where effort is going without opening each issue individually.
