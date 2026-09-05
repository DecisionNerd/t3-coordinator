# t3-coordinator

Durable engineering coordination around **stock T3 Code**: a **frontier-model supervisor** (Fable, Astra, or equivalent) supervises Composer/GLM workers via MCP; Temporal owns waits, recovery, and continuation; T3 remains the desktop/phone interface.

See **[`docs/experience/TESTBED.md`](docs/experience/TESTBED.md)** (paired **dev-skills** repo + **DocSlime / RedTeam / Impeccable** SDLC — not skills-on-OVHC), **[`docs/experience/QUICKSTART.md`](docs/experience/QUICKSTART.md)**, and **[`docs/experience/DX-PATHS.md`](docs/experience/DX-PATHS.md)**. Product: [`docs/PRODUCT.md`](docs/PRODUCT.md). Contracts: [`docs/engineering/CONTRACTS.md`](docs/engineering/CONTRACTS.md). T3 wire: [`docs/engineering/T3-INTEGRATION.md`](docs/engineering/T3-INTEGRATION.md).

## Status

Live HTTP adapter works against local T3 **0.0.38**. First end-to-end assignment on the paired **[dev-skills](https://github.com/DecisionNerd/dev-skills) repo** completed. Operator SDLC is paired with **DocSlime / RedTeam / Impeccable** (and delivery craft); none of that pack is assumed installed on OVHC — only the git checkout is required as the T3 project ([TESTBED](docs/experience/TESTBED.md)). ADRs stay **Proposed** until the full [v0 gate](docs/engineering/TESTING.md) checklist is green.

## Install (no git clone)

Same pattern as DocSlime — curl the installer; it downloads a GitHub archive, builds under `~/.t3-coordinator/app`, and puts `t3-coordinator` on `~/.local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/DecisionNerd/t3-coordinator/main/scripts/install.sh | sh
```

Overrides: `T3_COORDINATOR_REF` (branch/tag, default `main`), `T3_COORDINATOR_INSTALL_DIR`, `T3_COORDINATOR_BIN_DIR`.

## Run

Day-to-day is one process:

```bash
t3-coordinator auth-issue   # once: writes ~/.t3-coordinator/credentials.json
t3-coordinator start
```

From a git checkout instead: `npm install && npm start` (same behavior).

That ensures Temporal on `localhost:7233` (starts `temporal server start-dev --headless` if needed) and runs the worker. MCP is **not** a second terminal — wire it once on the supervisor provider so the host spawns `t3-coordinator mcp` over stdio:

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

One-time binding (not every start):

```bash
t3-coordinator bind-supervisor --environment env-local --thread <supervisorThreadId>
```

| Command | Role |
|---|---|
| `t3-coordinator start` / `npm start` | Operator service: Temporal (auto) + worker |
| `t3-coordinator mcp` / `npm run mcp` | Host-spawned MCP entry (stdio); do not run as a daemon |
| `npm run worker` | Worker only (Temporal already running; checkout only) |
| `t3-coordinator doctor` | Auth + binding + snapshot check |
| `npm test` | Unit + AssignmentWorkflow tests (checkout only) |

`T3_COORDINATOR_AUTO_TEMPORAL=0` or `t3-coordinator start --no-temporal` skips auto-start. `TEMPORAL_ADDRESS` overrides the default host:port. Do **not** set `COORD_WORKTREE` to a project cwd — omit it so the adapter creates `~/.t3-coordinator/worktrees/<threadId>`.
