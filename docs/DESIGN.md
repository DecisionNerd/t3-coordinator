# Design

This project is a coordination service, not a visual product. Consistency lives in **MCP tool naming**, **review vocabulary**, **docs/prompt handoffs**, and **operator-facing status language**—so the supervisor, humans, and workers share one contract.

Normative tool and state contracts: [`engineering/CONTRACTS.md`](engineering/CONTRACTS.md).

## Design Principles

- **Judgment vs mechanics** — A frontier-model supervisor decides; the coordinator remembers, waits, and recovers. Never blur those roles in tools or copy.
- **Supervisor is a role** — Fable, Astra, and later frontier models are interchangeable. Copy says “supervisor” or “frontier model,” not a single product name, unless giving an example.
- **Stock T3 is the face** — Desktop/phone experience stays T3; coordinator surfaces are tools and durable status, not a competing UI.
- **Evidence over narrative** — Deliveries and reviews speak in SHAs, tests, and verdicts—not “looks good” summaries alone.
- **Fail closed and stay stopped** — Cancel/pause must be obvious and durable; recovery must not resurrect stopped work.
- **Small tool surface** — Prefer a few domain tools over exposing raw T3 orchestration commands.
- **Slice before policy** — Do not design GraphForge-specific gravity into v0 UX.

## Design tool context

Use [`PRODUCT.md`](PRODUCT.md) for intent and [`engineering/ARCHITECTURE.md`](engineering/ARCHITECTURE.md) for structure. Critique MCP tools and handoff prompts against the principles above. There is no Figma/Storybook source of truth.

## Brand And Voice

- **Tone:** Precise, operational, non-theatrical. Prefer “assignment,” “delivery,” “revise,” “paused” over agent-marketing language.
- **Terminology:**
  - **Coordinator** — this service (durable mechanics).
  - **Supervisor** — frontier-model session (Fable, Astra, etc.).
  - **Frontier model** — the class of supervisor models; not a vendor lock.
  - **Worker** — Composer, GLM, or similar implementation session.
  - **ACCEPT / REVISE / BLOCKED** — only review vocabulary for `submit_review`.
  - **ACCEPT ≠ merge** — say “accepted for integration” when needed.
  - **Mailbox** — queued supervisor follow-up; not an open MCP wait.
- **Writing rules:** Tool descriptions state side effects and idempotency expectations. Status messages name assignment ID, commit SHA, and blocker in one line when possible. Examples may say “e.g. Fable” — requirements must not.

## Visual And Content Style

Visual UI is **not applicable** (T3 owns the client UI). For docs and generated artifacts:

- Prefer Mermaid for architecture and sequence flows.
- Tables for tool contracts and state authorities.
- No decorative dashboards in docs; keep operator runbooks procedural.

## Interaction Patterns

Operator journeys (design → plan → worker → review; milestone campaigns; single-issue loops): [`experience/DX-PATHS.md`](experience/DX-PATHS.md). Setup: [`experience/QUICKSTART.md`](experience/QUICKSTART.md). SDLC pairings (DocSlime / RedTeam / Impeccable + `dev-skills` testbed): [`experience/TESTBED.md`](experience/TESTBED.md).

- **MCP:** Assignment returns a durable ID immediately; long builds are Temporal workflows, not open MCP RPCs.
- **Spec first:** No assign without a committed spec SHA.
- **Mailbox:** Delivery enqueues one follow-up; send `thread.turn.start` only when T3 shows that thread idle. T3 will **queue** a message if we send during a live turn — that is a bug in us, not a T3 refuse.
- **Review loop:** REVISE continues the same worker; BLOCKED pauses for human/supervisor resolution; ACCEPT advances to authorized integration checks only (v1).
- **Pause vs cancel:** Pause lets in-flight finish; cancel stops or quarantines and stays dead across restart.
- **Errors:** Prefer actionable blockers (auth, duplicate suppressed, capacity deferred, missing spec SHA) over opaque failures.
- **Motion:** None.

## Components And Patterns

| Component / pattern | Use it for | Notes / source |
|---|---|---|
| `assign_work` | Start scoped worker assignment | Spec SHA + supervisor thread required |
| `get_work_status` / `get_delivery` | Progress and evidence | SHA-bound |
| `submit_review` | ACCEPT / REVISE / BLOCKED | Supervisor only; deliverySha must match |
| `pause_work` / `cancel_work` | Stop further dispatch | Distinct semantics; survive restart |
| Isolated worktree | Parallel workers | Via T3; not shared checkout |
| Follow-up mailbox | Unattended review wake | CONTRACTS.md |
| Vertical-slice gate | Before parallelism/policy | TESTING.md |

## Accessibility

- Tool and status text must be readable in T3 and terminal logs without relying on color alone.
- Prefer stable IDs in messages so phone/desktop operators can correlate the same assignment.

## References

- [`PRODUCT.md`](PRODUCT.md)
- [`REQUIREMENTS.md`](REQUIREMENTS.md)
- [`engineering/CONTRACTS.md`](engineering/CONTRACTS.md)
- [`engineering/ARCHITECTURE.md`](engineering/ARCHITECTURE.md)
- [`engineering/T3-INTEGRATION.md`](engineering/T3-INTEGRATION.md)
- Source conversation: [Codex share](https://chatgpt.com/s/cx_6a9c1a34fedc8191ab31c610eaaabed4)
- Red team: [`.redteam/reviews/coordinator-docs-review.md`](../.redteam/reviews/coordinator-docs-review.md)
