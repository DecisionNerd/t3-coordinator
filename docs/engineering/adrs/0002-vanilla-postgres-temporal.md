# ADR-0002: Vanilla PostgreSQL for Temporal persistence

- **Status:** Proposed (production intent; not a v0 blocker)
- **Date:** 2026-09-05

## Context

Temporal requires a supported persistence backend for durable workflows. The v0 slice may run on Temporal’s development server. This ADR is the intended **production** persistence choice, not a prerequisite for the T3 coupling spike.

Options discussed:

- **SQLite as the center of a single-process architecture** — conflicts with the Temporal-centered design.
- **Turso (SQLite-compatible)** — cannot replace Temporal’s PostgreSQL backend.
- **Turso’s Postgres-compatible initiative** — `SELECT … FOR UPDATE/SHARE` is accepted and silently ignored; Temporal relies on those locks.
- **Temporal Cloud** — viable if we want to avoid self-hosting the database; coordinator workers still run on OVHC-AGENCY.
- **Vanilla PostgreSQL** — supported path for self-hosted Temporal.

## Decision

When Temporal leaves the dev server: use **vanilla PostgreSQL**. Do not use Turso/SQLite underneath Temporal. Optional application-level caches are deferred.

## Consequences

- Self-hosted Temporal + PostgreSQL ops (backups, upgrades, recovery) become in scope on OVHC-AGENCY—or we may choose Temporal Cloud without changing the coordinator’s logical design.
- The v0 gate does not wait on Postgres provisioning.
- Revisit Turso Postgres only when required locking semantics exist and Temporal crash tests pass against it.
