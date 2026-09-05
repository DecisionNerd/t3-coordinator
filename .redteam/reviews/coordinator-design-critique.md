# Critique: coordinator design docs (post–T3 source review)

Date: 2026-09-05  
Command: `/redteam critique`  
Targets: `docs/PRODUCT.md`, `docs/DESIGN.md`, `docs/REQUIREMENTS.md`, `docs/engineering/{ARCHITECTURE,CONTRACTS,T3-INTEGRATION,TESTING,OBSERVABILITY}.md`, ADR-0001/0002  
Prior: `.redteam/reviews/coordinator-docs-review.md`

Note: No `CONTEXT.md`. Critique uses the docs as context. Optional: `/redteam init`.

## Critique: coordinator design (v0 plan)

### Summary

The design proposes a TypeScript coordinator beside stock [T3 Code](https://github.com/pingdotgg/t3code): a frontier-model supervisor (Fable/Astra/…) calls domain MCP tools; Temporal runs `AssignmentWorkflow`; a T3 adapter dispatches isolated workers via `thread.turn.start` + `prepareWorktree`, then mailboxes exactly one follow-up when the supervisor thread is idle. Recommended action: implement only the v0 gate against live OVHC T3, keep ADRs Proposed, and refuse v1 policy until FR-2/4/5 pass.

### Scores

| Dimension | Score | Note |
|-----------|-------|------|
| Clarity | 3/4 | v0/v1, roles, and T3 mapping are clear; delivery *detection* and MCP thread binding still fuzzy |
| Evidence | 3/4 | Strong: `T3-INTEGRATION.md` from t3code `main`; weak: no live OVHC pairing/MCP proof |
| Logic | 3/4 | Judgment/mechanics split holds; sequence diagram skips how `deliverySha` becomes known |
| Assumptions | 3/4 | Named and owner-tagged; critical ones still untested |
| Alternatives | 3/4 | ADR-0001 compares Jean/AO/fork/CrewAI; Temporal-for-slice barely challenged now |
| Risk | 3/4 | Queue-on-busy and `/mcp` trap called out; delivery convention and MCP scope bleed under-mitigated |
| **Total** | **18/24** | Viable; revise P0/P1 before treating the design as implementer-complete |

Threshold: **15–19** — viable but needs revision on flagged items. Not yet ≥20 decision-ready as a full build spec; **ready enough to spike** if P0 gaps are closed first.

### Findings

#### P0 — Blocks decision (to implement the gate as written)

- **Delivery is undefined.** Architecture sequence shows `W-->>T3: commit + evidence` then mailbox enqueue, but CONTRACTS never state *who* sets `deliverySha`, *how* the coordinator observes it (git tip? conventional path? worker message parse? poll until SHA changes?), or what happens if the turn completes with no commit. Without this, FR-3/FR-4 and the TESTING gate cannot be implemented faithfully.

- **Supervisor thread identity into MCP is unspecified.** `assign_work` requires `supervisorThreadId`, but coordinator MCP is *native provider config*, not T3’s thread-scoped `/mcp`. Nothing says how the frontier model obtains the correct thread id (prompt convention? wrapper? human pastes?). Wrong id = follow-ups to the wrong chat. This is a control-plane hole, not polish.

#### P1 — Must fix

- **`assign_work` field inconsistency.** Required fields use `instanceId`/`modelId`; idempotency key text still says `provider` + `modelId`. Implementers will disagree.

- **FR-4 overclaims vs T3.** Acceptance text: “An active human turn on that thread must not be interrupted.” T3 has no typing/in-progress-composer signal; busy = turn/session/queued-start/raised-hand only. DESIGN is honest; REQUIREMENTS still promises more than the idle definition delivers.

- **MCP isolation is policy-by-hope.** Authz says “don’t put coordinator MCP in directory-global OpenCode config.” There is no enforcement design (separate OpenCode roots? Codex-only supervisor? allowlist audit). FR-10 is testable only after that mechanism exists.

- **Pause/resume underspecified.** State diagram has `resume`, but there is no `resume_work` MCP tool; pause→running path is unclear for an in-flight worker that later delivers.

- **Evidence freshness.** `T3-INTEGRATION.md` is `main` on 2026-09-05, not the pinned OVHC T3 version. Docs should name the installed version as the spike baseline.

#### P2 — Should fix

- **Temporal may be heavy for v0.** T3 already persists command receipts and thread state. The slice needs durable *assignment/mailbox* state; Temporal is one option, not proven necessary for one concurrent assignment. ADR-0001 still under-argues “why Temporal in the spike” vs SQLite/Postgres table + poller.

- **State diagram vs table.** Diagram node “delivered: delivery SHA + evidence recorded” still reads like agent narrative; table correctly requires user-branch SHA. Align diagram labels.

- **`blocked` terminal vs “until a new assign”.** Contradictory terminal wording; pick one for v0.

- **Worker prompt contract missing.** Spec SHA gate is strong; the worker still needs a required delivery convention (e.g. commit message trailer, path, or explicit “delivery recorded” tool—workers must not get dispatch tools, so convention matters).

#### P3 — Minor

- PRODUCT still markets GraphForge/XYG in the problem statement while v0 forbids their policy—fine, but add one line that v0 uses a scratch repo.
- `supervisorModelClass: frontier` is internal-only—good; drop any leftover implication it is a T3 enum (FR-11 text is slightly wire-confused).

### Strengths

- Grounding in real T3 contracts (dispatch, receipts, prepareWorktree, settle ≠ delivery, `/mcp` is not a plugin) is a step-change from the earlier guess-driven design.
- v0/v1 split and Proposed ADRs match the prior review’s main process criticism.
- Idle/busy definition is now operational and tied to T3 read-model fields.
- Judgment vs mechanics, ACCEPT ≠ merge, and kill criteria remain coherent product discipline.

### Narrative vs evidence

| Narrative | Evidence |
|-----------|----------|
| “Unattended continuation after laptop closes” | Mailbox + idle heuristics documented; live Connect subscribe/poll unproven |
| “Workers do not get dispatch tools” | Config guidance only; no enforcement mechanism |
| “Exactly one follow-up” | Receipts + mailboxId design; delivery trigger undefined → metric cannot fire |
| “Stock T3 is enough” | HTTP/RPC shapes from source; OVHC version not pinned |
| “Temporal for durability” | Assumed primary; T3 already durable for commands—assignment store not justified by measurement |

Story no longer outruns T3 *capabilities*, but it still outruns *delivery detection* and *MCP binding*—the two pieces that make the product story true.

### Questions

1. After a worker turn leaves `running`, what exact observation moves the assignment to `delivered`—and what is the timeout if no commit appears?
2. How does `assign_work` learn `supervisorThreadId` without T3’s thread-scoped MCP credential?
3. For v0, is Temporal load-bearing, or is a single-process durable table + T3 receipts enough until the gate passes?
4. If you are mid-compose on the phone (no turn started), is injecting a follow-up acceptable, or is that still a P0 product failure?
5. Which OVHC T3 version/hash is the contract baseline—`main` from the clone day, or the installed 0.0.38 build?

### Recommendation

**Revise P0 items, then spike.** Do not start Temporal+Postgres production work or v1 policy. Close delivery detection and supervisor-thread binding in CONTRACTS, fix the assign_work inconsistency and FR-4 wording, then run the three TESTING gate rows on OVHC.
