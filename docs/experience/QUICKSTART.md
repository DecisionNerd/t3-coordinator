# Quick start

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

`ensure-mcp` writes the supervisor provider MCP config. **Start a new chat** (or restart the provider session) after that — any MCP chat can assign. No sticky bind is required; the first assign auto-creates an operator inbox mailbox if needed.

Optional: `bind-supervisor` only if you want a specific T3 thread to receive follow-ups; caller thread / env still wins when provided.

Optional: copy and edit a workflow profile so helpers match how you work — [OPERATING-PROFILE.md](OPERATING-PROFILE.md).

GitHub repo comes from the **current T3 project checkout** (no sticky `--github` default). Optional worker prefs for push/assign:

```bash
t3-coordinator defaults-set \
  --t3-project <uuid> \
  --instance cursor \
  --model composer-2.5
```

If MCP is not already inside a git work tree, the tools return `need_repo` and ask you to open the right project (or set `COORD_PROJECT_CWD`).

## Every session

```bash
t3-coordinator start
```

Leave that running. The host spawns `t3-coordinator mcp` when the supervisor needs tools — do not start MCP yourself as a second daemon.

## First assignment (DX)

From any MCP supervisor chat (after ensure-mcp + optional worker prefs). Stay thin: dispatch workers; do not implement here.

| Phrase | Effect |
|---|---|
| `192` | Push issue #192 to a worker |
| `complete M2` | Next open issue on milestone M2 → worker |
| `complete epic 50` | Next open child of parent #50 → worker |
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

Next: [TESTBED.md](TESTBED.md) · [DX-PATHS.md](DX-PATHS.md) · [OPERATING-PROFILE.md](OPERATING-PROFILE.md) · [Published docs](https://decisionnerd.github.io/t3-coordinator/guides/quick-start/)
