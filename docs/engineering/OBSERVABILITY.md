<!-- LLM: This document defines how the team knows the product works in production. Read
the applicable retained docs: ../PRODUCT.md when present, ../REQUIREMENTS.md, relevant
experience artifacts, ARCHITECTURE.md, and
PUBLISHING.md first. Cover both system health and user outcomes; logs and uptime alone are
not enough. Interview the user about actual telemetry, ownership, privacy, alerting, and the
feedback loop into continuous discovery. Remove LLM comments as you complete each section. -->

# Observability

_How do we know the system is healthy, users are succeeding, and our product hypotheses are
true in production?_

## Observable outcomes

<!-- LLM: Connect product goals, experience hypotheses, and requirements to production
signals. Distinguish a technical signal from the user or business outcome it proxies. -->

| Outcome / requirement | Signal | Source | Expected range | Owner |
|---|---|---|---|---|
| _Goal, hypothesis, FR/NFR_ | _Event, metric, trace, log, feedback_ | _System/tool_ | _Target or baseline_ | _Role/team_ |

## Service health

<!-- LLM: Define SLIs/SLOs and critical dependencies with measurable targets. Include
availability, latency, correctness, freshness, saturation, or cost only where relevant. -->

| Service / journey | Indicator | Objective | Window |
|---|---|---|---|
| _Name_ | _SLI_ | _SLO_ | _Period_ |

## Telemetry design

<!-- LLM: Document the event taxonomy and logs/metrics/traces needed to explain important
journeys and failures. Link event names back to requirements and domain language. State
sampling, retention, correlation, and cardinality rules where they matter. -->

- **Events:** _User-visible outcomes and product-learning signals._
- **Logs:** _Structured diagnostic facts and correlation identifiers._
- **Metrics:** _Aggregated health, capacity, cost, and outcome measures._
- **Traces:** _End-to-end flow across relevant boundaries._

## Dashboards and alerts

<!-- LLM: Name the dashboards people actually use. Alerts must be actionable: identify the
owner, trigger, severity, and response. Avoid alerting on symptoms no one can act on. -->

| Signal | Trigger | Severity | Owner | Response |
|---|---|---|---|---|
| _Signal_ | _Threshold or anomaly_ | _Level_ | _Role/team_ | _Runbook or action_ |

## Privacy and safety

<!-- LLM: Capture consent, sensitive-data exclusions, access controls, retention, deletion,
and regional constraints. Observability must not create a shadow user-data store. -->

- _Privacy, security, or compliance rule._

## Production learning loop

<!-- LLM: Explain how production evidence reaches product and design work. Name the review
cadence, participants, thresholds for action, and how findings update experience artifacts,
requirements, design, tests, or strategy. -->

_How does observation become the next discovery input rather than a dashboard nobody reads?_
