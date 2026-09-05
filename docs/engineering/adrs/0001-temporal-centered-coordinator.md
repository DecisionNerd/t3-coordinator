# ADR-0001: Temporal-centered coordinator around stock T3

- **Status:** Proposed (pending v0 gate)
- **Date:** 2026-09-05

## Context

T3 Code provides desktop/phone access, provider sessions, and worktrees, but not durable multi-agent coordination. We need a **frontier-model supervisor** (Fable, Astra, or equivalent) to supervise Composer/GLM workers through assign → deliver → review → revise, including unattended continuation and restart recovery, without forking T3.

Source review of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (see [`../T3-INTEGRATION.md`](../T3-INTEGRATION.md)): HTTP `POST /api/orchestration/dispatch`, client-supplied command/thread ids, command receipts, `thread.turn.start` + `prepareWorktree`, turn-end when the session leaves `running`, **no** cross-thread wake, **no** arbitrary MCP attach (T3 `/mcp` is the `t3-code` toolkit only).

Dissent from [the docs review](../../../.redteam/reviews/coordinator-docs-review.md): the pain is “stop pasting handoffs”; buying a self-hosted workflow platform plus a T3 adapter is a larger commitment. This ADR stays **Proposed** until FR-2, FR-4, and FR-5 pass on live T3.

Alternatives considered:

- **Manual handoffs / thin T3 MCP only** — proves the loop but does not provide durable wake-up, recovery, or policy enforcement.
- **Jean as primary orchestrator** — has MCP worktree/session tools, but worker sessions leave the established T3 phone/Connect workflow.
- **Agent Orchestrator (AO)** — closer to a coding coordinator out of the box; remote-first, phone, and re-engagement gaps.
- **CrewAI hierarchical manager** — wrong boundary (second AI manager above the supervisor).
- **T3 fork** — rejected; T3 stays stock.
- **Hardcoded Astra supervisor** — rejected; supervisor is a frontier-model role.

## Decision

Build **t3-coordinator** as a separate TypeScript service:

1. **Stock T3** remains the human interface and session owner.
2. A **frontier-model supervisor** retains engineering judgment via a small **MCP** tool surface.
3. **Temporal** owns durable workflow state, waits, retries, and continuation (`AssignmentWorkflow` in v0).
4. A **T3 API adapter** performs create/observe/resume of worker sessions and mailbox follow-ups.
5. Keep AO as a **reference/fallback**, not a prerequisite.
6. Slice may use Temporal’s dev server. Production PostgreSQL is ADR-0002, not a v0 blocker.

## Consequences

- We own a narrow integration layer (T3 adapter + mailbox + engineering policy) instead of adapting an entire competing application.
- We must prove the vertical slice (dispatch, kill/recover, one supervisor revision via mailbox) before building full scheduling.
- Accepting this ADR is a one-way *process* door only after the spike; until then the design is reversible.
- Version-sensitive T3 behavior is concentrated in one adapter; incompatible T3 versions fail closed.
- Supervisor identity is `environmentId` + `supervisorThreadId`, not a model brand.
