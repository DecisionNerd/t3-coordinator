# Decision Review: coordinator docs (PRODUCT / REQUIREMENTS / DESIGN / ARCHITECTURE / ADRs)

Date: 2026-09-05
Command: `/redteam review`
Sources: `docs/PRODUCT.md`, `docs/REQUIREMENTS.md`, `docs/DESIGN.md`, `docs/engineering/ARCHITECTURE.md`, `docs/engineering/adrs/0001-temporal-centered-coordinator.md`, `docs/engineering/adrs/0002-vanilla-postgres-temporal.md`
Note: No `CONTEXT.md`. Review used the docs plus the Codex design conversation they distill. Optional follow-up: `/redteam init`.

## Decision

Treat the current documentation as the **approved design to implement against** (Temporal + MCP + stock T3 adapter, ADRs Accepted, FR-1–10 as the v1 contract).

## Go / No-Go Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Problem is real and scoped | Met | PRODUCT states T3 is the interface, not the coordinator; success is verified repo outcomes. |
| Alternatives named and rejected | Met | ADR-0001 lists manual MCP, Jean, AO, CrewAI manager, T3 fork. |
| Critical T3 APIs proven on the live server | Unmet | REQUIREMENTS open questions; ARCHITECTURE risk: “not a stable public extension SDK”; assumption left unvalidated. |
| Completion → idle Astra follow-up specified | Unmet | FR-4 requires “exactly one” follow-up; no mailbox, turn-mutex, or supervisor-thread identity. |
| Idempotent dispatch algorithm specified | Unmet | NFR-2 / FR-5 name reconcile-before-retry; no persisted-ID scheme, reconciliation steps, or race with in-flight T3 commands. |
| v1 requirements match the prototype gate | Unmet | PRODUCT says prove one slice first; FR-7/8/9 pull GraphForge policy, CI routing, and capacity into the same contract. |
| Test/observability contract exists for the gate | Unmet | `TESTING.md` and `OBSERVABILITY.md` remain templates; FR-4/5/6 have no mapped tests. |
| ADRs match evidence strength | Unmet | Both ADRs are **Accepted** while the spike that would justify Temporal-as-foundation is still future work. |
| Dissent recorded | Unmet | Single-author Codex thread distilled into docs; no independent dissent log. |
| Rollback if T3 coupling fails | Partial | ARCHITECTURE says keep manual handoffs; no explicit kill/pivot to “on-demand dispatch only.” |

## Critical assumptions

| Assumption | Critical? | Validated? |
|------------|-----------|------------|
| T3 0.0.38+ can create threads, prepare worktrees, start turns, and emit enough completion signal to resume Astra | Yes | No — named as open question |
| Server-side Astra can load our MCP tools (not Mac-only PATH) | Yes | No |
| Coordinator can distinguish idle Astra vs human-active phone/desktop turn and not race | Yes | No — risk named, mechanism not designed |
| Temporal activities can be made idempotent against T3’s command receipts | Yes | Partial — T3 receipts exist in source inspection; adapter contract unwritten |
| Shared ubuntu + worktrees isolate workers enough for GraphForge/XYG | No (for slice) | No — docs correctly say this is not a security boundary |
| Astra judgment + cheaper workers beats paste-handoff after review/retry cost | Yes (product) | No — unmeasured |
| GraphForge/XYG policy belongs in the coordinator core | No | Conflated — PRODUCT audience is those repos; REQUIREMENTS encode their heuristics as FR-7/9 |

## Failure modes

1. **Silent stop / wrong resume.** Worker finishes; Astra is idle or the operator is mid-turn on the phone. Follow-up is dropped, duplicated, or injected into the wrong conversation. The product’s only unattended value fails while Temporal “succeeds.”
2. **Duplicate execution theater.** Launch response is lost; Temporal retries; adapter mints a new thread ID; two workers edit related trees. Docs forbid this but do not specify the identity keys that prevent it.
3. **Policy gravity.** Implementing FR-7/9 and GitHub/CI/benchmarks before the T3 adapter works produces a scheduler with nothing reliable to schedule. Time-to-proof slips; the design looks complete on paper.

## Dissent

**Not surfaced.** The design was produced in a single Codex conversation, then transcribed into Accepted ADRs. The conversation itself reversed course several times (Jean → T3 MCP → AO → Temporal). That history is dissent-like, but the docs present the last turn as settled. GTM risk: illusion of unanimity after one author and one model.

Strongest unrecorded objection: *the problem being sold is “stop pasting handoffs”; the architecture being bought is a self-hosted workflow platform plus an unofficial T3 SDK. Those are different commitments.*

## Reversibility

