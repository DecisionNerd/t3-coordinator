---
title: Quick start
description: Install, bind a supervisor, and complete one reviewed assignment.
---

Get from zero to one reviewed assignment without pasting handoffs.

## You will need

| Need | Check |
|---|---|
| T3 Code | Listening (often `http://127.0.0.1:3773`) |
| Temporal CLI | `brew install temporal` or [install docs](https://docs.temporal.io/cli#install) |
| Node 20+ | `node -v` |
| A git repo in T3 | e.g. clone [dev-skills](https://github.com/DecisionNerd/dev-skills) and add it as a project |

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
# put ~/.local/bin on PATH if needed
t3-coordinator version
```

Developing from a clone: `npm install`, then `npm start` / `npm run cli` instead of the `t3-coordinator` binary.

## One-time setup

```bash
t3-coordinator auth-issue --ttl 30d --label t3-coordinator
t3-coordinator ensure-mcp    # all providers — pick any supervisor in a new T3 chat
t3-coordinator doctor
```

`ensure-mcp` writes the supervisor provider MCP config. **Start a new T3 chat** after that — no per-thread bind is required to see tools.

Optional: `bind-supervisor` only for a sticky mailbox thread; assign/push can pass `supervisorThreadId` and auto-bind.

Optional: copy and edit a workflow profile so helpers match how you work — [Customize your workflow](/t3-coordinator/guides/customize-workflow/).

GitHub repo comes from the **current T3 project checkout** (no sticky `--github` default). Optional worker prefs for push/assign:

```bash
t3-coordinator defaults-set \
  --t3-project <uuid> \
  --instance cursor \
  --model composer-2.5
```

If MCP is not already inside a git work tree, tools return `need_repo` and ask which project to open (or set `COORD_PROJECT_CWD`).

## Every session

```bash
t3-coordinator start
```

Leave that running. The host spawns `t3-coordinator mcp` when the supervisor needs tools — do not start MCP yourself as a second daemon.

## First assignment (DX)

From the supervisor (after ensure-mcp + optional worker prefs):

| Phrase | Effect |
|---|---|
| `192` | Push issue #192 |
| `complete M2` | Next open issue on milestone M2 |
| `complete epic 50` | Next open child of parent #50 |
| `create epic …` / `close 192` / `status M2` | Lifecycle (mutations: tools + `apply:true`) |

Then wait for delivery; supervisor calls `submit_review` with ACCEPT / REVISE / BLOCKED.

Low-level alternative: commit a `specSha`, call `assign_work` directly.

Debug from a coordinator checkout (install-only hosts: skip this and use MCP):

```bash
DEV_SKILLS=/path/to/dev-skills
BASE=$(git -C "$DEV_SKILLS" rev-parse HEAD)
COORD_REPO=<t3-project-uuid> \
COORD_SPEC_SHA=$BASE \
COORD_BASE_COMMIT=$BASE \
COORD_ENV_ID=env-local \
COORD_INSTANCE_ID=cursor \
COORD_MODEL_ID=composer-2.5 \
COORD_PROJECT_CWD="$DEV_SKILLS" \
COORD_BASE_BRANCH=main \
COORD_GOAL='…bounded task; commit with Coordinated-By trailer…' \
npm run workflow -- assignment
```

Omit `COORD_WORKTREE` so worktrees land under `~/.t3-coordinator/worktrees/<threadId>`.

Smoke review without MCP:

```bash
temporal workflow signal -w assignment-<id> --name review \
  --input '{"verdict":"ACCEPT","deliverySha":"<sha>"}'
```

## Who does what

| Role | Owns |
|---|---|
| You | Goals, issues/milestones, merge yes/no |
| Supervisor | Spec, `assign_work`, `submit_review`, pause/cancel |
| Coordinator | Waits, mailbox, delivery gate, recovery |
| Worker | Isolated worktree + trailer commit |
| T3 | Threads, providers, UI |

## Next

- [Where work happens](/t3-coordinator/guides/where-work-happens/)
- [DX paths](/t3-coordinator/guides/dx-paths/)
- [Customize your workflow](/t3-coordinator/guides/customize-workflow/)
