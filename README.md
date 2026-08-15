# Test Outcome Benchmark

AIが**自然言語のテストケース + PRの変更内容 + プロンプト**から、実際のテスト結果（PASS / FAIL）をどれだけ正確・高速・安価・安定的に予測できるかを評価するためのベンチマーク基盤です。

## Core question

> AIは、自然言語のテストケースとPRを見て、実際のテスト結果を何%当てられるか？

テストコードそのものは入力にしません。

## V1 goals

- Model × Prompt × Inference Settings × Context Strategy の比較
- Primary metric: Accuracy
- PASS / FAIL Precision, Recall, F1
- Macro F1 / Balanced Accuracy / MCC / Confusion Matrix
- Confidence / Calibration / Brier Score / ECE
- Latency p50 / p95 / p99 / throughput
- Token / cost metrics
- Repeatability / consistency / flip rate / majority@N
- Flip Pair / Counterfactual Pair
- Ablation: Test only / PR only / diff only / full PR context など
- Natural / Balanced distribution views
- Slice analysis
- Model Ranking / Prompt Ranking / Configuration Ranking
- Prompt Arena / Model Arena / Model × Prompt matrix
- False PASS / High-confidence wrong analysis
- Execution-free prediction（モデルによるテスト・アプリ実行は禁止）

詳細仕様は [SPECIFICATION.md](./SPECIFICATION.md) を参照してください。

## Repository status

Initial repository scaffold. Implementation is intentionally not started yet.
