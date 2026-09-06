# Testing

v0 is proven by three behaviors: isolated dispatch, mailbox follow-up, and durable cancel. Those are the ship gate. Policy (FR-7–9) has no tests until the gate is green on live T3.

## Strategy

| Layer | What it verifies | Tools |
|---|---|---|
| Unit | Delivery trailer, binding resolve, busy matrix, commandId receipts, assignment id | `src/mocha/domain.test.ts` |
| Integration | AssignmentWorkflow: grace→`no_delivery`, busy mailbox deferral, pause/resume mailbox | `src/mocha/assignment.test.ts` + Temporal test env |
| End-to-end / behavior | v0 gate rows on OVHC (or local) T3 against the paired **dev-skills** repo | Manual protocol; see [`../experience/TESTBED.md`](../experience/TESTBED.md) |

## Behavior coverage (v0 gate)

| Experience / Requirement | Scenario (Given/When/Then) | Test |
|---|---|---|
| FR-2 + FR-5 | Given a supervisor assigned one GLM task and the coordinator was killed after dispatch, when the coordinator restarts and reconciles, then the same worker is adopted and no second launch occurs | `tests/gate/recover-same-worker` (planned); until then, recorded spike checklist |
| FR-3 + FR-4 | Given a worker committed a delivery SHA with tests and the supervisor thread is idle, when the coordinator records the delivery, then exactly one mailbox follow-up is sent to `supervisorThreadId` with SHAs | `tests/gate/one-follow-up` (planned) |
| FR-6 | Given an assignment was cancelled, when the coordinator restarts and completion events arrive, then no new dispatch occurs and state remains `cancelled` | `tests/gate/cancel-stays-dead` (planned) |
| FR-1 + FR-11 | Given Fable or Astra (or another frontier model) as supervisor, when `assign_work` is called with `supervisorThreadId` and `specSha`, then the same contract applies | Contract test on MCP schema; no model-name branch |
| FR-4 degrade | Given T3 cannot signal thread idle, when a delivery is recorded, then the mailbox item stays queued/visible and no auto-turn is injected | Spike observation; tripwire if auto-inject is the only option |
| FR-13 | Given a freeform dual-write/cutover goal below threshold, when `run` classifies, then `ProcessMapGap` mailbox and no closest-process start. Given `192`, ImplementSlice starts without classify | `src/mocha/process-catalog.test.ts` |
| FR-14 + FR-15 | Given turn `error`, when wait returns, then `worker_turn_failed` + one mailbox and **no** five-minute `no_delivery` path. Same for wait timeout → `turn_timeout`. Child fail does not start dependents | `src/mocha/assignment.test.ts`, `src/mocha/process-instance.test.ts` |
| FR-16 | Given cancel during wait, then `interruptWorker` before turn end. Given REVISE under cap, same `workerThreadId` | `src/mocha/assignment.test.ts` |
| FR-17 | Given fresh AA cache, zero AA HTTP on dispatch. Given two runnable mapped models, implement picks max Q/C on Pareto frontier (not max Q). Review with a runnable frontier model uses that model. T3 disabled/exhausted → zero dispatch POSTs | `src/mocha/process-catalog.test.ts`, `src/mocha/model-select.test.ts`, `src/mocha/aa-onfail.test.ts` |

## Traceability contract

| Link | Evidence |
|---|---|
| Product goal -> experience | [`../PRODUCT.md`](../PRODUCT.md) v0 success metrics |
| Experience -> requirement | FR-1–6, FR-10–17, NFR-1–4, NFR-7–8 |
| Requirement -> BDD scenario | Behavior coverage table |
| Scenario -> test | Planned paths above; gap until adapter exists |
| Requirement -> architecture/ADR | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CONTRACTS.md`](CONTRACTS.md), ADR-0001 Proposed |

## Evaluation against product goals

- Follow-ups per delivery = 1 (0 or >1 fails the gate).
- Duplicate worker launches in the kill/recover test = 0.
- Cancelled assignments do not resume after restart.
- Supervisor examples (Fable vs Astra) do not change tool behavior.

## Running the tests

```
npm test
npm start          # Temporal (auto if needed) + worker; MCP is host-spawned
npm run cli -- bind-supervisor --environment <id> --thread <threadId>

# v0 gate on live T3 (dev-skills repo checkout): follow CONTRACTS.md + this table.
# Craft skills pack is not required on OVHC — only the git project.
```

Hello-world `example` workflow remains as a Temporal smoke check only.

## Continuous integration

CI should run unit/state-machine tests when they exist. The live T3 gate is a manual check on a **dev-skills** checkout (local or OVHC) until automated. Do not merge v1 policy features before the gate rows are green.

## Test data & environments

- Paired repo: **[DecisionNerd/dev-skills](https://github.com/DecisionNerd/dev-skills)** as a T3 project — not GraphForge/XYG ([experience/TESTBED.md](../experience/TESTBED.md)).
- OVHC needs that **clone** added to T3; it does **not** need the craft skills pack installed.
- One isolated worktree, one supervisor thread, one worker.
- No GitHub writes in v0 tests.
