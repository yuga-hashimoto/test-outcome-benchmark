# Test Outcome Benchmark

AIが**自然言語のテストケース + PRの変更内容 + プロンプト**から、実際のテスト結果（PASS / FAIL）をどれだけ正確・高速・安価・安定的に予測できるかを評価するためのベンチマーク基盤です。

## Core question

> AIは、自然言語のテストケースとPRを見て、実際のテスト結果を何%当てられるか？

テストコードそのものは入力にしません。モデルはテストもアプリも実行しません（execution-free）。

## Quick start

APIキーなしで全ワークフローが動きます。

```bash
pnpm install
pnpm seed
pnpm benchmark run --model mock-thorough --prompt reasoning-v1
pnpm dev        # ダッシュボード
```

`seed` は実PRから作った148ケースのデータセット、プロンプト3種、決定論的なmockモデル4種を投入します。

## Dataset

公開リポジトリの実際のマージ済みPRから構築しています（**71リポジトリ / 15言語 / 148ケース**）。
各ケースは1つのPRの **base** と **head** それぞれに対する「そのテストが実際にどうなるか」を持ちます。

gold ラベルはリポジトリ自身の証拠に基づきます。ケースは6種類:

| パターン | base | head | 根拠 |
|---|---|---|---|
| `BUG_FIX` | FAIL | PASS | 同じPRが追加したリグレッションテスト |
| `FEATURE` | FAIL | PASS | 同上 |
| `UNRELATED` | PASS | PASS | 差分が触れていない既存の振る舞い |
| `REFACTOR` | PASS | PASS | 挙動を変えない変更 |
| `KNOWN_BROKEN` | FAIL | FAIL | PRが触れていない未修正のオープンなバグ |
| `REGRESSION` | PASS | FAIL | 後続PRが「これが壊した」と明示している変更 |

**後半4パターンは飾りではありません。** `BUG_FIX` だけのデータセットは「baseならFAIL、headならPASS」と答えるだけで高得点が取れてしまい、テストを読む能力を何も測れません。

これは実測できています。同梱のmockアダプタはまさにその「headならPASSに寄せる」ナイーブな戦略です。開発初期の48ケース（`BUG_FIX`+`UNRELATED`+`REFACTOR`のみ）では **flip pair accuracy 100% / accuracy 74.6%** を取りました。6パターン148ケースに揃えた現在は、12構成すべてが **accuracy 48.8%〜51.8%** に収まります。つまり偶然と変わりません。

最終的な分布は gold が **74 PASS / 74 FAIL**、base が 36 PASS / 38 FAIL、head が 38 PASS / 36 FAIL。revision からも、全体の偏りからも答えは決まりません。`checkDatasetIntegrity` がこの退化を検査し、警告します。

各ケースの `metadata.provenance` にPR URL・Issue URL・根拠テストファイルが入っているので、ラベルは手で検証できます。

## Results so far

