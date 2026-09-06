---
title: DX paths
description: Issue, milestone, and epic lifecycles with @t3-coordinator phrases.
---

Talk to **@t3-coordinator** with short phrases (MCP `run`) or typed tools. GitHub holds the backlog; the coordinator shapes it **and** runs durable handoffs.

Set defaults once (`t3-coordinator defaults-set …`) and bind a supervisor thread before execute phrases.

## Phrases

| You say | Path | What happens |
|---|---|---|
| *(empty)* / `next` | Orient | Review goals + backlog; decide next action (no auto-assign) |
| `sitrep` / `standup` / `status` | Sitrep | Accomplished / blockers / coming up (`sitrep 14d`) |
| `192` / `#192` | C | Push that issue (spec commit + assignment) |
| `complete M2` | B | Push next open issue on milestone M2 |
| `complete epic 50` | D | Push next open **child** of parent #50 (milestone optional) |
| `status 192` / `plan 192` / `critique 192` / `refine 192` … | Issue admin | Shape / review (mutations need `issue` + `apply:true`) |
| `status M2` / `plan milestone M2` / `create milestone …` / `close M2` | Milestone admin | Full milestone lifecycle |
| `epic 50` / `status epic 50` / `create epic …` / `close epic 50` | Epic admin | Parent tracker lifecycle |

Typed tools: `run`, `next`, `sitrep`, `issue`, `milestone`, `epic`, `push_issue`, `complete_milestone`, `complete_epic`, plus low-level assign/review.

`run` **previews** GitHub mutations; call `issue` / `milestone` / `epic` with `apply: true` to write.

**Empty @mention:** `run` with no phrase (or tool `next`) returns goals + backlog + `supervisorInstructions`. Orientation never starts a worker.

**Sitrep:** `sitrep` / `standup` / tool `sitrep` — recent closes/merges, blockers, upcoming. Optional `~/.t3-coordinator/blockers.md`.

## Path A — Design → plan → implement → review

Shape with `critique` / `plan` / `refine` on the issue, then `192` to dispatch. Review via mailbox + `submit_review`.

## Path B — Milestone campaign

1. `create milestone …` (apply) or use an existing M-number.
2. `plan M2` / `critique M2` / `narrow` / `widen` until membership is right.
3. `complete M2` → one critical-path issue at a time.
4. After ACCEPT, `complete M2` again.
5. `close M2` (apply) when open issues are gone.

## Path C — Single issue

1. `create issue …` or use `#N`.
2. Optional: `plan 192`, `critique 192`, `refine 192` (apply when editing).
3. `192` to push.
4. `close 192` (apply) when done (or close via PR).

## Path D — Epic / parent tracker (no milestone required)

An **epic** is a normal GitHub issue that tracks children via:

- Task list in the body: `- [ ] #12`
- GitHub sub-issues API (when available)
- Search markers: `Epic #50` / `Parent #50` on children

Flow:

1. `create epic Payment redesign` → preview parent; `epic create` + `apply:true` to open it.
2. Add child issues; link them in the epic body (or as sub-issues).
3. `status epic 50` / `plan epic 50` / `critique epic 50`.
4. `complete epic 50` → pushes the next open child.
5. Repeat until children are done; `close epic 50` (apply).

Pushing the **parent** number while children remain open is rejected — use `complete epic` or push a child id.

## Lifecycle cheat sheet

**Issue:** create → status → critique/plan → refine/narrow/widen/update → push → review → close / reopen

**Milestone:** create → list/status → plan/critique → refine/narrow/widen/update → complete (loop) → close

**Epic:** create → status/plan/critique → complete (loop over children) → close parent

## Don’t

| Don’t | Do |
|---|---|
| Treat Temporal as the backlog | Keep issues / milestones / epics on GitHub |
| Assign without a committed spec | `plan` + `commitSpec` or let push auto-commit a thin spec |
| Parallelize a whole milestone/epic in v0 | One critical-path child at a time |
| Give workers coordinator MCP | Supervisor provider only |

## Related

[Quick start](/t3-coordinator/guides/quick-start/) · [Customize your workflow](/t3-coordinator/guides/customize-workflow/) · [Where work happens](/t3-coordinator/guides/where-work-happens/)