| Commitment | Door type | Reversal cost | Undo plan |
|------------|-----------|---------------|-----------|
| Stock T3 as session owner | Two-way | Low if adapter is isolated | Stop adapter; keep T3 |
| Domain MCP tools for Astra | Two-way | Low | Disable MCP in provider config |
| Temporal as workflow engine | Looks two-way | Medium — workflow history, ops, mental model | Rewrite workflows; keep adapter if tools stay stable |
| Self-hosted PostgreSQL for Temporal | Two-way (ops) | Medium — backup/upgrade burden | Move to Temporal Cloud without changing logical design (ADR-0002) |
| Treating ADRs as Accepted before spike | One-way (process) | High if code follows paper | Downgrade to Proposed |
| Encoding GraphForge capacity/PR heuristics as FR-7/9 | Looks two-way | Medium — becomes “the product” | Split core vs policy |
| Building GitHub write-path (NFR-2) | Looks two-way | High if bot comments/PRs land | Read-only until slice passes |

## Recommendation

**DEFER** treating these docs as an approved implementation spec.

**GO WITH CONDITIONS** on keeping them as *intent and direction*, and on running the vertical-slice spike they already name.

Do not implement FR-7–9, GitHub writes, or Temporal-as-production-ops until the T3 coupling assumptions are tested. Do not leave ADRs **Accepted** while the critical path is “must be proven on the live server.”

## Conditions (if using docs as direction)

1. Mark ADR-0001 and ADR-0002 **Proposed** (or add “Accepted pending spike”) until FR-2 + FR-4 + FR-5 pass on OVHC against stock T3.
2. Split requirements into **Slice (v0)** vs **Policy (v1)**. Slice = FR-1 (minimal), FR-2, FR-3 (state names only), FR-4, FR-5, FR-6, FR-10, NFR-1–4. Policy = FR-7, FR-8, FR-9, GitHub writes, benchmarks.
3. Write the missing contracts before more architecture: MCP schemas, assignment state machine, follow-up mailbox, reconciliation algorithm, pause vs cancel.
4. Fill `TESTING.md` with the three behavior-trace rows as the only ship gate for v0.
5. Record this review as the dissent log for ADR-0001.

## Kill criteria / tripwires

| Signal | Threshold | Action |
|--------|-----------|--------|
| Live T3 cannot create isolated worktree + start turn with stable command ID | One spike attempt, documented | Stop Temporal build; fall back to CLI launch + MCP messaging (on-demand, human wake) |
| Cannot resume a specific Astra thread without interrupting an active human turn | Cannot queue ≥1 follow-up safely | Ship mailbox + notification only; no auto-turn |
| Kill-after-dispatch produces a second worker | Once in controlled test | NO-GO on unattended mode; keep explicit handoffs |
| Adapter requires T3 DB writes or a fork | Any | Kill the approach; revisit Jean/AO or a T3 issue upstream |
| Slice not proven after a bounded calendar window | e.g. two focused working sessions | Re-open ADR-0001; consider on-demand dispatch only |

## Monitoring / tripwires

- Count duplicate-suppressed launches vs actual duplicate threads (must be observable, not hoped).
- Count Astra follow-ups per delivery (target = 1; >1 or 0 is a tripwire).
- Do not start GraphForge PR-queue automation until slice metrics exist.

## Follow-through (2026-09-05)

Docs updated after this review:

- Supervisor role generalized to **frontier model** (Fable, Astra, etc.).
- Requirements split **v0 / v1**; FR-11 added for model portability.
- Contracts filled in `docs/engineering/CONTRACTS.md`.
- T3 wire evidence from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) in `docs/engineering/T3-INTEGRATION.md` (HTTP dispatch, receipts, prepareWorktree, no cross-thread wake, `/mcp` is T3 toolkit only).
- ADR-0001/0002 status set to **Proposed**.
- TESTING.md and OBSERVABILITY.md filled with the v0 gate and tripwires.

---

## RFC dimensions (secondary)

| Dimension | Score (0–4) | Notes |
|-----------|-------------|-------|
| Problem | 4 | Clear: T3 is UI, not coordinator. |
| Options | 3 | Alternatives named; last-turn Temporal preference under-argued vs “prove T3 first.” |
| Reversibility | 2 | Temporal+Accepted ADRs treated as settled; spike is the real two-way door. |
| Operations | 2 | Postgres/Temporal ops acknowledged; no backup/on-call/upgrade note. |
| Security & misuse | 2 | Worker tool split is good; ubuntu-shared FS, Astra over-assign, MCP authz underspecified. |
| Assumptions | 1 | Critical T3 assumptions explicit but unvalidated; ADRs already Accepted. |
| Decision | 2 | Direction is coherent; commitment level exceeds evidence. |
