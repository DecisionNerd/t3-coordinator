<!-- LLM: This document explains how we prove the system fulfills its product goals, experiences,
and requirements. It closes the BDD loop: evidence in ../experience/ and requirements in
../REQUIREMENTS.md should map to something verified here. Interview the
user about how they actually test (or intend to). Remove LLM comments as you complete each
section. -->

# Testing

<!-- LLM: One-paragraph summary of the testing philosophy. Ask: "How do you decide something
is correct and shippable?" Capture the spirit (e.g. "behavior-first, fast feedback"). -->

_How do we know the system works?_

## Strategy

<!-- LLM: Describe the layers of testing and what each is responsible for. Ask the user which
layers they use and where the emphasis is. Adjust the rows to reality — don't list layers
they don't have. -->

| Layer | What it verifies | Tools |
|---|---|---|
| Unit | _Smallest units of logic_ | _…_ |
| Integration | _Components working together_ | _…_ |
| End-to-end / behavior | _User-visible behavior derived from ../experience/_ | _…_ |

## Behavior coverage

<!-- LLM: This is the BDD heart of the doc. Map each key experience / requirement to the
test(s) that prove it. Reuse the Given/When/Then scenarios from ../experience/ and the
requirement IDs from ../REQUIREMENTS.md. Ask the user to confirm each important behavior has a
test (or flag it as a gap). -->

| Experience / Requirement | Scenario (Given/When/Then) | Test |
|---|---|---|
| _Experience name / FR-1_ | _Given … When … Then …_ | _path/to/test_ |

## Traceability contract

<!-- LLM: Explain the quality trace this project uses. Keep it concrete: product goal ->
experience -> requirement -> BDD scenario -> test, with architecture/ADR links where a
domain boundary or durable decision matters. Remove or shorten if the project is tiny, but
do not leave behavior untraceable. -->

| Link | Evidence |
|---|---|
| Product goal -> experience | _../PRODUCT.md / ../experience/ evidence_ |
| Experience -> requirement | _Requirement IDs from ../REQUIREMENTS.md_ |
| Requirement -> BDD scenario | _Given/When/Then scenario_ |
| Scenario -> test | _Test file, manual check, eval, or known gap_ |
| Requirement -> architecture/ADR | _Architecture section or ADR link when applicable_ |

## Evaluation against product goals

<!-- LLM: Beyond pass/fail tests, how do we evaluate that the system fulfills the product goals and
success metrics (from ../PRODUCT.md)? This may include metrics, manual evaluation, user
feedback, or LLM/qualitative evals. Ask the user how they judge product-level success, not
just code correctness. -->

- _Metric / eval — how it's measured and what "good" looks like_

## Running the tests

<!-- LLM: Give the exact commands to run the suite locally and the expectation (e.g. all green,
coverage threshold). Ask the user for the real commands. -->

```
_command to run the tests_
```

## Continuous integration

<!-- LLM: Describe when tests run automatically and what gates merges/releases. Reference the
CI config file. Remove if there is no CI yet, but suggest adding it. -->

_What runs in CI, and what must pass before merge/release?_

## Test data & environments

<!-- LLM: How test data and environments are managed (fixtures, seeds, sandboxes, throwaway
dirs). Remove if not applicable. -->

_How are test data and environments set up and torn down?_