dev split（**26ケース / 13 PRクラスタ、gold 13 PASS / 13 FAIL**）を `reasoning-v1` / `TEST_PLUS_TITLE_DESCRIPTION_DIFF` で解かせた結果です。モデルはエージェントハーネス経由で駆動し、PRの参照は禁じています（[方法](#measuring-a-model-through-an-agent-harness)）。10構成を試し、うち9構成が完走しました。

| # | 構成 | Accuracy | 95%区間 | MCC | FAIL recall | False PASS |
|---|---|---|---|---|---|---|
| 1 | **GLM-5.3**（Z.AI） | **84.6%** | 61.5–100.0% | 0.692 | 84.6% | 2 |
| 2 | Claude Opus 5 | 76.9% | 46.2–100.0% | 0.566 | 61.5% | 5 |
| 3 | GLM-5.2（Z.AI） | 73.1% | 46.2–92.3% | 0.500 | 53.8% | 6 |
| 4 | DeepSeek V4 Pro（OpenCode/go） | 65.4% | 38.5–88.5% | 0.365 | 38.5% | 8 |
| 4 | DeepSeek V4 Flash（OpenCode/go） | 65.4% | 38.5–88.5% | 0.365 | 38.5% | 8 |
| 4 | GPT-5.6 Luna（OpenCode/go） | 65.4% | 38.5–88.5% | 0.365 | 38.5% | 8 |
| 4 | Grok 4.6（xAI） | 65.4% | 38.5–88.5% | 0.365 | 38.5% | 8 |
| 4 | Claude Sonnet 5 | 65.4% | 38.5–88.5% | 0.365 | 38.5% | 8 |
| 9 | DeepSeek V4 Flash Free（OpenCode **Zen**） | 61.5% | 30.8–84.6% | 0.260 | 38.5% | 8 |
| — | mock-thorough（ナイーブな発見的手法、参考） | 53.8% | — | — | — | — |
| — | Claude Haiku 4.5 | 50.0% | 23.1–76.9% | 0.000 | 30.8% | 9 |

`go/qwen3.8-max` はエンドポイント障害（連続リトライ、最終的にバックオフ6分超）で完走できず、今回の集計から除外しました。無理に埋めていません。

### 統計的に言えること・言えないこと

n=26・13クラスタでは、ほとんどの差が **区別できません**。GLM-5.3とOpus 5の差 -7.7%は95%区間 -31.0%〜15.4%で、GLM-5.3とGLM-5.2の差 -11.5%も -38.5%〜7.7%で、どちらもゼロを含みます。真ん中に固まっている5構成（DeepSeek Pro/Flash, GPT-5.6 Luna, Grok 4.6, Sonnet 5）は accuracy・MCC・False PASSまで完全に一致しており、この標本数ではもはや**同一の点としか言えません**。

唯一、区別できた差が1つあります。**GLM-5.3 と Claude Haiku 4.5** — 対応比較で -34.6%、95%区間 **-61.5%〜-11.5%（ゼロを含まない）**。これだけは「たまたま」では説明できません。

### 一貫して出ている所見

**FAIL recallが上位2件を除いて軒並み低い**（30.8%〜53.8%）ことと、**False PASSが5〜9件に集中している**ことです。gold FAIL 13件のうち、中位クラスタは8件を「通る」と誤判定しています。これは運用上いちばん高くつく誤りの方向で、モデルの選択やプロンプトを変えてもこの帯から抜け出せていません。GLM-5.3だけがFAIL recall 84.6%・False PASS 2件と、この帯から明確に外れています——ただし前述の通り、Opus 5との差自体は統計的に有意ではありません。

有意な差を測りたければ、より大きな split で回してください（`--split test` で122ケース）。

## Architecture

```
packages/core       純粋ドメイン。I/Oゼロ。型・スコアリング・統計・
                    コンテキスト構築・出力コントラクト解析。
packages/db         Drizzle + SQLite。スキーマ・マイグレーション・リポジトリ。
packages/providers  ModelAdapter（mock / openai / anthropic / gemini /
                    openai-compatible）。
packages/runner     並列度・リトライ・リピート・再開・キャンセル。
packages/cli        commander CLI。
apps/web            Next.js ダッシュボード。CLIと同じサービス層を使用。
```

依存は一方向（core ← その他）。coreがI/Oを持たないので、スコアリングエンジンのゴールデンfixtureテストはDBもHTTPも起動せずに走ります。

### 設計上の重要な選択

**Gold リーク防止を型で担保。** コンテキスト構築関数は `ModelFacingCase`（= `Omit<BenchmarkCase, 'gold'>`）しか受け取りません。加えて実行時に `gold` を削除し、さらに「goldだけが違う2ケースのレンダリング結果がバイト単位で一致すること」を全ContextStrategyでテストしています。

**障害の2分類を型で強制。** `InfrastructureError`（429/5xx/timeout → 指数バックオフでリトライ）と `OutputContractViolation`（不正JSON等 → リトライせず記録）は別の型です。混ぜるとAccuracyが静かに歪みます。400のような再試行しても同じ結果になるものは `retryable: false` になります。

**Accuracyの分母を2つ併記。** `accuracy` は verdict を出せた予測が分母、`strictAccuracy` は全試行が分母（棄権・不正出力を不正解として数える）。片方だけだと、難しいケースで棄権や不正JSONを出す設定がリーダーボードで有利になってしまいます。

**信頼区間はPR単位のクラスターブートストラップ。** 同一PR由来のケースは差分も失敗モードも共有するため、独立標本として扱うと区間が実際より狭く出ます。

**再開可能性。** 予測は `(run_id, case_id, repetition)` 一意で1件ずつ即コミット。中断しても部分結果が残り、再開は残りだけ実行します。

## CLI

実行はCLI、閲覧はWeb、という分担です。

```bash
pnpm benchmark seed [--force]
pnpm benchmark dataset list
pnpm benchmark dataset import <dir> --name <name>
pnpm benchmark prompt list | show <name> | create --name <n> --file <path>
pnpm benchmark model list | add --name <n> --provider <p> --model <m> --api-key-env <VAR>
pnpm benchmark run --model <name> --prompt <name> [--strategy S] [--repetitions N]
                   [--mode FORCED|SELECTIVE] [--split S] [--distribution natural|balanced]
                   [--concurrency N] [--seed N]
pnpm benchmark resume <runId>
pnpm benchmark runs | show <runId>
pnpm benchmark compare <baselineRunId> <candidateRunId>
pnpm benchmark leaderboard [--metric accuracy|failRecall|flipPairAccuracy|costPerTest|...]
```

### 行列を一発で回す

```bash
pnpm benchmark sweep --models mock-thorough,mock-lean --prompts reasoning-v1,concise-v1 \
                     --strategies TEST_ONLY,TEST_PLUS_DIFF --repetitions 3
```

セルは1つずつ順番に実行します。各runがすでにプロバイダの並列上限まで使うので、セルを並列化してもレート制限とレイテンシ計測の汚染しか起きません。途中のセルが失敗しても記録して続行します。

### アダプタが届かないモデルを測る

`export-cases` は**アダプタが送るのと同一の入力**（goldは除去済み）をJSONLに書き出し、`import-run` はその回答をrunとして取り込みます。取り込んだrunはネイティブなrunと同じスコアリング・区間・比較の対象になります。

```bash
pnpm benchmark export-cases --prompt reasoning-v1 --split dev --out /tmp/cases.jsonl
# 何らかのハーネスで回答し、{"caseId":"...","verdict":"PASS","confidence":0.8,"reason":"..."} をJSONLで用意
pnpm benchmark import-run --model my-model --prompt reasoning-v1 --split dev --file /tmp/answers.jsonl
```

未回答のケースは黙って捨てず件数を報告します（難しいケースを飛ばしたハーネスが、全問正解したハーネスに見えないように）。

### 人間ベンチマーク

```bash
pnpm benchmark human run --participant alice --limit 10
pnpm benchmark human score
pnpm benchmark human sessions
```

モデルとまったく同じ入力を人間に提示し、PASS/FAIL・確信度・所要時間を記録します。

## Metrics

Accuracy（主指標、95%CI付き）/ strict accuracy / PASS・FAIL の precision・recall・F1 / Macro F1 /
Balanced Accuracy / MCC / 混同行列 / ベースライン4種 / Brier score / ECE / キャリブレーション曲線 /
閾値別 accuracy・coverage / Coverage・Selective Accuracy・Abstention（SELECTIVEモード）/
latency p50・p90・p95・p99・TTFT / トークンとコスト（cost/test, cost/1000, correct per dollar）/
Consistency・Flip rate・Majority@N・run間分散 / Flip Pair Accuracy / スライス分析 / SafeSkip分析。

## Adding a real model

APIキーは環境変数名だけを保存し、値はDBにもrun snapshotにも入りません。

```bash
export ANTHROPIC_API_KEY=...
pnpm benchmark model add --name claude --provider anthropic --model claude-sonnet-5 \
  --api-key-env ANTHROPIC_API_KEY --stream --input-price 3 --output-price 15
pnpm benchmark run --model claude --prompt reasoning-v1
```

`--stream` を付けるとTTFTが計測できます。付けない場合、およびGeminiアダプタ（V1では非ストリーミング）ではTTFTは `null` になり、0として集計されるのではなく母数から除外されます。

## Publishing the dashboard

ダッシュボードは確定した結果のスナップショットなので、静的サイトとして書き出せます。

```bash
pnpm site          # apps/web/out に全ページを事前レンダリング
pnpm site:serve    # 出力をローカルで確認
```

`out/` は完全に自己完結（サーバー不要、DB不要）なので、無料の静的ホストにそのまま置けます。

- **GitHub Pages** — `.github/workflows/pages.yml` を同梱しています。リポジトリの Settings → Pages で Source を GitHub Actions にすれば、main への push で自動公開されます。プロジェクトサイトは `/<repo>` 配下に出るため、ワークフローが `TOB_BASE_PATH` を自動設定します。
- **Netlify / Cloudflare Pages** — `netlify.toml` の通り。ビルドコマンド `pnpm install && pnpm site`、公開ディレクトリ `apps/web/out`。

公開されるのは結果とデータセットです。データセットは公開PR由来で、各ケースが provenance（PR URL・Issue URL・根拠テストファイル）を持つので、第三者がラベルを検証できます。APIキーはDBにもrun snapshotにも保存されないため、書き出しに含まれることはありません。

サイトはビルド時点のDBのスナップショットです。新しいrunを反映するには再ビルドしてください。ローカルで `pnpm dev` を使う場合は常に最新のDBを読みます。

## Testing

```bash
pnpm test          # 212 tests
pnpm coverage
pnpm typecheck
pnpm build
```

スコアリングは手計算できる値のゴールデンfixtureで検証しています（例: ECE = (0.6+0.3+0.8+0.1)/4 = 0.45）。ランナーは in-memory SQLite + mockアダプタでフル実行・再開・キャンセル・リトライ・goldリークを検証します。

## Measuring a model through an agent harness

APIキーがない環境では、`export-cases` / `import-run` を使ってエージェント経由でモデルに解かせられます。同梱の結果もこの方法で取得しています。

```bash
pnpm benchmark export-cases --prompt reasoning-v1 --split dev --out /tmp/cases.jsonl
# エージェントに cases.jsonl を解かせ、answers.jsonl を書かせる
pnpm benchmark import-run --model claude-haiku-4.5 --prompt reasoning-v1 --split dev --file /tmp/answers.jsonl
```

**測定の妥当性のために必須の条件**: 解かせる側に「PRや結果を一切調べさせない」ことです。`gh`・Web検索・リポジトリの参照を許すと、実際の結果を見つけてしまい、予測ではなく検索を測ることになります。この違いは出力からは見分けがつかないので、指示で明示的に禁じる必要があります。

**この数字の読み方に関する注意**: これはエージェントハーネス経由で駆動したモデルであって、生のAPI呼び出しではありません。したがって latency と cost はこの経路では意味を持ちません（`import-run` で取り込んだrunにトークン計測がないため、コスト指標は空になります）。比較して意味があるのは Accuracy・FAIL recall・flip pair accuracy・較正といった予測の質に関する指標だけです。実運用の速度・コストを測りたい場合は、APIキーを設定して `anthropic` / `openai` アダプタで回してください。

## Known limitations

- **Gemini アダプタは非ストリーミング**です。したがってTTFTは常に `null` になります。総レイテンシから推定はしません。
- **mockプロバイダのスループット表示は非現実的**です。mockはシミュレートしたレイテンシを報告する一方、実時間ではほとんどsleepしないため、`tests/minute` が数万になります。実プロバイダでは正しい値になります。
- **データセットは148ケース / 71 PR クラスタ**です。スライスによっては n が小さく、区間が広くなります。UIは常に n と scope（データセット版・split）を併記します。
- `REPOSITORY_AGENT` コンテキスト戦略は入力の構築のみ実装されています。実際の静的リポジトリ探索にはツール使用に対応したアダプタが必要です。

詳細仕様は [SPECIFICATION.md](./SPECIFICATION.md)、設計判断は [docs/superpowers/specs/](./docs/superpowers/specs/) を参照してください。
