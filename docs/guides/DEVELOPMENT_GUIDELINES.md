# Development Guidelines

Process and workflow guidance for the AI Nurse project. These guidelines were established through
hands-on development and team discussion. Add new sections as patterns emerge.

---

## 1. When to Use the `/brainstorming` Skill

The `/brainstorming` skill triggers **full spec-driven development**: it explores requirements,
produces a design spec, and drives implementation via TDD with unit tests. It produces
higher-quality, better-tested code but takes significantly longer than a direct implementation.
Use it deliberately.

### Use it when mistakes are expensive

| Situation | Why brainstorming is worth it |
|---|---|
| Core clinical logic | Risk scoring, assessment extraction, consent handling — bugs here have patient safety implications |
| Multi-tenant data isolation | A mistake leaks one tenant's data to another |
| State machine changes | The call/message flow state machines — an incorrect transition has cascading effects |
| New domain features | Anything a clinician or patient directly depends on |
| Design still open | Multiple valid approaches exist and the wrong choice is expensive to undo |

### Skip it when mistakes are cheap

| Situation | Why direct implementation is fine |
|---|---|
| Instrumentation and observability | If tracing is wrong, fix and redeploy — nothing breaks for patients |
| Config changes | Environment variables, connection strings, feature flags |
| Isolated utilities | A formatter, normaliser, or helper with no downstream clinical impact |
| Design already settled | When the conversation itself produced the spec — repeating the exercise adds little |
| Mechanical changes | Renaming, moving files, adding a config value, fixing a typo |

### The deciding question

> *Would a bug in this code harm a patient, expose data, or corrupt clinical records?*

- **Yes** — use `/brainstorming`. Get the full spec-driven cycle with tests written first.
- **No** — implement directly. Still write tests, but skip the ceremony.

### Real example

Adding Arize session tracing (SpanProcessor + named parent spans) did **not** need
`/brainstorming`. The design was fully resolved through a conversation covering trade-offs,
the Arize recommendation, and the final approach before a line of code was written.
The implementation scope was clear, the risk was low (observability only), and the design
conversation itself served as the brainstorm. A `/brainstorming` invocation at that point
would have replayed work already done.

By contrast, adding a new clinical risk scorer or changing consent-handling logic **would**
warrant `/brainstorming` — the stakes are high and the design space is non-trivial.

---

*Add new sections below as additional guidelines are established.*
