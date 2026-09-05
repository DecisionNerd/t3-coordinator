# T3 Code integration (from source)

Reviewed against [pingdotgg/t3code](https://github.com/pingdotgg/t3code) `main` (clone 2026-09-05). This is what the coordinator may use. It is **not** a live spike against OVHC.

T3 Code is an agent-harness control surface: a Node server wraps provider CLIs (Codex, Claude, Cursor, Grok, OpenCode, Antigravity) and serves web, desktop, and mobile. Execution, credentials, Git, and files belong to the **environment** (the server), not the client. See their [internals overview](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md) and [glossary](https://github.com/pingdotgg/t3code/blob/main/docs/internals/glossary.md).

## What we can call

Authenticated HTTP (`packages/contracts/src/environmentHttp.ts`):

| Method | Path | Scope | Use |
|---|---|---|---|
| GET | `/api/orchestration/snapshot` | `orchestration:read` | Shell/list read model |
| GET | `/api/orchestration/threads/:threadId` | `orchestration:read` | Thread snapshot (optional turn window) |
| POST | `/api/orchestration/dispatch` | `orchestration:operate` | Client orchestration commands |

WebSocket RPC (`ORCHESTRATION_WS_METHODS`): `orchestration.dispatchCommand`, `subscribeThread`, `subscribeShell`, `getTurnDiff`, `getFullThreadDiff`, `searchThreads`. Dispatch over HTTP is enough to start work; **completion** needs `subscribeThread` or polling the thread snapshot. Command ack is not turn-complete.

Auth: environment pairing issues scoped sessions (`orchestration:read`, `orchestration:operate`, …). A coordinator credential should have operate+read, not `access:write`. Pairing secrets are shown once. Relay/Connect tokens are a different trust boundary.

## Commands we will use

Client supplies **`commandId` and `threadId`**. T3 does not mint them. `DispatchResult` is `{ sequence }` only.

Idempotency is real: the engine looks up a receipt by `commandId`. Same id + same aggregate returns the prior sequence; same id + different aggregate is a conflict; a rejected receipt stays rejected. Persist our ids **before** POST.

| Command | v0 use |
|---|---|
| `thread.create` | Optional; `thread.turn.start` bootstrap can create instead |
| `thread.turn.start` | Start worker (and supervisor follow-up) with user message |
| `thread.turn.start.bootstrap.prepareWorktree` | Isolated checkout: `projectCwd`, `baseBranch`, optional `branch`, `startFromOrigin` |
| `thread.turn.start.bootstrap.createThread` | New thread: `projectId`, title, `modelSelection`, modes, `branch`, `worktreePath` |
| `thread.turn.interrupt` | Cancel in-flight worker |
| `thread.session.stop` | Stop provider session (`onlyIfSettled` is T3’s race guard, not ours) |
| `thread.meta.update` | Model/worktree/title after create |

`ModelSelection` is `{ instanceId, model }` (legacy `{ provider, model }` is decoded to a default instance id). There is **no** “frontier” type on the wire. Fable/Astra are models on a Codex (or other) **instance**.

`worktreePath` on create/bootstrap may be null; isolation comes from `prepareWorktree`, which matches the UI **New worktree** flow ([thread sidebar](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md)).

## What “done” means in T3 (and what it does not)

From the [overview](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md): the event log is source of truth; reactors do I/O after intent commits. **Command accepted ≠ provider finished.**

Turn end: the projector treats **session leaving `running`** as the turn-end signal (`latestTurn.state`: `running` \| `interrupted` \| `completed` \| `error`). Checkpoint/diff can finish later and must not be treated as the agent still working.

**`thread.settle` is list hygiene** (hide from active threads, auto-settle after idle/PR merge). It is **not** “worker delivered a commit.” Delivery SHA remains our git/evidence check.

## Idle vs busy (mailbox)

T3 will **queue** another `thread.turn.start` on the same thread (queued user message until a turn adopts it; 2-minute grace in `ThreadSettlementPolicy`). There is no “refuse if human is typing” API.

Treat `supervisorThreadId` as **busy** (do not send follow-up) when any of:

- `latestTurn.state === "running"`
- `session.status` is `starting` or `running`
- a queued turn start exists (`threadHasQueuedTurnStart`)
- pending approval or user-input activity (“raised hand”)

Otherwise it is **idle** enough to dispatch one follow-up `thread.turn.start` with our persisted `commandId`.

There is **no** cross-thread “when worker completes, wake supervisor” primitive. That is our mailbox + subscribe/poll.

## MCP: do not use T3’s `/mcp`

T3 injects a **`t3-code` HTTP MCP** into provider sessions for **its own** tools (preview / agent browser). Credentials are minted per thread; `/mcp` accepts only those bearers (`ProviderService.prepareMcpSession`). Withholding the credential disables that toolkit. This is not a plugin slot for t3-coordinator.

OpenCode’s extra MCP adds are **directory-scoped**; T3’s connection is **thread-scoped**. Sharing an OpenCode server across threads in one directory can replace MCP registrations ([providers.md](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md)).

**Coordinator MCP** must be configured on the **supervisor provider’s native config** on the environment (Codex/Cursor/OpenCode home files), scoped so **workers do not load those tools**. T3 has no orchestration command to attach arbitrary MCP to one thread.

## Security notes from T3

- `orchestration:read` can read files the server unix account can read, including paths outside the project. Projects are not a sandbox.
- Checkpoints are hidden Git refs, not user-branch commits.
- Approval callbacks can outlive a turn or restart; resume needs durable request ids, not “the last prompt.”

## Mapping to our contracts

| Our concept | T3 fact |
|---|---|
| `assignmentId` | Ours only |
| `commandId` / `workerThreadId` | Client-supplied; T3 receipts |
| `supervisorThreadId` | T3 `ThreadId` |
| Dispatch | `POST /api/orchestration/dispatch` |
| Worker isolation | `bootstrap.prepareWorktree` + `worktreePath` |
| Turn finished | session/latestTurn left `running` |
| Delivery | Our spec/commit SHA, not T3 checkpoints |
| Follow-up | Another `thread.turn.start` on the supervisor thread when idle |
| Cancel | `thread.turn.interrupt` then optional session stop |

## Version pin (spike baseline)

| Source | Role |
|---|---|
| This file’s `main` clone (2026-09-05) | Contract reference only |
| **Installed OVHC T3** | Spike baseline |

Installed OVHC version: **0.0.38** (`T3 Code (Alpha).app`, server `http://127.0.0.1:3773`)

### Live HTTP finding (0.0.38)

`bootstrap.createThread` / `bootstrap.prepareWorktree` are expanded on the **WebSocket** dispatch path only. `POST /api/orchestration/dispatch` with bootstrap fails with “thread does not exist”. Coordinator HTTP adapter therefore:

1. Creates a local `git worktree`
2. Dispatches `thread.create` with that `worktreePath`
3. Dispatches `thread.turn.start` (no bootstrap)

Auth: `npx t3 auth session issue` → `~/.t3-coordinator/credentials.json` (`npm run cli -- auth-issue`).

## Still unproven on the live server

- Dedicated operate+read-only session (current spike token includes `access:write`)
- WS subscribe vs HTTP poll for turn-end behind Connect
- Supervisor provider MCP loading without worker inheritance
- Full mailbox → `submit_review` loop with a frontier supervisor thread
