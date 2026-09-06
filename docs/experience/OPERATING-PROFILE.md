# Customize your workflow

The coordinator always does the same job: **classify or shortcut → process instance → wait → delivery SHA or `StepFailure` → review/failure wake-up → declared `onFail`**. How *you* get to a good `specSha` and how you land PRs is yours to shape. Catalog files are the editable process layer ([NFR-8](../REQUIREMENTS.md)).

Out of the box we document a familiar loop (docs → challenge → issues → assign → review → merge) against a scratch repo. Swap any of that without reinstalling.

## What you change vs what you leave alone

| You edit freely | You leave alone |
|---|---|
| `~/.t3-coordinator/operating-profile.json` | `t3-coordinator start` / MCP tools |
| `~/.t3-coordinator/processes/` and repo `.t3/processes/` (catalog overlay) | Shipped defaults under `templates/processes/` until you copy them |
| `~/.t3-coordinator/models/t3-to-aa.json` (T3 slug → AA `id`) | AA cache file (coordinator-owned) |
| Issue templates, supervisor prompts, repo docs | Installed app under `~/.t3-coordinator/app` |
| Which git repo is the T3 project | Delivery trailer + review verdicts + `onFail` closed set |

Ask your coding agent to update those files when the loop should change. You should not need a new coordinator release to drop RedTeam, point at GraphForge, or rename beats.

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
| Frame intent | Clear problem + non-goals | DocSlime, or write PRODUCT/REQUIREMENTS yourself |
| Stress-test | Spec that can fail a review | RedTeam, or a colleague / supervisor critique |
| Design craft | Only if there is a human surface | Impeccable, or skip |
| Track work | Issues / milestones (or equivalent) | `issues` / `milestones` skills, or `gh` alone |
| Dispatch | Committed `specSha` + `assign_work` | Supervisor MCP |
| Review | Diff + evidence | `submit_review`; optional readiness check |
| Land | PR / merge you authorize | `merge-it`, or your normal PR path |

Craft tools run on the machine where you edit GitHub and docs — usually your laptop. The remote host only needs T3, the coordinator, and a project checkout.

## Next

- [QUICKSTART.md](QUICKSTART.md) — install, auth, first assignment  
- [TESTBED.md](TESTBED.md) — which repo to open in T3  
- [DX-PATHS.md](DX-PATHS.md) — design / milestone / single-issue journeys  
