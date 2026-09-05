<!-- LLM: This document is the shared contract between intent and engineering. Translate
evidence from retained local docs, experience/, and linked authoritative context into concrete,
checkable requirements without repeating personas, journeys, research, or proposed
architecture. Give every requirement a stable ID so architecture, tests, ADRs, publishing,
and observability can reference it. Capture acceptance behavior in Given/When/Then language
when it clarifies the observable outcome. Remove LLM comments as you complete each section. -->

# Requirements

<!-- LLM: One-paragraph summary of the scope these requirements cover. -->

_What must the delivered system demonstrably do, and which user or business outcomes does
that contract serve?_

## Functional requirements

<!-- LLM: The behaviors the system must exhibit. Interview the user, then write each as a
single testable "the system shall..." statement with a stable ID. Group by area if helpful.
Link each back to the experience it serves. Ask probing questions: inputs, outputs, edge
cases, error handling, permissions. -->

| ID | Requirement | Derived from | Acceptance behavior |
|---|---|---|---|
| FR-1 | _The system shall …_ | _experience/file.md / product goal_ | _Given … When … Then …_ |
| FR-2 | _The system shall …_ | _experience/file.md / product goal_ | _Observable outcome_ |

## Non-functional requirements

<!-- LLM: Qualities and constraints rather than behaviors — performance, reliability,
security, accessibility, portability, cost. Ask the user for concrete targets where possible
("responds within Xms", "runs offline", "supports macOS and Linux"). -->

| ID | Quality attribute | Target / constraint | Why it matters |
|---|---|---|---|
| NFR-1 | _Performance / reliability / security / accessibility / …_ | _Measurable target_ | _User, design, operational, or regulatory reason_ |
| NFR-2 | _…_ | _…_ | _…_ |

## Behavior trace

<!-- LLM: Optional but strongly recommended for behavior-heavy projects. Capture the small
set of BDD scenarios that prove the highest-value requirements. Link back to the discovery
artifact rather than duplicating its narrative, and expand the scenarios into concrete tests
in engineering/TESTING.md. Remove this section if it adds no value. -->

| Requirement | Given | When | Then |
|---|---|---|---|
| _FR-1_ | _initial context_ | _user/system action_ | _observable outcome_ |

## Constraints & assumptions

<!-- LLM: Capture fixed constraints (tech, regulatory, timeline, budget) and assumptions the
requirements rely on. Ask: "What is non-negotiable? What are we taking for granted that, if
wrong, would change these requirements?" -->

- **Constraint:** _…_
- **Assumption:** _…_

## Dependencies

<!-- LLM: External systems, services, libraries, or teams this depends on. Note anything that
could block delivery. Remove if none. -->

- _Dependency — why it matters_

## Open questions

<!-- LLM: Track unresolved requirement questions here rather than guessing. Each should name
who needs to answer it. Clear them as they're resolved. -->

- _Question — owner_
