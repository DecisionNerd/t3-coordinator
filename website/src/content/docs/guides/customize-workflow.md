---
title: Customize your workflow
description: Change how you prepare specs without reinstalling the coordinator.
---

The coordinator always does the same job: **assign → wait → delivery SHA → review wake-up → recover**. How *you* get to a good `specSha` and how you land PRs is yours to shape.

## What you change vs what you leave alone

| You edit freely | You leave alone |
|---|---|
| `~/.t3-coordinator/operating-profile.json` | `t3-coordinator start` / MCP tools |
| Issue templates, supervisor prompts, repo docs | Installed app under `~/.t3-coordinator/app` |
| Which git repo is the T3 project | Delivery trailer + review verdicts |

Ask your coding agent to update those files when the loop should change. You should not need a new coordinator release to drop a helper, point at another repo, or rename beats.

## Start from the template

```bash
mkdir -p ~/.t3-coordinator
cp ~/.t3-coordinator/app/templates/operating-profile.default.json \
  ~/.t3-coordinator/operating-profile.json
# or from a checkout: templates/operating-profile.default.json
```

Edit the JSON (and your prompts/issue templates) so they match how you actually work. `t3-coordinator doctor` shows whether an active profile file is present — missing craft tools never block the coordinator.

## Default loop (optional helpers)

| Beat | What you need | Common helpers (optional) |
|---|---|---|
| Frame intent | Clear problem + non-goals | DocSlime, or write docs yourself |
| Stress-test | Spec that can fail a review | RedTeam, or supervisor critique |
| Design craft | Only if there is a human surface | Impeccable, or skip |
| Track work | Issues / milestones (or equivalent) | delivery skills, or `gh` alone |
| Dispatch | Committed `specSha` + `assign_work` | Supervisor MCP |
| Review | Diff + evidence | `submit_review` |
| Land | PR / merge you authorize | Your normal PR path |
