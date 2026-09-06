# Architecture

**t3-coordinator** is a TypeScript service that provides durable engineering coordination around unmodified T3 Code. Temporal owns workflow durability; an MCP server exposes domain tools to a **frontier-model supervisor** (Fable, Astra, or equivalent); a narrow T3 adapter creates, observes, and resumes provider sessions. The human surface remains T3 desktop/phone/Connect.

The coordinator brain is a **file-based process catalog**: classify a goal, instantiate one `ProcessInstanceWorkflow`, walk a typed artifact graph, dispatch child `AssignmentWorkflow`s. Recovery is declared `onFail` on each step. Model pick is [Artificial Analysis](https://artificialanalysis.ai/) rank ∩ live T3 runnable ([`MODEL-SELECTION.md`](MODEL-SELECTION.md)).

Normative contracts (state machine, MCP schemas, mailbox, reconciliation): [`CONTRACTS.md`](CONTRACTS.md). T3 wire evidence: [`T3-INTEGRATION.md`](T3-INTEGRATION.md) ([pingdotgg/t3code](https://github.com/pingdotgg/t3code)).

ADRs are **Proposed** until the v0 gate passes. See [TESTING.md](TESTING.md).

## Context diagram

```mermaid
flowchart TB
  You["You — objectives / approvals"]
  T3["Stock T3 Code\n(desktop, phone, Connect)"]
  Sup["Frontier-model supervisor\n(Fable, Astra, …)"]
  MCP["Coordinator MCP"]
  Coord["Coordinator service\n(TypeScript)"]
  Catalog["Process catalog\n(files + overlays)"]
  Temporal["Temporal"]
  Adapter["T3 API adapter"]
  AA["AA LLM catalog\n(hourly cache)"]
  Workers["Composer / GLM\nworker threads + worktrees"]
  GH["GitHub / CI / benchmarks\n(read-only in v0)"]

  You --> T3
  T3 --> Sup
  Sup -->|"classify / start / assign / status / review / pause / cancel"| MCP
  MCP --> Coord
  Coord --> Catalog
  Coord --> Temporal
  Coord --> Adapter
  Coord --> AA
  Adapter -->|"create / start / observe / interrupt"| T3
  Adapter -->|"server.getConfig (WS RPC)"| T3
  T3 --> Workers
  Coord -.->|"v1 writes"| GH
  Coord -->|"v0 reads optional"| GH
  Adapter -->|"mailbox follow-up"| Sup
```

### Process instance (engine)

```mermaid
flowchart TB
  Phrase["run phrase"]
  Intent["parseIntent"]
  Slice["ImplementSlice shortcut"]
  Classify["ClassifyGoal"]
  Gap["PROCESS MAP GAP"]
  ProcSel["ProcessSelection"]
  Inst["ProcessInstanceWorkflow"]
  Artifacts["Typed artifact graph"]
  SelectModel["SelectWorkerModel"]
  AA["AA LLM catalog hourly cache"]
  T3cfg["T3 server.getConfig providers"]
  Step["Step executor"]
  Assign["AssignmentWorkflow"]
  Fail["StepFailure"]
  Recover["onFail policy"]
  Mail["Mailbox to supervisor"]

  Phrase --> Intent
  Intent -->|"192 / complete M*"| Slice
  Intent -->|"freeform goal"| Classify
  Classify -->|"below threshold"| Gap
  Classify -->|"confident match"| ProcSel
  Gap --> Mail
  ProcSel -->|"explicit start"| Inst
  Slice --> Inst
  Inst --> Artifacts
  Inst --> SelectModel
  AA -->|"rank / score"| SelectModel
  T3cfg -->|"runnable gate"| SelectModel
  SelectModel -->|"runnable ModelSelection"| Step
  SelectModel -->|"no runnable candidate"| Fail
  Step --> Assign
  Assign -->|"delivered"| Artifacts
  Assign -->|"any terminal fail"| Fail
  Fail --> Artifacts
  Fail --> Mail
  Fail --> Recover
  Recover -->|"retry_same / retry_role"| SelectModel
  Recover -->|"block / cancel_graph / escalate"| Mail
```

Keep Temporal as durability. **One** interpreter workflow (`ProcessInstanceWorkflow`) walks catalog files — not one workflow type per process. Each worker/check step is a **child** `AssignmentWorkflow`. A failed or timed-out child is a `StepFailure` artifact. The parent must never infer success from “no news” or from git grace alone.

## Components

| Component | Responsibility | Depends on |
|---|---|---|
| MCP interface | Domain tools (`run` / `next` / `sitrep`, `assign_work`, `get_work_status`, `get_delivery`, `get_binding`, `submit_review`, `pause_work`, `resume_work`, `cancel_work`). Freeform `run` classifies; `start <processId>` instantiates. No plan-writer tool. | Official MCP TypeScript SDK; Temporal client |
| Binding CLI | Out-of-band `bind-supervisor` → `~/.t3-coordinator/bindings.json` | Local FS; not MCP |
| Process catalog | File-defined DAGs: `id`, `consumes[]`, `produces[]`, classification signals/excludes/threshold, `steps[]` with required `onFail` | `templates/processes/*.json`; overlays `~/.t3-coordinator/processes/` and `.t3/processes/` |
| Temporal workflows | `ProcessInstanceWorkflow` (interpreter) owns child `AssignmentWorkflow`s — lifecycle, waits, retries, mailbox | Temporal (dev server for slice; PostgreSQL in production) |
| Temporal activities | Side-effecting steps: T3 calls, spec-SHA checks, AA cache read, `SelectWorkerModel` | T3 adapter; git; AA cache file |
| T3 adapter | Version-sensitive create/start/observe/interrupt via `POST /api/orchestration/dispatch` and thread snapshot/subscribe; **provider inventory** via WS RPC `server.getConfig` / `server.refreshProviders` (not `/api/orchestration/*`); client-supplied `commandId`/`threadId`; reconcile via T3 receipts | Stock T3; [`T3-INTEGRATION.md`](T3-INTEGRATION.md) |
| SelectWorkerModel | AA rank ∩ T3 runnable; role policy (worker Q/C Pareto vs reviewer frontier) | [`MODEL-SELECTION.md`](MODEL-SELECTION.md) |
| Follow-up mailbox | Exactly one pending supervisor message per terminal (delivery SHA or `assignmentId + failureClass + attempt`) | Adapter + Temporal |
| Coordinator service process | Operator entrypoint (`t3-coordinator start` / `npm start`): Temporal + worker; hourly AA fetch-if-stale timer. MCP is host-spawned stdio. | Temporal; local FS bindings |
| Operating profile (optional files) | Operator notes for preferred craft helpers / testbed; not loaded by Temporal | `~/.t3-coordinator/operating-profile.json` — [OPERATING-PROFILE](../experience/OPERATING-PROFILE.md) |
| Stock T3 | Conversations, providers, worktrees, desktop/phone UX | Provider CLIs; Connect |
| Policy module (v1) | PR inspection, CI routing, capacity | GitHub; host controllers |

## Data model

State authorities (do not duplicate competing sources of truth):

| State | Authority |
|---|---|
| Process instances, artifact heads, assignments, dependencies, decisions, retries, pending reviews, mailbox | Temporal workflows + inspectable files under `.t3/instances/<id>/` |
| Conversations, provider sessions, worktree associations, idle/busy thread, live `providers[]` | T3 (`server.getConfig`) |
| Ranked model catalog | Cached AA file `~/.t3-coordinator/cache/aa-llms.json` (hourly TTL) |
| Commits, PRs, checks, issue relationships | Git / GitHub |
| Optional searchable summaries | Deferred |

Core durable record: **ProcessInstance** → typed artifacts → **Assignment** → `specSha` → `baseCommit` → worktree → `commandId` / `workerThreadId` → `deliverySha` or `StepFailure` → review verdict → revision count → pause/cancel → `supervisorThreadId` + mailbox IDs.

JSON Schema for artifacts lives in `templates/artifacts/` (versioned). First set: `UserGoal`, `ProcessSelection`, `CurrentArchitecture`, `TargetArchitecture`, `ConstraintSet`, `BehaviorInventory`, `GapSet`, `ExecutionGraph`, `ProviderInventory`, `ModelCatalog`, `ModelSelection`, `ImplementationArtifact`, `VerificationEvidence`, `StepFailure`, `RecoveryDecision`, `ReviewFinding`, `CompletionReport`, `ProcessMapGap`.

**Parity** cells are `pass` \| `fail` \| `na`. `na` requires a written exception on the evidence object; silent omit is invalid. `InventoryBehavior` must not infer intended behavior solely from implementation when tests/docs/public APIs disagree.

## Domain language and boundaries

| Domain concept | Meaning in this project | Boundary / owner |
|---|---|---|
| Supervisor | Frontier-model session that judges and decides (Fable, Astra, …). Thin: classify or start; on `StepFailed` pick only `allowedNext`. | T3 + human via T3 |
| Frontier model | Model class for the supervisor role | Not a single vendor name |
| Worker | Composer, GLM, or similar session executing a bounded assignment | T3 provider thread + isolated worktree |
| Coordinator | Durable mechanics: classify, dispatch, wait, recover, continue | This service |
| Process catalog | File-defined DAG + required `onFail`; primitives compose (e.g. CrossLanguageLogicMigration is not hardcoded TypeScript) | Operator-editable files |
| Delivery | Commit SHA + verification evidence bound to a spec revision | Worker produces; coordinator records; supervisor reviews |
| `StepFailure` | Engine-classified terminal of a step/assignment | Coordinator; mailbox class-bound |
| Mailbox | Queued follow-up to a named supervisor thread | Coordinator; send only when idle |
| ACCEPT / REVISE / BLOCKED | Review outcomes; ACCEPT ≠ merge; REVISE = same worker until cap | Supervisor via MCP `submit_review` |
| Integration | Authorized merge/closure verification after acceptance | Human/policy + GitHub gates (v1) |

## Key flows

### Classify vs start vs ImplementSlice

1. Empty / `next` — orient (goals + backlog + blocked/failed process instances). No worker.
2. Freeform goal — `ClassifyGoal` only. Return `ProcessSelection`. Do not plan. Do not start workers.
3. `start <processId>` — instantiate that catalog process as `ProcessInstanceWorkflow`.
4. `192` / `complete M*` / `complete epic` — skip classify; instantiate ImplementSlice (existing assign path, wrapped so it writes `ImplementationArtifact` + `VerificationEvidence` / `StepFailure`).

Improvisation is allowed only inside a bounded step. The first time a *plan* is allowed is `DesignExecutionGraph` inside a started process.

### Vertical slice (v0 gate)

1. Supervisor commits a spec, then calls `assign_work` (or `192`) with `specSha` and `supervisorThreadId`.
2. `SelectWorkerModel` must succeed before dispatch (AA rank ∩ T3 runnable).
3. Temporal `AssignmentWorkflow` (child of a process instance when one exists) persists IDs, then the adapter dispatches an isolated T3 worker.
4. Coordinator process is killed; worker may continue in T3.
5. On restart, reconcile: adopt existing command/thread; do not create a second worker.
6. Terminal recorded → one mailbox item (delivery SHA **or** `StepFailure`) → follow-up when that supervisor thread is idle.
7. `submit_review` REVISE or ACCEPT; revise loops on the **same** worker within the revision cap.

### Failure and `onFail`

Every assignment and process step ends in success artifacts **or** `StepFailure` + exactly one mailbox follow-up. Failure classes are engine-owned (`dispatch_failed`, `turn_timeout`, `worker_turn_failed`, `no_delivery`, `delivery_unbound`, `constraint_fail`, `child_failed`, `cancelled`, `stale_review`, `process_map_gap`, `provider_unavailable`, `model_missing`, `usage_exhausted`, `usage_unknown`, `ranking_unavailable`).

The parent records `StepFailure` **before** the next catalog step. Independent in-flight slices may finish (pause semantics); dependents do not start. `retry_same` never mints a new worker thread. `retry_role` is the only automatic model/instance switch. `escalate` waits for a supervisor signal in `allowedNext`. The supervisor must not write a new plan, spawn an ad-hoc agent, or switch process type from that signal.

### Steady-state engineering loop (v1)

1. Inspect existing issues/PRs and coordinated WIP (policy module).
2. Choose an unblocked outcome (repair/integrate before new implementation when backlog is saturated).
3. Dispatch or resume worker; validate/revise against SHAs and CI.
4. On ACCEPT, run authorized integration/verification—not automatic merge.
5. Verify closure; refill capacity when review/integration load allows.

### Supervisor → worker → supervisor

```mermaid
sequenceDiagram
  participant Sup as Frontier supervisor
  participant MCP as Coordinator MCP
  participant Tw as Temporal
  participant MB as Mailbox
  participant T3 as Stock T3
  participant W as Worker

  Sup->>MCP: run / assign_work / start
  MCP->>Tw: ProcessInstanceWorkflow → child AssignmentWorkflow
  Tw->>T3: SelectWorkerModel then create worker + worktree (persisted commandId)
  T3->>W: run assignment
  W-->>T3: commit + evidence
  Tw->>MB: enqueue one follow-up (delivery or StepFailed)
  MB->>T3: send when supervisor thread idle
  T3->>Sup: delivery handoff
  Sup->>MCP: submit_review (REVISE|ACCEPT|BLOCKED)
```

## Cross-cutting concerns

- **Error handling:** Activities are idempotent using T3 command receipts; ambiguous timeouts GET the thread before retry. Fail closed on auth, incompatible T3 version, or no runnable `ModelSelection`. Cancel races `waitWorkerTurnEnd` and interrupts immediately.
- **Configuration:** Coordinator MCP on the **supervisor provider native config**, not T3 `/mcp`. Dedicated pairing with `orchestration:operate` + `orchestration:read`. Process catalog and AA/T3 model map are files (NFR-8).
- **Security:** Workers do not inherit coordinator MCP. T3 projects are not a filesystem sandbox (`orchestration:read` can read what ubuntu can). Worktrees isolate checkouts only. AA API key stays in `~/.t3-coordinator/` / env — never in worker prompts or MCP payloads to workers.
- **Completion:** Session/`latestTurn` leaving `running` is turn-end. Branch on `completed` vs `error`/`interrupted` **before** git grace. Delivery is still our commit SHA. `thread.settle` is unrelated.
- **Observability:** Follow-ups per terminal (target 1), duplicate-suppressed launches, revision counts, `failureClass` histogram. See [`OBSERVABILITY.md`](OBSERVABILITY.md).
- **Provider lifecycle:** Backend/model changes that T3 rejects mid-thread require new sessions. Supervisor model swaps (Fable ↔ Astra) do not change assignment identity. Dispatch still re-gates T3 runnable on every attempt (`retry_same` included).

## Decisions

- [ADR-0001 — Temporal-centered coordinator around stock T3](adrs/0001-temporal-centered-coordinator.md) — **Proposed** pending v0 gate
- [ADR-0002 — Vanilla PostgreSQL for Temporal persistence](adrs/0002-vanilla-postgres-temporal.md) — **Proposed** for production; not a slice blocker

## Risks & trade-offs

- **T3 API is a versioned RPC contract, not a public extension SDK** — bind to `packages/contracts` shapes; fail closed on schema drift. HTTP dispatch + receipts are real; cross-thread wake is not.
- **Completion→supervisor wake** — mailbox + idle check from T3 turn/session/queued-start; T3 will queue a follow-up onto a busy thread if we send anyway.
- **T3 `/mcp` is not our plugin slot** — it is the `t3-code` preview toolkit. Coordinator tools go on the supervisor provider’s own MCP config.
- **Maintenance pressure** — successful parallelism increases review traffic; resist automating acceptance.
- **Rejected shortcuts** — Jean as primary (breaks T3 phone workflow), AO as default, T3 fork, a second AI manager above the supervisor, hardcoding Astra.
- **Prototype gate** — if restart/idempotency/follow-up proofs fail, keep explicit human handoffs rather than shipping a fragile autonomous loop.
