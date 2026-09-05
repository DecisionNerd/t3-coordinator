---
title: Where work happens
description: Project in T3 on the host; prepare specs on your laptop.
---

You need two places set up — a **code project in T3**, and (optionally) **how you prepare specs** on your laptop.

- **Laptop:** shape intent (docs, critique, issues/milestones) → committed `specSha`
- **Host:** `t3-coordinator` + stock T3 + workers writing into the project checkout

## Project in T3

Add a git checkout as a T3 project. Workers commit there (in isolated worktrees); delivery SHAs and `Coordinated-By` trailers show up in that repo.

**Suggested first project:** [DecisionNerd/dev-skills](https://github.com/DecisionNerd/dev-skills) — small, safe to thrash while you learn the loop. Point at GraphForge/XYG (or anything else) once you are comfortable; update your [operating profile](/t3-coordinator/guides/customize-workflow/) and prompts to match.

| Item | Example |
|---|---|
| Repo | `https://github.com/DecisionNerd/dev-skills` |
| T3 project title | `dev-skills` |

On another machine, clone path and project id will differ — keep them handy for `assign_work`.

## Preparing work (laptop)

Before `assign_work`, someone has to produce a committed spec. You can do that with plain GitHub + the supervisor, or with helpers you already like (DocSlime, RedTeam, issues/milestones, or just `gh`).

None of that needs to be installed on the remote host. See [DX paths](/t3-coordinator/guides/dx-paths/) for full journeys.

## On a remote host (e.g. OVHC)

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
t3-coordinator auth-issue
t3-coordinator bind-supervisor --environment env-local --thread <supervisorThreadId>
t3-coordinator start
```

Also: T3 running, Temporal CLI on PATH, and the **project checkout** added as a T3 project.
