# t3-coordinator

Durable engineering coordination around **stock T3 Code**: a **frontier-model supervisor** assigns work to Composer/GLM workers via MCP; Temporal owns waits and recovery; T3 stays the desktop/phone UI.

**Docs:** [decisionnerd.github.io/t3-coordinator](https://decisionnerd.github.io/t3-coordinator/) · [Product](docs/PRODUCT.md) · [Contracts](docs/engineering/CONTRACTS.md) · [T3 wire](docs/engineering/T3-INTEGRATION.md)

## Quick start

### Prerequisites

| Need | Check |
|---|---|
| T3 Code | Listening (often `http://127.0.0.1:3773`) |
| Temporal CLI | `brew install temporal` or [install docs](https://docs.temporal.io/cli#install) |
| Node 20+ | `node -v` |
| A git repo in T3 | e.g. [dev-skills](https://github.com/DecisionNerd/dev-skills) added as a project |

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
# ensure ~/.local/bin is on PATH
t3-coordinator version
```

### One-time setup

```bash
t3-coordinator auth-issue --ttl 30d --label t3-coordinator
t3-coordinator bind-supervisor --environment env-local --thread <supervisorThreadId>
```

Wire MCP on the **supervisor provider only**:

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

### Every session

```bash
t3-coordinator start
```

Leave that running. From the supervisor: commit a `specSha`, call `assign_work`, then `submit_review` when delivery lands.

Full walkthrough: [Quick start](https://decisionnerd.github.io/t3-coordinator/guides/quick-start/) · [DX paths](https://decisionnerd.github.io/t3-coordinator/guides/dx-paths/) · [Customize workflow](https://decisionnerd.github.io/t3-coordinator/guides/customize-workflow/)

## Status

Works against local T3 **0.0.38**. First end-to-end assignment completed on [dev-skills](https://github.com/DecisionNerd/dev-skills). ADRs stay **Proposed** until the [v0 gate](docs/engineering/TESTING.md) is fully green.

## Commands

| Command | Role |
|---|---|
| `t3-coordinator start` | Temporal (auto) + worker |
| `t3-coordinator mcp` | Host-spawned stdio MCP — do not run as a daemon |
| `t3-coordinator doctor` | Auth, binding, snapshot, profile paths |
| `npm test` | Unit + workflow tests (checkout) |
| `npm run docs:dev` | Local Starlight docs |

`t3-coordinator start --no-temporal` or `T3_COORDINATOR_AUTO_TEMPORAL=0` skips auto Temporal. Do not set `COORD_WORKTREE` to a project cwd — omit it so worktrees go under `~/.t3-coordinator/worktrees/<threadId>`.

From a git checkout: `npm install && npm start` (same as `t3-coordinator start`).

## Docs site (local)

```bash
npm run docs:dev
# or: npm run docs:build
```

Starlight sources live in [`website/`](website/). GitHub Pages deploys from `.github/workflows/docs.yml` on pushes to `main` that touch `website/`.
