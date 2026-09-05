# Observability

v0 observability exists to catch the two failure modes that kill the product: **lost or duplicate supervisor follow-ups**, and **duplicate workers**. Policy dashboards wait for v1.

## Observable outcomes

| Outcome / requirement | Signal | Source | Expected range | Owner |
|---|---|---|---|---|
| FR-4 exactly one follow-up | `mailbox_sent` count per `assignmentId` + `deliverySha` | Coordinator | = 1 | Operator |
| FR-5 no duplicate worker | `dispatch_adopted` vs `dispatch_created` after restart | Adapter | created = 0 on recover | Operator |
| FR-5 duplicate suppressed | `dispatch_suppressed_duplicate` | Adapter | ≥ 0; investigate if a second thread still appears | Operator |
| FR-6 stay stopped | `assignment_state` remains `cancelled` / `paused` after restart | Temporal | no transition to `dispatched` | Operator |
| FR-11 model portability | `supervisorModelId` labeled, never used as identity | MCP logs | thread id present | Operator |

## Service health

| Service / journey | Indicator | Objective | Window |
|---|---|---|---|
| MCP assign | Assign RPC latency | Return assignment ID without waiting on the worker | Per call |
| Mailbox | Oldest queued follow-up age | Bound TBD after spike; must not drop on phone close | Rolling |
| T3 adapter | Auth / version fail-closed events | 0 silent continues on incompatible T3 | Rolling |

## Telemetry design

- **Events:** `assignment_created`, `dispatch_created`, `dispatch_adopted`, `dispatch_suppressed_duplicate`, `delivery_recorded`, `mailbox_enqueued`, `mailbox_sent`, `mailbox_deferred_busy`, `review_submitted`, `assignment_paused`, `assignment_cancelled`.
- **Logs:** `assignmentId`, `commandId`, `workerThreadId`, `supervisorThreadId`, `specSha`, `deliverySha`, `mailboxId`. No pairing tokens or provider secrets.
- **Metrics:** follow-ups per delivery, duplicate-suppressed launches, revision count, time in `running` / `in_review`.
- **Traces:** assignment ID as the correlation key across MCP → Temporal → T3 adapter.

## Tripwires

| Signal | Threshold | Action |
|--------|-----------|--------|
| Follow-ups per delivery | 0 or >1 | Halt unattended mode; inspect mailbox |
| Second worker thread for one assignment | Once | Halt dispatch; reconcile by hand |
| Adapter requires T3 DB write or fork | Any | Stop the approach |
| Idle signal unavailable | Spike result | Degrade to queued/visible pending; no auto-turn |

## Privacy

Do not log T3 pairing URLs, Connect tokens, or provider credentials. Prefer SHAs and IDs.

## Feedback into discovery

Gate metrics (follow-ups per delivery, duplicate launches) decide whether ADR-0001 can move from Proposed to Accepted—not agent count or thread count.
