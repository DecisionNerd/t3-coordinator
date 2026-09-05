# Product

**t3-coordinator** is a durable coordination service that sits beside stock T3 Code. It lets a **frontier-model supervisor** (Fable, Astra, or equivalent) assign, track, review, and resume engineering work across cheaper implementation workers (Composer, GLM, and similar) without the human carrying messages between agents. Success is completed, verified repository outcomes—not more agents running.

## Problem

T3 already provides the working interface: desktop and phone access, provider sessions, threads, and worktrees. It does not durable-coordinate multi-agent delivery. Humans still paste handoffs between plan, build, and review; workers finish while the supervisor is idle; restarts risk duplicate launches or lost continuation. For sustained delivery on coupled repos such as GraphForge and XYG, the missing piece is reliable assignment, dependency and capacity policy, completion→review wake-up, and recovery—not another coding IDE or T3 fork.

The supervisor is a **role**, not a brand. Today that role is filled by a frontier model available in T3 (Fable, Astra, …). Workers are separate provider sessions. The coordinator must not assume a single model name, backend, or vendor.

## Audience

- **Primary operator** — Uses T3 (Mac and phone) and a frontier-model supervisor as engineering lead; needs unattended continuation and safe recovery without babysitting handoffs.
- **Supervisor (frontier model)** — Needs a small MCP tool surface to assign work, inspect status, submit review decisions, and pause/cancel.
- **Worker agents (Composer / GLM / similar)** — Execute bounded assignments in isolated worktrees; do not receive coordinator dispatch tools.
- **Repository maintainers** — Need GitHub issues, PRs, CI, and existing build/benchmark controllers to remain authoritative.

## Vision

Give a frontier-model supervisor an engineering objective and have work progress through inspection, dispatch, validation, revision, authorized integration, and closure—continuing after the laptop closes and recovering cleanly after a coordinator restart—while T3 remains the only human-facing session surface.

## Goals

- Remove manual supervisor ↔ worker message carrying for the plan → build → review loop.
- Keep stock T3 as the interface and session owner (desktop, phone, Connect).
- Treat the supervisor as a frontier-model role (Fable, Astra, etc.), not a hardcoded provider.
- Enforce durable, idempotent coordination: no duplicate workers or duplicate supervisor continuations after retries or restarts.
- Prefer finishing and integrating existing work over spawning new implementation (v1 policy, not the v0 gate).
- Prove one vertical slice before building full scheduling policy.

## Quality stance

- **ADRs** for irreversible stack and boundary choices; keep them **Proposed** until the vertical slice is proven on live T3.
- **Idempotency-first** external actions (T3 launches, supervisor follow-ups). GitHub writes are v1.
- **Evidence-bound acceptance** — deliveries and reviews bind to specification and commit SHAs; worker self-report is not acceptance.
- **Prototype gate before scale** — one supervisor thread, one worker, restart/recovery proof before parallelism and full policy.

## Scope split

| Phase | In scope | Out of scope until the gate passes |
|---|---|---|
| **v0 — vertical slice** | MCP assign/status/delivery/review/pause/resume/cancel; supervisor binding; isolated T3 worker on the paired **[dev-skills](https://github.com/DecisionNerd/dev-skills) repo** ([experience/TESTBED.md](experience/TESTBED.md)); git trailer delivery gate; follow-up mailbox; kill/recover without duplicates | GraphForge/XYG capacity heuristics, CI routing, GitHub writes, benchmarks, multi-worker parallelism; installing craft skills on OVHC |
| **v1 — policy** | Inspect existing PRs, route CI failures, enforce review/integration capacity, GitHub evidence writes | Auto-merge, T3 fork, second AI manager above the supervisor |

## Non-goals

- Forking or patching T3 Code as the product surface.
- Replacing T3 with Jean, Agent Orchestrator, or another session manager as the primary interface.
- Building another coding agent, editor, or provider runtime.
- Hardcoding Astra (or any one frontier model) as the only supervisor.
- Putting a second AI “manager” above the supervisor (CrewAI hierarchical manager, etc.).
- Using Turso/SQLite as Temporal’s persistence backend.
- Auto-merging on supervisor `ACCEPT` (acceptance ≠ merge authorization).

## Success Metrics

**v0 gate (must pass before v1):**

- End-to-end cycle: supervisor assigns → isolated worker delivers commit + evidence → supervisor reviews → one revise loop completes without human paste.
- Coordinator kill-after-dispatch recovers the same worker and delivers exactly one queued supervisor follow-up.
- Pause/cancel stops further dispatch and does not resurrect cancelled work on restart.
- Follow-ups per delivery = 1; duplicate worker launches = 0 in the controlled test.

**v1:**

- Completed, verified issue/PR outcomes on target repos (not agent-count or thread-count).

## Stakeholders

- **Owner / operator** — David Spencer; remote OVHC-AGENCY development host and T3 environment. v0 testbed is the **dev-skills git repo** as a T3 project. Operator SDLC craft (**DocSlime**, **RedTeam**, **Impeccable**, issues/milestones) runs on the operator machine — **not** assumed installed on OVHC ([experience/TESTBED.md](experience/TESTBED.md)).
- **Dependent systems** — GraphForge and XYG engineering delivery; existing CI, readiness, and benchmark controllers.
