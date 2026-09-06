# Engineering

Engineering begins with the shared requirements contract and follows it through design,
pre-release evidence, continuous delivery, and production learning.

## Lifecycle

| Document | Responsibility |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How domain boundaries and system components satisfy the requirements. |
| [`CONTRACTS.md`](CONTRACTS.md) | MCP schemas, state machine, mailbox, reconciliation, authz. |
| [`MODEL-SELECTION.md`](MODEL-SELECTION.md) | AA rank (hourly cache) ∩ T3 `server.getConfig` gate. |
| [`TESTING.md`](TESTING.md) | v0 gate and how we prove it. |
| [`PUBLISHING.md`](PUBLISHING.md) | How verified artifacts are versioned, promoted, deployed, and rolled back. |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Follow-up and duplicate-worker signals. |
| [`adrs/`](adrs/) | Why significant product and technical decisions were made. |

## Supporting documentation

| Document | Description |
|---|---|
| [`CONTRACTS.md`](CONTRACTS.md) | Normative v0 implementer contract |
| [`T3-INTEGRATION.md`](T3-INTEGRATION.md) | pingdotgg/t3code HTTP/RPC evidence (`server.getConfig` is WS RPC, not `/api/orchestration/*`) |
| [`MODEL-SELECTION.md`](MODEL-SELECTION.md) | Artificial Analysis catalog + T3 runnable gate |
| [`v0-gate-fix-plan.md`](v0-gate-fix-plan.md) | Closes critique findings; delivery + binding decisions |
| [`adrs/0001-temporal-centered-coordinator.md`](adrs/0001-temporal-centered-coordinator.md) | Stock T3 + Temporal + MCP (Proposed) |
| [`adrs/0002-vanilla-postgres-temporal.md`](adrs/0002-vanilla-postgres-temporal.md) | PostgreSQL persistence (Proposed, production) |

## Decision records

Create the next Architecture Decision Record with:

```sh
docslime add adr <short-slug>
```

Keep the decision log in [`adrs/README.md`](adrs/README.md) synchronized.
