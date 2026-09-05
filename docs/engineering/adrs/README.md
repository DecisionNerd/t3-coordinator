# Architecture Decision Records

An **Architecture Decision Record (ADR)** captures one significant decision — the context,
the choice made, and its consequences — so the reasoning lives in the repo alongside the
code. Decisions are immutable once accepted: to change one, add a new ADR that supersedes it.

Until the [v0 gate](../TESTING.md) passes, new stack ADRs should stay **Proposed**.

## Creating an ADR

```
docslime add adr <short-slug>
```

## Status values

- **Proposed** — under discussion or pending a named gate.
- **Accepted** — decided and in effect.
- **Superseded by ADR-NNNN** — replaced by a later decision.
- **Deprecated** — no longer relevant.

## Decision log

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-temporal-centered-coordinator.md) | Temporal-centered coordinator around stock T3 | Proposed (pending v0 gate) | 2026-09-05 |
| [0002](0002-vanilla-postgres-temporal.md) | Vanilla PostgreSQL for Temporal persistence | Proposed (production intent) | 2026-09-05 |
