# Documentation

Living docs for **t3-coordinator**: a Temporal-backed coordination service around stock T3 Code, with a **frontier-model supervisor** (Fable, Astra, or equivalent) and isolated implementation workers.

## How the docs are organized

| Document | Question it answers |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | What is this product, who is it for, and why does it exist? |
| [`DESIGN.md`](DESIGN.md) | What should stay consistent in tools, vocabulary, and operator UX? |
| [`experience/`](experience/) | Testbed + SDLC pairings (`dev-skills` repo; DocSlime / RedTeam / Impeccable), quick start, DX paths. |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | v0 gate vs v1 policy — what must the system demonstrably do? |
| [`engineering/CONTRACTS.md`](engineering/CONTRACTS.md) | MCP, state machine, mailbox, reconciliation. |
| [`engineering/T3-INTEGRATION.md`](engineering/T3-INTEGRATION.md) | Evidence from pingdotgg/t3code, not guesses. |
| [`engineering/ARCHITECTURE.md`](engineering/ARCHITECTURE.md) | How is the system built? |
| [`engineering/TESTING.md`](engineering/TESTING.md) | How do we prove the v0 gate? |
| [`engineering/PUBLISHING.md`](engineering/PUBLISHING.md) | How does a verified change reach users safely? |
| [`engineering/OBSERVABILITY.md`](engineering/OBSERVABILITY.md) | How do we know it works and feed learning back? |

## Conventions

- **Keep docs current.** When behavior changes, update the doc in the same change.
- **Link, don't duplicate.** Contracts live in `engineering/CONTRACTS.md`.
- **Supervisor, not a brand.** Write “frontier-model supervisor”; name Fable or Astra only as examples.
- **Decisions stay Proposed** until the v0 gate in TESTING.md is green.
- **Slice before policy.** FR-7–9 do not block implementation of the adapter.

## Source

- Design distilled from [Codex conversation](https://chatgpt.com/s/cx_6a9c1a34fedc8191ab31c610eaaabed4).
- Adversarial review: [`.redteam/reviews/coordinator-docs-review.md`](../.redteam/reviews/coordinator-docs-review.md).
