# Model selection

Rank ∩ gate. Sticky `defaults.json` is not a pick. Attribution: [artificialanalysis.ai](https://artificialanalysis.ai/).

## Rank (hourly)

- HTTP: `GET https://artificialanalysis.ai/api/v2/data/llms/models` with `x-api-key`.
- Cache: `~/.t3-coordinator/cache/aa-llms.json` (`fetchedAt`). **TTL = 1 hour.** Fetch **only if missing or stale**. Dispatch must not HTTP when the file is fresh.
- `t3-coordinator start` runs the same fetch-if-stale check on boot and every hour.
- Identify models by AA stable **`id`**, not slug/name.
- 429/5xx → keep last good cache (`rankingSource = aa_stale`). No file + no key → `ranking_unavailable`.
- Do **not** call CritPt for selection.
- API key stays in `~/.t3-coordinator/` / env — never in worker prompts.

## Gate (T3)

Live `providers[]` from WS RPC `server.getConfig` (`orchestration:read`). **Not** `/api/orchestration/*`. `server.refreshProviders` when `checkedAt` is stale or `usageLimits.unavailable.reason=probeFailed`.

Runnable: enabled + installed; availability not `unavailable`; status `ready`|`warning`; auth `authenticated`; model slug/alias on **that** instance; usage windows below cap (skip if `unsupported`; `probeFailed` after one refresh → `usage_unknown`).

## Map

`templates/models/t3-to-aa.json` overlay `~/.t3-coordinator/models/t3-to-aa.json` (and repo `.t3/models/t3-to-aa.json`). Unmapped T3 models stay eligible but **unranked**.

## Workers (`implement` / `investigate`)

Quality/cost-per-task **Pareto frontier**, not max Q.

- Q: implement = coding index; investigate = intelligence index.
- C: `pricing.price_1m_blended_3_to_1` (floor 0.01).
- Drop below `minCodingIndex` / `minIntelligenceIndex`.
- Discard dominated (weaker and as-expensive-or-worse).
- On the frontier pick **max Q/C**. Skip if tightest usage window ≥ worker cap (default **90%**).

## Reviewers

If T3 has a runnable `class: frontier` mapping (or intelligence floor), pick the highest-intelligence of those — not the cheap implement pick. Else recorded `reviewFallback`.

## Fail closed

`provider_unavailable` · `model_missing` · `usage_exhausted` · `usage_unknown` · `ranking_unavailable` — `StepFailure` + mailbox, zero dispatch.
