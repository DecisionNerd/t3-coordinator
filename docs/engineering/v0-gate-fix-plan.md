# v0 gate fix plan

Closes all findings in [`.redteam/reviews/coordinator-design-critique.md`](../../.redteam/reviews/coordinator-design-critique.md).  
Regime: **A (contracts)** with Temporal golden/workflow tests; live T3 spike is **B** for the three gate rows.

## Decisions (answers to critique questions)

### 1. What moves an assignment to `delivered`?

**Best practice:** do not trust the worker’s narrative. After T3 turn-end (session/`latestTurn` leaves `running`), a Temporal activity independently inspects the **worktree Git state**.

| Condition | Next state |
|---|---|
| `HEAD != baseCommit` **and** tip commit message contains `Coordinated-By: <assignmentId>` | `delivered` (`deliverySha = HEAD`) |
| Turn `completed`/`error`/`interrupted` and HEAD still `baseCommit` | wait **delivery grace** (default **5 minutes**), then `blocked` with reason `no_delivery` |
| HEAD moved but trailer missing | wait grace; then `blocked` with reason `delivery_unbound` (refuse silent accept) |
| Dirty tree with matching trailer commit | still `delivered`; record `dirty: true` in evidence (v0 allows; v1 may tighten) |

Evidence refs (v0 minimum): `{ deliverySha, baseCommit, worktreePath, turnId, observedAt }`. Optional later: test command receipt bound to SHA ([Proof-or-Stop](https://arxiv.org/html/2607.14890v1) / mechanical gates pattern).

Worker prompt **must** require: commit on the worktree branch with trailer `Coordinated-By: <assignmentId>`. That is convention, not an MCP tool (workers do not get coordinator tools).

### 2. How does MCP get `supervisorThreadId`?

**Best practice:** do not trust the frontier model to invent control-plane IDs. Native provider MCP has **no** T3 thread scope (unlike T3’s `/mcp`).

**v0 binding model:**

1. Operator (or setup script) creates/opens the supervisor thread in T3 and copies its id.
2. `t3-coordinator bind-supervisor --environment <id> --thread <threadId>` writes a durable binding (file under coordinator home, e.g. `~/.t3-coordinator/bindings.json`, or Temporal search-attribute / config table).
3. MCP `assign_work` **defaults** `supervisorThreadId` from that binding. Field becomes **optional** when a binding exists; required only if unbound.
4. v0 rejects overrides that disagree with the binding (or ignore overrides)—no LLM-supplied id wins over the binding.
5. Optional `get_binding` tool for the supervisor to confirm which thread it is bound to.

This is out-of-band identity, same class of discipline as pairing tokens: humans establish trust; agents operate inside it.

### 3. Temporal for v0?

**Yes.** Use Temporal from day one—the repo is already a Temporal TypeScript scaffold (`src/workflows.ts`, worker, mocha). One workflow type `AssignmentWorkflow`; activities for T3 adapter + git observe. Dev server for the spike; Postgres remains ADR-0002 for production.

### 4. Mid-compose on phone (no turn)?

T3 cannot detect composer draft. v0 idle = turn/session/queued-start/raised-hand only. **Document as accepted limitation:** a follow-up may land while the operator is drafting. Mitigations: mailbox delay if `latestUserMessageAt` is within N seconds without a turn (optional heuristic); operator `pause_work` before long edits. Not a silent P0—REQUIREMENTS must stop promising “active human turn” protection.

### 5. Version pin

Spike baseline = **installed OVHC T3 version** (`npx t3 --version` / package version), recorded in `T3-INTEGRATION.md`. `main` clone is reference only.

---

## Finding → fix map

| ID | Finding | Fix |
|---|---|---|
| P0-1 | Delivery undefined | CONTRACTS delivery observation + trailer + grace; activities `observeWorktreeDelivery` |
| P0-2 | supervisorThreadId unbound | Binding CLI + default in `assign_work`; FR-1 refine |
| P1-1 | provider vs instanceId | Fix idempotency key text |
| P1-2 | FR-4 overclaim | Align REQUIREMENTS to idle definition |
| P1-3 | MCP isolation hope | Codex-only supervisor instance for v0; workers OpenCode/Cursor without coordinator MCP; audit checklist in TESTING |
| P1-4 | pause/resume | Add `resume_work`; clarify in-flight delivery under pause |
| P1-5 | version pin | Record OVHC version in T3-INTEGRATION |
| P2-1 | Temporal optional | Closed: Temporal required |
| P2-2 | diagram labels | Align Mermaid to git observation |
| P2-3 | blocked wording | v0: `blocked` terminal until new `assign_work` |
| P2-4 | worker prompt | Template in CONTRACTS |
| P3 | scratch repo / FR-11 wire | PRODUCT + FR-11 wording |

---

## Implementation order

1. **Docs/contracts** (this plan’s decisions into PRODUCT/REQUIREMENTS/CONTRACTS/ARCHITECTURE/TESTING/OBSERVABILITY/T3-INTEGRATION/ADR-0001).
2. **Rename package** `temporal-hello-world` → `t3-coordinator`; keep Temporal scripts.
3. **AssignmentWorkflow** + activities: bind config load, dispatch, subscribe/poll turn-end, observe git, mailbox, review signals.
4. **MCP server** (official TS SDK) + **bind-supervisor** CLI.
5. **Unit/workflow tests** for state machine, idempotency, delivery grace, mailbox exactly-once.
6. **Live OVHC scratch-repo gate** (three TESTING rows).

Do not implement v1 policy or production Postgres until the gate is green.
