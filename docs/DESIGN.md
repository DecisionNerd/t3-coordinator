# Design

This project is a coordination service, not a visual product. Consistency lives in **MCP tool naming**, **review vocabulary**, **docs/prompt handoffs**, and **operator-facing status language**—so the supervisor, humans, and workers share one contract.

Normative tool and state contracts: [`engineering/CONTRACTS.md`](engineering/CONTRACTS.md).

## Design Principles

- **Judgment vs mechanics** — A frontier-model supervisor decides; the coordinator remembers, waits, and recovers. Never blur those roles in tools or copy.
- **Classification ≠ planning** — `ClassifyGoal` scores catalog processes. It does not invent a plan or start workers. A plan appears first in `DesignExecutionGraph` inside a started process. A miss is `ProcessMapGap`, not “closest match.”
- **Supervisor is a role** — Fable, Astra, and later frontier models are interchangeable. Copy says “supervisor” or “frontier model,” not a single product name, unless giving an example.
- **Stock T3 is the face** — Desktop/phone experience stays T3; coordinator surfaces are tools and durable status, not a competing UI.
- **Evidence over narrative** — Deliveries and reviews speak in SHAs, tests, and verdicts—not “looks good” summaries alone. Processes consume and produce typed artifacts; worker chat never classifies failure.
- **Fail closed and stay stopped** — Cancel/pause must be obvious and durable; recovery must not resurrect stopped work. Recovery is catalog `onFail`, not a retrospective or supervisor improvisation.
- **Small tool surface** — Prefer a few domain tools over exposing raw T3 orchestration commands. No “write me a plan” tool. On `StepFailed`, the supervisor may signal only `allowedNext`.
- **Slice before policy** — Do not design GraphForge-specific gravity into v0 UX.
- **Workflow is editable** — Operators change process via profile, prompts, **process catalog files**, and repo overlays ([experience/OPERATING-PROFILE.md](experience/OPERATING-PROFILE.md)); MCP and Temporal stay the durable handoff layer. Changing a process does not require a coordinator release.

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
  - **Mailbox** — queued supervisor follow-up; not an open MCP wait. Delivery follow-ups are SHA-bound; failure follow-ups are class-bound (`StepFailed`).
  - **Process catalog** — file-defined DAGs with required `onFail`. The engine walks both; it does not improvise recovery.
  - **`StepFailure` / `ProcessMapGap`** — typed terminal events. Say the `failureClass`, not “the worker had trouble.”
  - **allowedNext** — closed set the supervisor may signal on escalate: `retry_same`, `retry_role`, `block`, `cancel`.
- **Writing rules:** Tool descriptions state side effects and idempotency expectations. Status messages name assignment ID, commit SHA, and blocker in one line when possible. Examples may say “e.g. Fable” — requirements must not.

## Visual And Content Style

Visual UI is **not applicable** (T3 owns the client UI). For docs and generated artifacts:

- Prefer Mermaid for architecture and sequence flows.
- Tables for tool contracts and state authorities.
- No decorative dashboards in docs; keep operator runbooks procedural.

## Interaction Patterns

Operator journeys: [`experience/DX-PATHS.md`](experience/DX-PATHS.md). Setup: [`experience/QUICKSTART.md`](experience/QUICKSTART.md). Project + optional craft helpers: [`experience/TESTBED.md`](experience/TESTBED.md). Personalize the loop: [`experience/OPERATING-PROFILE.md`](experience/OPERATING-PROFILE.md).

- **MCP:** Assignment returns a durable ID immediately; long builds are Temporal workflows, not open MCP RPCs.

**Dual DX** (phrase → engine):

| Phrase | What happens |
|---|---|
| `192` / `complete M5` / `complete epic 50` | Skip classify. Instantiate **ImplementSlice** (existing assign path, writing `ImplementationArtifact` + `VerificationEvidence` / `StepFailure`). |
| Empty / `next` | Orient (goals + backlog). Include **blocked/failed process instances** in the brief. |
| Freeform goal | **ClassifyGoal only.** Return scored candidates. Do not invent a plan. Do not start workers. |
| `start <processId>` (after classify) | Instantiate that process against the current repo + `UserGoal`. |
| `retry` / `block` / `cancel` on a failed instance | Signal one of `allowedNext`. Invalid if the catalog did not list it. |

- **Spec first:** No assign without a committed spec SHA.
- **Mailbox:** Every terminal (delivery **or** `StepFailure`) enqueues exactly one follow-up; send `thread.turn.start` only when T3 shows that thread idle. T3 will **queue** a message if we send during a live turn — that is a bug in us, not a T3 refuse. `get_work_status` / `next` / `sitrep` show the failed step even if the mailbox is unread.
- **Review loop:** REVISE continues the **same** worker until the revision cap, then `blocked`; BLOCKED pauses for human/supervisor resolution; ACCEPT advances to authorized integration checks only (v1).
- **Pause vs cancel:** Pause lets in-flight independent work finish (no new dispatch); cancel races the in-flight wait and interrupts immediately; cancelled work stays dead across restart.
- **Model pick:** Workers = quality/cost-per-task Pareto among T3-runnable models. Reviewers = frontier model when T3 has one runnable. Sticky `defaults.json` is not a pick. See [`engineering/MODEL-SELECTION.md`](engineering/MODEL-SELECTION.md).
- **Errors:** Prefer named `failureClass` values (auth, `provider_unavailable`, `usage_exhausted`, `process_map_gap`, duplicate suppressed, missing spec SHA) over opaque failures.
- **Motion:** None.

## Components And Patterns

| Component / pattern | Use it for | Notes / source |
|---|---|---|
| `run` classify / `start <processId>` | Catalog selection vs instantiation | Classify does not start workers |
| `assign_work` / ImplementSlice | Start scoped worker assignment | Spec SHA + supervisor thread required; `192` shortcut |
| `get_work_status` / `get_delivery` | Progress, artifact heads, failed steps | SHA-bound delivery; class-bound failure; include `allowedNext` |
| `submit_review` | ACCEPT / REVISE / BLOCKED | Supervisor only; deliverySha must match |
| `pause_work` / `cancel_work` | Stop further dispatch | Distinct semantics; survive restart; cancel interrupts wait |
| Isolated worktree | Parallel workers | Via T3; not shared checkout |
| Follow-up mailbox | Unattended review **and** failure wake | CONTRACTS.md; exactly one per terminal |
| Process catalog + `onFail` | DAG and recovery | Files under `templates/processes/` + overlays |
| `SelectWorkerModel` | Rank ∩ T3 runnable | [`MODEL-SELECTION.md`](engineering/MODEL-SELECTION.md) |
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
- [`engineering/MODEL-SELECTION.md`](engineering/MODEL-SELECTION.md)
- Source conversation: [Codex share](https://chatgpt.com/s/cx_6a9c1a34fedc8191ab31c610eaaabed4)
- Red team: [`.redteam/reviews/coordinator-docs-review.md`](../.redteam/reviews/coordinator-docs-review.md)
