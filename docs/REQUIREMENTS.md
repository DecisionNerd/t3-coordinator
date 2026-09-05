# Requirements

These requirements define the coordinator’s delivery contract: durable multi-agent engineering coordination around stock T3, with a **frontier-model supervisor** (Fable, Astra, or equivalent) and implementation workers (Composer, GLM, and similar). Outcomes are verified repository work, not session volume.

**v0** is the only ship gate until the vertical slice is proven on live T3. **v1** is policy and must not block the slice.

Tool schemas, state machine, mailbox, and reconciliation: [`engineering/CONTRACTS.md`](engineering/CONTRACTS.md).

## Functional requirements — v0 (slice)

| ID | Requirement | Derived from | Acceptance behavior |
|---|---|---|---|
| FR-1 | The system shall expose MCP tools so a supervisor can assign work, inspect status, fetch delivery evidence, submit review decisions, pause/resume work, and cancel work. | Product goals; supervisor control surface | Given a frontier-model supervisor with coordinator MCP and a durable supervisor binding for the environment, when it calls `assign_work` with a committed spec SHA, then a durable assignment ID is returned promptly without holding the MCP call open for the full worker lifetime. |
| FR-2 | The system shall dispatch worker sessions through stock T3 with an explicit provider instance/model and isolated worktree. | T3-native architecture | Given a valid assignment, when the coordinator dispatches, then a T3 worker thread is created/started for the selected instance in a dedicated worktree—not the shared project checkout. |
| FR-3 | The system shall record delivery only when worktree git HEAD differs from `baseCommit` and the tip commit contains `Coordinated-By: <assignmentId>`. | Evidence-bound acceptance | Given the worker turn has left `running`, when `observeWorktreeDelivery` finds a matching trailer commit, then state becomes `delivered` with that SHA; worker chat text alone never advances state. After grace with no match → `blocked`. |
| FR-4 | The system shall enqueue exactly one supervisor follow-up when delivery is recorded, and send it only when the bound supervisor thread is idle per T3 turn/session/queued-start/raised-hand. | Unattended continuation; mailbox | Given delivery is recorded and the bound thread is idle, when the mailbox sends, then exactly one `thread.turn.start` uses the persisted command id. Composer-draft-without-turn is not detectable and may still receive a follow-up (documented limitation). |
| FR-5 | The system shall recover interrupted workflows without duplicating workers or supervisor messages. | Restart durability | Given the coordinator is killed after dispatch, when it restarts, then it adopts the existing worker (same command/thread IDs) and does not launch a second worker or send a duplicate follow-up. |
| FR-6 | The system shall distinguish pause, resume, and cancel, and keep them durable across restarts. | Explicit stop semantics | **Pause:** no new dispatch; in-flight may finish; mailbox deferred. **Resume:** clears pause and flushes deferred follow-up if delivered. **Cancel:** interrupt/quarantine; no auto-continuation after restart. |
| FR-10 | The system shall grant coordinator MCP tools only on the dedicated supervisor provider instance; worker instances shall not load those tools. | Permission boundary | Given a worker instance MCP config, when it lists tools, then assign/cancel/dispatch tools are absent. v0 spike uses Codex (or frontier) for supervisor and OpenCode/Cursor for workers. |
| FR-11 | The system shall identify the supervisor by environment binding (`environmentId` + bound `supervisorThreadId`), not by a hardcoded model product name. | Frontier-model role | Given Fable or Astra on the bound supervisor instance, when it assigns work, then the same MCP contract and mailbox apply. Internal label `frontier` is not a T3 wire enum. |
| FR-12 | The system shall resolve `supervisorThreadId` from an operator-established durable binding, not from model-invented ids. | Control-plane identity | Given a binding exists, when `assign_work` omits `supervisorThreadId`, then the binding is used; a mismatched override is rejected. |

## Functional requirements — v1 (policy)

Deferred until the v0 gate in [`TESTING.md`](engineering/TESTING.md) passes.

| ID | Requirement | Derived from | Acceptance behavior |
|---|---|---|---|
| FR-7 | The system shall expose existing issues, PRs, and unfinished coordinated work to the supervisor before new implementation is launched. Enforcement in code is v1; v0 may return read-only context only. | GraphForge/XYG operating model | Given open unfinished PRs, when the supervisor requests next work, then triage/repair/integration context is visible; dispatch of additional implementation may be deferred when policy is enabled. |
| FR-8 | The system shall route verified CI/review failures back to the owning worker assignment. | Delivery loop | Given CI fails on a delivery commit, when the coordinator observes the failure, then the owning assignment receives revision context rather than a silent accept. |
| FR-9 | The system shall enforce concurrency against review/integration backlog and host build capacity, not a fixed hard PR count. | Capacity heuristic | Given review backlog is saturated, when new implementation is requested, then dispatch is deferred or refused. |

