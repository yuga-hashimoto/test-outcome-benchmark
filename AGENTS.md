# Agent Instructions

Implement the repository according to `SPECIFICATION.md`.

Core product definition:

- Input: natural-language test case + PR/change context + prompt
- Output to benchmark: predicted PASS / FAIL (plus confidence/reason/evidence metadata)
- Gold: actual recorded PASS / FAIL, hidden from the model
- Primary metric: Accuracy
- Comparison axis: Dataset × Model × Prompt × Inference Settings × Context Strategy
- Test code is NOT the benchmark input
- Prediction must be execution-free; do not run the test/app/runtime to derive a prediction

Do not reduce V1 to a toy MVP. Preserve the major evaluation axes in the specification, especially Accuracy, class metrics, custom prompts, model comparison, confidence/calibration, latency/cost, repetitions/stability, flip pairs, ablations, slice analysis, and run comparisons.

Before implementing, inspect the existing repository and choose the simplest type-safe architecture that satisfies the spec. Do not add distributed infrastructure without a demonstrated need.

Do not push, publish, deploy, or use secrets without explicit user approval.

When implementation work is complete, run relevant tests/typecheck/lint/build and report concrete validation results.
