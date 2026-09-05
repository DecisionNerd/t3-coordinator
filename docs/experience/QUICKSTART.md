# Quick start

Run the coordinator beside stock T3 against the paired **[dev-skills](https://github.com/DecisionNerd/dev-skills) repo** (see [TESTBED.md](TESTBED.md)), then walk a [DX path](DX-PATHS.md).

**OVHC note:** the craft skills pack (DocSlime, RedTeam, Impeccable, issues/milestones, …) is **not** installed on OVHC. You only need the `dev-skills` **git checkout** as a T3 project there. Run SDLC craft on the operator machine — see [TESTBED.md](TESTBED.md).

## Prerequisites

| Need | Check |
|---|---|
| T3 Code running | App/server listening (local often `http://127.0.0.1:3773`) |
| Temporal CLI | `brew install temporal` or [CLI install](https://docs.temporal.io/cli#install) |
| Node 20+ | `node -v` |
| **`dev-skills` clone** as a T3 project | Same repo as [TESTBED.md](TESTBED.md) — not “skills installed on the host” |

## Install coordinator (OVHC / no git clone)

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
# ensure ~/.local/bin is on PATH
t3-coordinator version
```

Dev checkout alternative: `git clone` → `npm install` → use `npm start` / `npm run cli` as before.

## One-time setup

```bash
t3-coordinator auth-issue --ttl 30d --label t3-coordinator
t3-coordinator doctor
```

In T3, open (or create) the **supervisor** thread you want bound. Copy its thread id, then:

```bash
t3-coordinator bind-supervisor --environment env-local --thread <supervisorThreadId>
```

Wire coordinator MCP on the **supervisor provider only** (not workers):

```json
{
  "mcpServers": {
    "t3-coordinator": {
      "command": "t3-coordinator",
      "args": ["mcp"]
    }
  }
}
```

## Every session

```bash
t3-coordinator start    # Temporal (auto) + worker
t3-coordinator doctor   # optional sanity
```

Leave `t3-coordinator start` running. Do **not** run `t3-coordinator mcp` as a second daemon — the host spawns it.

## First assignment (smoke on `dev-skills`)

Prefer MCP `assign_work` from the supervisor once MCP is loaded. Equivalent CLI client for debugging:

```bash
DEV_SKILLS=/path/to/dev-skills   # clone of github.com/DecisionNerd/dev-skills
BASE=$(git -C "$DEV_SKILLS" rev-parse HEAD)
COORD_REPO=<t3-project-uuid-for-dev-skills> \
COORD_SPEC_SHA=$BASE \
COORD_BASE_COMMIT=$BASE \
COORD_ENV_ID=env-local \
COORD_INSTANCE_ID=cursor \
COORD_MODEL_ID=composer-2.5 \
COORD_PROJECT_CWD="$DEV_SKILLS" \
COORD_BASE_BRANCH=main \
COORD_GOAL='…bounded task in this repo; must commit with Coordinated-By trailer…' \
npm run workflow -- assignment
```

(From an install-only host without a checkout, prefer MCP `assign_work`; the `npm run workflow` helper is checkout-oriented.)

Omit `COORD_WORKTREE` so the adapter creates `~/.t3-coordinator/worktrees/<threadId>` under that clone.

When status is `in_review`, the supervisor calls `submit_review` (or signal Temporal for smoke):

```bash
temporal workflow signal -w assignment-<id> --name review \
  --input '{"verdict":"ACCEPT","deliverySha":"<sha>"}'
```

## Roles in one line

| Role | Owns |
|---|---|
| You | Objectives, GitHub issues/milestones on `dev-skills`, merge authorization |
| Supervisor (frontier) | Spec, `assign_work`, `submit_review`, pause/cancel |
| Coordinator | Durability, mailbox, delivery SHA gate, recovery |
| Worker (Composer/GLM) | Isolated worktree in the `dev-skills` clone + trailer commit |
| T3 | Threads, providers, UI |

Next: [TESTBED.md](TESTBED.md) (pairing) · [DX-PATHS.md](DX-PATHS.md) (design / milestone / single-issue).