## Non-functional requirements

| ID | Quality attribute | Target / constraint | Phase | Why it matters |
|---|---|---|---|---|
| NFR-1 | Durability | Workflow state survives coordinator process death and host reboot. Slice may use Temporal’s dev persistence; production uses Temporal + PostgreSQL (ADR-0002). | v0 logic / v1 ops | Unattended remote development. |
| NFR-2 | Idempotency | External side effects (T3 launches, follow-ups) use stable IDs and reconcile-before-retry. GitHub writes are v1 and stay read-only until then. | v0 | Prevents duplicate workers/messages. |
| NFR-3 | Compatibility | Integrates with stock T3 via authenticated API; no T3 fork or direct DB writes. | v0 | Preserve desktop/phone/Connect workflow. |
| NFR-4 | Security | Dedicated coordinator credentials; fail closed on incompatible T3 version or revoked auth; workers lack dispatch scope; allowed repos and concurrency caps. | v0 | Shared ubuntu account is not a security boundary. |
| NFR-5 | Operability | Runs as ubuntu on OVHC-AGENCY; phone access remains via T3 Connect. | v0 | Matches existing remote setup. |
| NFR-6 | Maintainability | Version-sensitive T3 behavior isolated in one adapter module. | v0 | T3 is not a public extension SDK. |
| NFR-7 | Model portability | Supervisor tools and mailbox do not depend on a single frontier-model product name. | v0 | Fable, Astra, and successors are interchangeable in the role. |

## Behavior trace (v0 gate)

| Requirement | Given | When | Then |
|---|---|---|---|
| FR-2 + FR-5 | Supervisor assigned one GLM task; coordinator killed immediately after dispatch | Coordinator restarts and reconciles | Same worker adopted; no second launch |
| FR-3 + FR-4 | Worker turn ended; worktree HEAD has `Coordinated-By` trailer; bound supervisor thread idle | Coordinator observes git and mailbox | Exactly one follow-up queued/sent to the **bound** thread with SHAs |
| FR-3 grace | Turn ended; HEAD still `baseCommit` for full grace | Grace expires | State `blocked` with `no_delivery` |
| FR-6 | Assignment cancelled | Restart + completion events arrive | No new dispatch; workflow remains cancelled |
| FR-12 | Binding present; assign omits thread id | assign_work | Uses bound thread; mismatch override rejected |

## Constraints & assumptions

- **Constraint:** T3 stays stock; extend via API/MCP only.
- **Constraint:** Production Temporal persistence uses vanilla PostgreSQL (not Turso/SQLite). Slice may use Temporal dev server.
- **Constraint:** Acceptance does not auto-merge.
- **Constraint:** No dispatch without a committed specification SHA and a durable supervisor binding for the environment.
- **Constraint:** v0 uses Temporal (`AssignmentWorkflow`); production Postgres is ADR-0002, not a slice blocker.
- **Assumption:** T3 `thread.turn.start` + `bootstrap.prepareWorktree` and command receipts work on the **installed OVHC T3 version** (pinned in T3-INTEGRATION.md).
- **Assumption:** Supervisor instance loads coordinator MCP from **that provider’s native config**, not from T3’s `/mcp`; workers do not share that config.
- **Assumption:** Existing GitHub, CI, and benchmark controllers remain authoritative; the coordinator invokes and records them in v1 rather than reimplementing certification logic.

## Dependencies

- Stock T3 Code server and Connect relay on OVHC-AGENCY.
- Temporal (dev server for slice; PostgreSQL-backed for production) and official MCP TypeScript SDK.
- Provider CLIs behind T3: frontier models (Fable, Astra, …), Cursor/Composer, OpenCode/GLM (Z.AI Coding Plan).
- GitHub issues/PRs/CI for GraphForge, XYG, and related repos (read-only in v0).

## Open questions

- Dedicated environment pairing for the coordinator (`orchestration:operate` + `read`) on OVHC — owner: integration spike.
- Whether the supervisor provider instance can load our MCP without worker instances inheriting it — owner: MCP coupling test.
- SubscribeThread vs snapshot polling behind T3 Connect — owner: mailbox spike.
- `prepareWorktree` cost/isolation on GraphForge-scale repos — owner: first real delivery after slice.
- Cross-repo dependency scheduling depth for GraphForge↔XYG — owner: v1 after vertical slice.
