# V1 Specification

## 1. Purpose

Build a benchmark system that measures how accurately an AI predicts the **actual PASS / FAIL result** of a test from:

1. a **natural-language test case**,
2. a **PR/change context**,
3. a selectable **model**,
4. a selectable or custom **prompt**.

The test input is not executable test code. The benchmark compares the model prediction against a hidden gold result obtained from the real test execution/human execution record.

Primary question:

> AIはテスト結果を何%当てられるか？

Primary metric: **Accuracy**.

SafeSkip / Safe PASS analysis is secondary and must not replace Accuracy as the main benchmark objective.

---

## 2. Benchmark case

A dataset case should contain at minimum:

```json
{
  "id": "case_000001",
  "pr": {
    "repository": "owner/repo",
    "number": 123,
    "baseSha": "...",
    "headSha": "...",
    "title": "...",
    "description": "...",
    "diff": "..."
  },
  "testCase": {
    "id": "...",
    "title": "...",
    "preconditions": "...",
    "steps": ["..."],
    "expectedResult": "..."
  },
  "gold": {
    "result": "PASS"
  },
  "metadata": {
    "executedAt": "...",
    "testType": "UI",
    "tags": [],
    "durationMs": null
  }
}
```

`gold` must never be included in model input.

The same PR at different revisions is a different case. Use `baseSha` + `headSha` to pin state.

---

## 3. Dataset vs evaluation configuration

Keep benchmark data independent from evaluation configuration.

```text
Dataset
  × Model
  × Prompt
  × Inference Settings
  × Context Strategy
  = Benchmark Run
```

Dataset versions must be immutable.

Support splits:

- train
- dev
- test
- hidden-test

Support both:

- Natural distribution
- Balanced PASS/FAIL evaluation view

---

## 4. Prompt system

Prompt is a first-class versioned entity.

Fields:

- id
- name
- description
- content
- version
- SHA-256
- createdAt
- updatedAt

Users must be able to create, edit, clone, and select custom prompts.

The reasoning prompt is user-controlled, but the benchmark owns the final output contract so results remain machine-scoreable.

---

## 5. Model abstraction

Use a provider-agnostic adapter interface.

Expected providers/extensions:

- OpenAI
- Anthropic
- Google Gemini
- OpenAI-compatible APIs
- local/self-hosted models
- deterministic mock provider for local demo/tests

Store model/provider identifiers and inference parameters such as temperature, reasoning effort, and max output tokens.

Never hardcode secrets.

---

## 6. Prediction output

Forced mode:

```json
{
  "verdict": "PASS",
  "confidence": 0.95,
  "reason": "...",
  "evidence": [
    {
      "file": "...",
      "location": "...",
      "reason": "..."
    }
  ],
  "requiresRuntimeInformation": false
}
```

Primary scoring uses `verdict` only.

Also support Selective Prediction mode:

- PASS
- FAIL
- UNKNOWN

Record invalid JSON/output-contract violations explicitly.

---

## 7. Core metrics

Primary:

- Accuracy

Classification:

- PASS Precision / Recall / F1
- FAIL Precision / Recall / F1
- Macro F1
- Balanced Accuracy
- MCC
- Confusion Matrix

Baselines:

- Always PASS
- Always FAIL
- Random
- Majority Class

Confidence/calibration:

- Brier Score
- Expected Calibration Error
- Calibration curve/buckets
- Accuracy at confidence threshold
- Coverage at confidence threshold

Selective mode:

- Coverage
- Selective Accuracy
- Abstention Rate

Secondary derived analysis:

- Safe PASS accuracy
- SafeSkip-style thresholds

---

## 8. Performance and cost

Capture where available:

- request start
- first token
- final token
- parsed response time
- TTFT
- generation latency
- model latency
- end-to-end latency

Aggregate:

- mean
- p50
- p90
- p95
- p99
- tests/minute

Usage/cost:

- input tokens
- output tokens
- cached tokens
- reasoning tokens
- total tokens
- cost/test
- cost/run
- cost/1000 tests
- correct predictions per dollar

Pricing data must be separate from benchmark results and may be snapshotted per run.

---

## 9. Stability

Support repeated identical runs, defaulting to a configurable count such as 3.

Measure:

- Consistency Rate
- Flip Rate
- Majority@N Accuracy
- run-to-run variance

---

## 10. Flip pairs / counterfactuals

Support pairs where the same natural-language test changes outcome across PR revisions, for example:

```text
revision A -> FAIL
revision B -> PASS
```

Flip Pair Accuracy succeeds only when both sides are predicted correctly.

Generalize schema for future counterfactual pairs.

---

## 11. Context strategies / ablation

Treat context strategy as an explicit experiment dimension.

At minimum support conceptual variants:

- TEST_ONLY
- PR_ONLY
- TEST_PLUS_PR_TITLE
- TEST_PLUS_DIFF
- TEST_PLUS_TITLE_DESCRIPTION_DIFF
- PR_ONLY / full PR context
- PR_WITH_CONTEXT
- REPOSITORY_AGENT (future/optional)

Execution-free constraint:

The model evaluation path must not execute tests, the application, or runtime probes to obtain the answer. Static repository reads/search/symbol lookup may be supported in repository-context modes.

---

## 12. Slice analysis metadata

Test case metadata should allow slicing by:

