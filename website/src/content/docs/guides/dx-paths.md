---
title: DX paths
description: Design, milestone, and single-issue journeys with the coordinator.
---

Three ways to use the coordinator. GitHub (or your tracker) holds intent; the coordinator holds durable handoffs.

Helpers named below are optional — use them if you have them, or the equivalent steps by hand. To change defaults, see [Customize your workflow](/t3-coordinator/guides/customize-workflow/).

## At a glance

| Your work item | Coordinator |
|---|---|
| Milestone | Many turns; close criteria stay on the milestone |
| Issue | One `assign_work` → one delivery SHA → review |
| Issue + BDD | Committed `specSha` (oral assign does not count) |
| Implementation | Worker in an isolated worktree + trailer |
| Review | `submit_review`: ACCEPT \| REVISE \| BLOCKED |
| Ship | You merge (ACCEPT ≠ merge) |

**Flow:** you / GitHub issue → supervisor (`specSha`) → `assign_work` → worker delivery SHA → mailbox → `submit_review` → you merge.

## Path A — Design → plan → implement → review

**When:** New API, UX contract, or risky refactor.

1. **Design** — Capture constraints on the issue.
2. **Plan** — Falsifiable plan with BDD; commit → **`specSha`**.
3. **Assign** — Supervisor `assign_work`.
4. **Implement** — Worker worktree; delivery = `Coordinated-By: <assignmentId>` commit.
5. **Review** — Mailbox wakes supervisor; ACCEPT / REVISE / BLOCKED.
6. **Integrate** — You land the PR. Coordinator does not auto-merge.

## Path B — Milestone (many turns)

**When:** Several issues under one close criteria.

Default order = **next critical-path open issue**, not spawn everyone. For each issue: spec → `assign_work` → wait → `submit_review` → PR → next issue.

**Rules of thumb:** one implementation worker per issue in v0; pause if the supervisor needs a design digression; finish REVISE before opening another front.

## Path C — Single issue

**When:** One bug or small feature.

Read `#N` → plan/`specSha` → `assign_work` → review → PR that closes `#N`. Skip the coordinator for trivial one-liners.

## Don’t

| Don’t | Do |
|---|---|
| Treat Temporal as the backlog | Keep issues on GitHub |
| Assign without `specSha` | Commit the plan first |
| Point worktree at the main checkout | Let the adapter create `~/.t3-coordinator/worktrees/…` |
| ACCEPT and assume merged | Run your normal PR path |
| Give workers coordinator MCP | Supervisor provider only |
