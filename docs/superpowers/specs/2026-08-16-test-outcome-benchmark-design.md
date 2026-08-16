# Test Outcome Benchmark — V1 Design

Date: 2026-08-16
Status: Approved
Source spec: [SPECIFICATION.md](../../../SPECIFICATION.md)

## 1. Scope

Implement the whole of `SPECIFICATION.md` V1: a benchmark that measures how accurately a
model predicts the real PASS/FAIL outcome of a natural-language test case given a PR
context, comparable across Dataset × Model × Prompt × Inference Settings × Context Strategy.

Primary metric is Accuracy. The system must run end to end with no API keys via a
deterministic mock provider.

## 2. Architecture

A pnpm workspace with a one-directional dependency graph. `core` holds all domain logic and
performs no I/O, so the scoring engine (spec §20) is testable without a database, a network,
or a UI.

```
packages/core       Domain types, output-contract parsing, context strategies,
                    prompt rendering/hashing, scoring, statistics. No I/O.
packages/db         Drizzle SQLite schema, migrations, repositories.
packages/providers  ModelAdapter implementations (mock, openai, anthropic,
                    gemini, openai-compatible).
packages/runner     Orchestration: bounded parallelism, retries, repetitions,
                    resume, cancellation. Depends on core + providers + db.
packages/cli        commander CLI over the runner/service layer.
apps/web            Next.js App Router dashboard. Route handlers are thin
                    wrappers over the same service layer the CLI uses.
```

Packages are source-first: each `exports` its `src/index.ts`, resolved through
`tsconfig.base.json` path aliases. There is no inter-package build step, so vitest, tsx and
Next.js all consume TypeScript sources directly. This keeps the repository free of build
orchestration that a local-first tool does not need (spec §22).

### Module granularity

`core/src/scoring` is split one concern per file — `confusion`, `classification`,
`calibration`, `selective`, `baselines`, `stability`, `flip-pairs`, `slices`, `latency`,
`cost`, `stats`, `aggregate`. Each is a pure function over prediction records, so each has a
golden fixture with hand-checkable numbers.

## 3. Gold leakage prevention

`BenchmarkCase` carries `gold`. Context builders accept only `ModelFacingCase`, which is
`Omit<BenchmarkCase, 'gold'>`. The type makes leakage unrepresentable at the boundary; a
runtime assertion strips `gold` defensively at the seam between the repository layer and the
runner; and a test asserts that no rendered prompt contains the gold verdict token in a
position derived from the case, across every context strategy × every fixture.

## 4. Determinism

Every source of randomness is seeded:

- The Random baseline uses a seeded PRNG (mulberry32) keyed by run id.
- The PR-level cluster bootstrap uses a seeded PRNG, so confidence intervals are byte-stable
  across runs and in CI.
- The mock provider derives its verdict, confidence, latency and token counts from a hash of
  (case id, prompt hash, repetition, seed), with a configurable target accuracy.

## 5. Failure taxonomy

Two disjoint error kinds, distinguished in the type system:

- `InfrastructureError` — 429, 5xx, timeout, network. Retried with exponential backoff and
  jitter, bounded by `maxAttempts`. Does not appear in the metric denominator on success.
- `OutputContractViolation` — unparseable JSON, missing/invalid `verdict`, confidence out of
  range. Never retried as if it were infrastructure. Recorded as a prediction row with a
  null verdict, and counted explicitly.

Mixing these silently distorts Accuracy, so the distinction is enforced at the type level
rather than by convention.

### Accuracy denominators

Two figures are reported side by side, both defined explicitly:

- `accuracy` — correct ÷ predictions that resolved to PASS or FAIL. The headline number.
- `strictAccuracy` — correct ÷ all attempted predictions, counting UNKNOWN and contract
  violations as incorrect.

A configuration cannot win the leaderboard by abstaining or by emitting malformed output,
because both numbers are always shown together with the error and abstention rates.

## 6. Resumability

Predictions are written one row at a time, unique on `(run_id, case_id, repetition)`. Resume
reads existing rows and executes only the remainder. Cancellation propagates an
`AbortSignal`; partial results survive.

## 7. Dataset: real OSS pull requests

The dataset is built from real merged pull requests in public repositories, spanning
languages, ecosystems and defect types. Gold labels are grounded in the repositories' own
evidence rather than invented.

Four case patterns are collected per PR family:

| Pattern | Natural-language test | Gold @ base | Gold @ head |
|---|---|---|---|
| Bug fix with regression test | the behaviour the fix restores | FAIL | PASS |
| New feature with test | the behaviour the feature adds | FAIL | PASS |
| Unrelated existing test | a behaviour the PR does not touch | PASS | PASS |
| Behaviour-preserving refactor | an existing behaviour | PASS | PASS |

The last two patterns are mandatory, not decorative. Without them the label is trivially
recoverable from revision position — a model could score highly by answering "FAIL at base,
PASS at head" without reading the test at all. The unrelated and refactor cases are the
negative controls that make the benchmark measure comprehension instead of position.

Bug-fix and feature families yield flip pairs (spec §10) directly, since the same
natural-language test changes outcome between `baseSha` and `headSha`.

Test-case prose is written from the linked issue and the PR's own added test, in the
vocabulary of a manual tester: preconditions, numbered steps, expected result. It must not
name the fix, the changed symbol, or the file that was patched, otherwise the task collapses
into keyword matching.

Diffs are capped and restricted to source files — lockfiles, generated output and vendored
directories are excluded — so a case stays inside a reasonable context budget.

`gold` is recorded together with provenance (PR URL, issue URL, the test file the label was
derived from) so any label can be re-checked by hand.

## 8. Seed and demo path

`pnpm seed` loads the collected dataset, three prompts and a mock model configuration, so

```
benchmark run --dataset test-outcome-v1 --model mock --prompt reasoning-v1
```

works on a fresh clone with no API keys, and the dashboard has data to render.

## 9. Known measurement limits

TTFT is only observable on streaming responses. On non-streaming providers or settings it is
`null`. Null TTFT is excluded from aggregation rather than coerced to zero, and the UI shows
the measured sample size next to the statistic, so a partially-instrumented run cannot be
misread as a fast one.

## 10. Testing

vitest with golden fixtures for every scoring module, a deterministic self-test dataset with
hand-checked expected metrics, an in-memory SQLite integration test that runs the full
runner against the mock provider, and the gold-leakage scan described in §3. Coverage target
80%.

## 11. Implementation order

core → db → providers → runner → cli → seed → web, running typecheck, tests and build at
each step.
