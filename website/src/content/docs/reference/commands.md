---
title: Commands
description: t3-coordinator CLI and day-to-day commands.
---

## CLI

| Command | Role |
|---|---|
| `t3-coordinator start` | Temporal (auto) + worker |
| `t3-coordinator mcp` | Host-spawned stdio MCP — do not run as a daemon |
| `t3-coordinator auth-issue` | Write `~/.t3-coordinator/credentials.json` |
| `t3-coordinator bind-supervisor --environment <id> --thread <id>` | Durable supervisor binding |
| `t3-coordinator get-binding --environment <id>` | Show binding |
| `t3-coordinator doctor` | Auth, binding, snapshot, profile paths |
| `t3-coordinator version` | Print package version |

## Install env overrides

| Variable | Default |
|---|---|
| `T3_COORDINATOR_REF` | `main` |
| `T3_COORDINATOR_INSTALL_DIR` | `~/.t3-coordinator/app` |
| `T3_COORDINATOR_BIN_DIR` | `~/.local/bin` |

## Runtime env

| Variable | Meaning |
|---|---|
| `TEMPORAL_ADDRESS` | Default `localhost:7233` |
| `T3_COORDINATOR_AUTO_TEMPORAL=0` | Skip auto-starting Temporal |
| `T3_COORDINATOR_ENV` | Binding environment id (default `env-local`) |

Do **not** set `COORD_WORKTREE` to a project cwd — omit it so worktrees go under `~/.t3-coordinator/worktrees/<threadId>`.

## From a git checkout

| npm script | Role |
|---|---|
| `npm start` | Same as `t3-coordinator start` |
| `npm run mcp` | Same as `t3-coordinator mcp` |
| `npm run cli -- …` | CLI without global install |
| `npm test` | Unit + workflow tests |
| `npm run docs:dev` | Local Starlight docs site |