- test type: UI/API/business logic/integration/E2E/other
- step count
- test text length
- expected-result length
- feature
- tags
- platform
- specificity
- ambiguity
- external dependency

PR metadata:

- changed files
- added LOC
- deleted LOC
- diff LOC
- commits
- repository
- language
- labels

Dashboard should support slice comparisons.

---

## 13. Statistics

Show 95% confidence intervals.

Because multiple tests from the same PR are correlated, prefer PR-level cluster bootstrap when practical.

Comparisons between two runs on the same cases should be paired and report delta Accuracy with confidence interval.

---

## 14. Leaderboards and comparison

Provide:

### Model Ranking
Standard prompt/context fixed; model changes.

### Prompt Ranking
Model fixed; prompt changes.

### Configuration Ranking
Rank complete configurations:

```text
Model + Prompt + Inference Settings + Context Strategy
```

Also support:

- Prompt Arena
- Model Arena
- Model × Prompt matrix/heatmap
- multi-run comparison

---

## 15. Dashboard / UX

Information hierarchy:

1. Accuracy
2. PASS / FAIL performance
3. Speed / cost
4. Confidence / calibration
5. Stability
6. Deep analysis

Dashboard cards should include:

- Best Accuracy
- Fastest Configuration
- Cheapest Configuration
- Best FAIL Recall
- Best Accuracy/Cost
- Most Stable Configuration

Run detail should expose:

- Accuracy + CI
- class metrics
- confusion matrix
- calibration
- latency
- cost
- stability
- flip pairs
- ablation
- slice analysis
- false PASS cases
- high-confidence wrong cases
- parse/system errors

Pareto views:

- Accuracy vs Latency
- Accuracy vs Cost
- FAIL Recall vs Cost
- Accuracy vs Coverage

---

## 16. Persistence / reproducibility

Persist:

- BenchmarkDataset
- BenchmarkCase
- Prompt
- ModelConfiguration
- BenchmarkRun
- BenchmarkPrediction
- BenchmarkMetric
- human benchmark response schema

Each prediction should store:

- case id
- predicted verdict
- gold verdict
- confidence
- reason
- evidence
- raw response
- latency
- token usage
- cost
- error
- attempt / repetition

Each run should snapshot:

- dataset id/version
- model/provider/config
- prompt id/version/hash/full text
- context strategy
- timestamps
- repetitions
- benchmark code/git SHA if available

---

## 17. Runner behavior

Support large runs with:

- bounded parallelism
- provider-specific concurrency limits
- retries for infrastructure/API errors
- timeout
- cancellation
- resumability where practical
- progress persistence
- partial result preservation

Differentiate infrastructure failures from model output failures.

Infrastructure examples:

- 429
- 5xx
- timeout
- network errors

Model-result failures such as invalid output/JSON should be benchmark-recorded rather than silently retried as if they were infrastructure failures.

---

## 18. API / CLI

Provide a reusable service/API layer for at least:

- create/list datasets
- add/import cases
- create/list prompts
- create/list model configs
- start benchmark
- inspect benchmark progress/results
- compare runs

A CLI is desirable, for example:

```bash
benchmark run --dataset test-outcome-v1 --model <real-model-config> --prompt reasoning-v1
# Development-only harness check: opt in to mock registration first.
benchmark seed --with-mocks
```

---

## 19. Human benchmark

Schema should allow a human to receive the same test+PR input and submit:

- PASS/FAIL
- confidence
- time spent

This enables human-vs-model comparison later.

---

## 20. Testing requirements

Thoroughly test the scoring engine with golden fixtures.

At minimum cover:

- Accuracy
- PASS/FAIL precision/recall/F1
- Macro F1
- Balanced Accuracy
- MCC
- confusion matrix
- Brier score/ECE
- latency aggregation
- cost calculations
- consistency
- majority voting
- flip pair accuracy
- ablation comparison
- dataset versioning
- prompt hashing
- gold leakage prevention
- retry/error distinction
- resume behavior where implemented

Include a small deterministic self-test dataset with hand-checkable expected metrics.

---

## 21. Seed/demo data

The repository should ship meaningful benchmark data plus a deterministic mock model adapter for contributor self-tests. Mock models are development-only: normal seed must not register them, formal dashboards/leaderboards must exclude them, and contributors opt in explicitly when they want an API-key-free harness check.

---

## 22. Engineering constraints

Prefer:

- TypeScript
- type-safe boundaries
- modular benchmark/scoring engine
- simple local-first persistence
- a single repository/application unless splitting is clearly beneficial
- deterministic tests
- clear provider abstraction

Avoid unnecessary:

- microservices
- Kafka
- Kubernetes
- vector DBs
- bespoke ML training

Do not push/publish/deploy without explicit approval.

---

## 23. Completion target

A user should eventually be able to:

1. choose a dataset,
2. choose one or more models,
3. choose or write a custom prompt,
4. choose inference/context settings,
5. run the benchmark,
6. observe progress,
7. see Accuracy first,
8. compare model/prompt/configuration performance,
9. inspect FAIL detection, latency, cost, confidence, and stability,
10. drill into wrong predictions.

The system should answer, reproducibly:

> **Which Model × Prompt × Configuration best predicts the actual PASS/FAIL result of natural-language tests from a PR?**
