# Product

**t3-coordinator** is a durable coordination service that sits beside stock T3 Code. It lets a **frontier-model supervisor** (Fable, Astra, or equivalent) assign, track, review, and resume engineering work across cheaper implementation workers (Composer, GLM, and similar) without the human carrying messages between agents.

The coordinator is an engineering operating system, not a clever dispatcher: it **classifies** a goal into a file-based process catalog, instantiates a **typed artifact graph**, then spawns workers. Classification never plans. Recovery is a declared `onFail` policy, not supervisor improvisation. Success is completed, verified repository outcomes—not more agents running.

## Problem

T3 already provides the working interface: desktop and phone access, provider sessions, threads, and worktrees. It does not durable-coordinate multi-agent delivery. Humans still paste handoffs between plan, build, and review; freeform goals have nowhere to land except “unknown”; workers can fail while the supervisor hears nothing; restarts risk duplicate launches or lost continuation. For sustained delivery on coupled repos such as GraphForge and XYG, the missing piece is a **process catalog** with typed artifacts, declared recovery, reliable assignment, and completion→review wake-up—not another coding IDE or T3 fork.

The supervisor is a **role**, not a brand. Today that role is filled by a frontier model available in T3 (Fable, Astra, …). Workers are separate provider sessions. The coordinator must not assume a single model name, backend, or vendor.

## Audience

- **Primary operator** — Uses T3 (Mac and phone) and a frontier-model supervisor as engineering lead; needs unattended continuation and safe recovery without babysitting handoffs.
- **Supervisor (frontier model)** — Needs a small MCP tool surface to classify or start a process, assign work, inspect status (including failed steps), submit review decisions, and pause/cancel. On failure, only `allowedNext`.
- **Worker agents (Composer / GLM / similar)** — Execute bounded assignments in isolated worktrees; do not receive coordinator dispatch tools.
- **Repository maintainers** — Need GitHub issues, PRs, CI, and existing build/benchmark controllers to remain authoritative.

## Vision

Give a frontier-model supervisor an engineering objective and have the coordinator classify it into a catalog process (or a gap), instantiate typed artifacts, and progress through inspection, dispatch, validation, revision, authorized integration, and closure—continuing after the laptop closes and recovering cleanly after a coordinator restart—while T3 remains the only human-facing session surface. A missed classification is a `ProcessMapGap`, not a closest-match plan. A failed worker is a `StepFailure` with one mailbox follow-up, not silence.

## Goals

- Remove manual supervisor ↔ worker message carrying for the plan → build → review loop.
- Classify freeform goals against the process catalog, or return a gap — never invent a plan or start workers from classify.
- Keep stock T3 as the interface and session owner (desktop, phone, Connect).
- Treat the supervisor as a frontier-model role (Fable, Astra, etc.), not a hardcoded provider.
- Enforce durable, idempotent coordination: no duplicate workers or duplicate supervisor continuations after retries or restarts.
- Treat every worker/step terminal as success artifacts or `StepFailure` plus exactly one supervisor follow-up; apply catalog `onFail` instead of improvising recovery.
- Select workers on the quality/cost-per-task frontier among T3-runnable models; use a frontier model for review when T3 has one; never dispatch past T3 availability or usage.
- Prefer finishing and integrating existing work over spawning new implementation (v1 policy, not the v0 gate).
- Prove one vertical slice before building full scheduling policy. Issue shortcuts (`192` / `complete M*`) stay the ImplementSlice path and skip classify.

## Quality stance

- **ADRs** for irreversible stack and boundary choices; keep them **Proposed** until the vertical slice is proven on live T3. Rigor itself is an **executable process** (catalog steps + `onFail`), not paperwork spawned because a template asked for an ADR.
- **Idempotency-first** external actions (T3 launches, supervisor follow-ups). GitHub writes are v1.
- **Evidence-bound acceptance** — deliveries and reviews bind to specification and commit SHAs; worker self-report is not acceptance. Git grace applies only after a turn `completed`.
- **Prototype gate before scale** — one supervisor thread, one worker, restart/recovery proof before parallelism and full policy.

## Scope split

| Phase | In scope | Out of scope until the gate passes |
|---|---|---|
| **v0 — vertical slice** | MCP assign/status/delivery/review/pause/resume/cancel; classify-or-gap + `start <processId>`; supervisor binding; isolated T3 worker on the paired **[dev-skills](https://github.com/DecisionNerd/dev-skills) repo** ([experience/TESTBED.md](experience/TESTBED.md)); git trailer delivery gate; mailbox on every terminal (delivery or `StepFailure`); kill/recover without duplicates; AA rank ∩ T3 runnable model pick | GraphForge/XYG capacity heuristics, CI routing, GitHub writes, benchmarks, multi-worker parallelism; installing craft skills on OVHC |
| **v1 — policy** | Inspect existing PRs, route CI failures, enforce review/integration capacity, GitHub evidence writes | Auto-merge, T3 fork, second AI manager above the supervisor |

## Non-goals

- Forking or patching T3 Code as the product surface.
- Replacing T3 with Jean, Agent Orchestrator, or another session manager as the primary interface.
- Building another coding agent, editor, or provider runtime.
- Hardcoding Astra (or any one frontier model) as the only supervisor.
- Putting a second AI “manager” above the supervisor (CrewAI hierarchical manager, etc.).
- Using Turso/SQLite as Temporal’s persistence backend.
- Auto-merging on supervisor `ACCEPT` (acceptance ≠ merge authorization).
- Requiring a particular craft-skill pack to run the coordinator — process helpers and the **process catalog** are optional overlays, file-editable without a coordinator release ([experience/OPERATING-PROFILE.md](experience/OPERATING-PROFILE.md)).
- Letting the classifier plan, pick a closest process on a miss, or start workers. Execution starts on `start`, or on the ImplementSlice shortcut (`192` / `complete M*` / `complete epic`).
- Supervisor-improvised recovery, a “write me a plan” tool, or treating turn `error` / `interrupted` / timeout as `no_delivery`.

## Success Metrics

**v0 gate (must pass before v1):**

- End-to-end cycle: supervisor assigns → isolated worker delivers commit + evidence → supervisor reviews → one revise loop completes without human paste.
- Coordinator kill-after-dispatch recovers the same worker and delivers exactly one queued supervisor follow-up.
- Pause/cancel stops further dispatch and does not resurrect cancelled work on restart. Cancel interrupts an in-flight wait.
- Follow-ups per **terminal** (delivery or `StepFailure`) = 1; duplicate worker launches = 0 in the controlled test.
- Freeform goal below classify threshold → `ProcessMapGap` mailbox; no closest-process start.
- Disabled or exhausted T3 provider → `provider_unavailable` / `usage_exhausted`; zero worker launches.

**v1:**

- Completed, verified issue/PR outcomes on target repos (not agent-count or thread-count).

## Stakeholders

- **Owner / operator** — David Spencer; remote OVHC-AGENCY development host and T3 environment. First projects usually use a [dev-skills](https://github.com/DecisionNerd/dev-skills) checkout in T3; operators personalize craft helpers via [experience/OPERATING-PROFILE.md](experience/OPERATING-PROFILE.md) ([experience/TESTBED.md](experience/TESTBED.md)).
- **Dependent systems** — GraphForge and XYG engineering delivery; existing CI, readiness, and benchmark controllers.
