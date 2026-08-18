# Test Outcome Benchmark

AIが**自然言語のテストケース + PRの変更内容 + プロンプト**から、実際のテスト結果（PASS / FAIL）をどれだけ正確・高速・安価・安定的に予測できるかを評価するためのベンチマーク基盤です。

## Core question

> AIは、自然言語のテストケースとPRを見て、実際のテスト結果を何%当てられるか？

テストコードそのものは入力にしません。モデルはテストもアプリも実行しません（execution-free）。

## Quick start

通常の `seed` は**評価データセットとプロンプトだけ**を投入します。mockモデルは正式なベンチマーク対象には入りません。

```bash
pnpm install
pnpm seed

export OPENAI_API_KEY=...
pnpm benchmark model add --name my-model --provider openai --model <model-id> --api-key-env OPENAI_API_KEY
pnpm benchmark run --model my-model --prompt reasoning-v1
pnpm dev        # ダッシュボード
```

APIキーなしでrunnerやUIを開発確認したい場合だけ、明示的にmockを登録できます。

```bash
pnpm seed:dev
pnpm benchmark run --model mock-thorough --prompt reasoning-v1
```

mock providerはrunner・retry・calibration・UIなどを検証するための開発用fixtureです。**データセットには含まれず、Dashboardと正式Leaderboardからも除外されます。**

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

最終的な分布は gold が **74 PASS / 74 FAIL**、base が 36 PASS / 38 FAIL、head が 38 PASS / 36 FAIL。revision からも、全体の偏りからも答えは決まりません。`checkDatasetIntegrity` がこの退化を検査し、警告します。

各ケースの `metadata.provenance` にPR URL・Issue URL・根拠テストファイルが入っているので、ラベルは手で検証できます。

### gold ラベルの根拠の強さ（provenance.source）

このデータセットはOSSの公開PRから構築されており、**このベンチマーク自身がテストを実行して確認したケースは1件もありません**。`provenance.source` はラベルの根拠がどれだけ直接的かを4段階で明示します:

| source | 意味 | このデータセットでの件数 |
|---|---|---|
| `CI_EXECUTED` | このベンチマークのパイプライン自身がCIで実行し観測した | 0（未着手のトラック向け） |
| `HUMAN_EXECUTED` | 人間が実際に実行して観測した | 0（未着手のトラック向け） |
| `REPRODUCED` | PRが追加・変更した具体的なテストファイルを根拠として引用できる | 98 |
| `HISTORICAL_EVIDENCE` | Issue・後続PRの記述など、具体的なテストファイルなしに推論した | 50 |

`CI_EXECUTED`/`HUMAN_EXECUTED` は現状0件です。これは意図的な区分であり、将来的にこのベンチマーク自身が実行して確認した「Real Execution Track」を追加する余地として予約してあります。今公開しているのは、その全体が「OSS Public Track」（PRの記録から再構築したラベル）だという意味です。

### データが上流と一致しているかの検証

「そのPRは実在するのか」「そのdiffは本当にそのPRのものか」は機械的に検証できます。`pnpm verify:dataset` が148ケース全部を
上流のGitHubリポジトリと突き合わせます（ネットワークが必要なので `pnpm test` には含めていません）。

```bash
pnpm verify:dataset                      # 148ケース / 74 PR を全部チェック
pnpm verify:dataset --only js_0001,js_0002 --json report.json
```

チェック内容と、直近の実行結果（**errors 0 / warnings 30**）:

| チェック | 結果 |
|---|---|
| `baseSha` / `headSha` が上流で解決するか | 148/148 解決 |
| `refs/pull/<番号>/head` が `headSha` と一致するか（PRとケースの紐付け） | 74/74 一致 |
| 保存されたdiffが上流のdiffの忠実な部分集合か（ファイル単位の増減行数まで比較） | 148/148 一致 |
| `provenance.evidenceTestFile` が実在するパスか | 98/98 解決 |
| `baseSha` が `headSha` の親か | 15 PR（30ケース）で親ではない → warning |

最後の警告（`REVISIONS_DIFFER_BEYOND_PR`）はGitHubのPRの `base` の定義そのものに由来します。`base` はマージベースではなく
ベースブランチの先端なので、ブランチを切ったのが古いPRでは base と head が当該PR以外のコミット分も違います
（最大は dotnet/runtime のケースで4292ファイル）。モデルに見せているdiffはそのPR自身の変更で、baseは実在するリビジョンなので
「PR適用前のコード」という提示は正しいままですが、baseとheadの差がPR1件分とは限らないことは知っておいてください。

**このコマンドが検証しないもの**: gold ラベルそのものの正しさです。ラベルが本当に正しいかは実際に動かすしかなく、
実際にやってみると誤りが見つかります（[data/CORRECTIONS.md](./data/CORRECTIONS.md)）。例えば express のケースは、
qsを実際に実行した結果 gold FAIL が誤りだと判明し、本当に壊したPRに付け替えました。手で実行して確認した抜き取り検査は以下:

| ケース | 確認方法 | 結果 |
|---|---|---|
| `js_0001` / `js_0002`（dayjs） | 両リビジョンをbundleして `format('Y')` を実行 | base `+0000`（FAIL）/ head `Y`（PASS）— gold通り |
| `py_0001` / `py_0002`（httpx） | `NO_PROXY='::1'` で両リビジョンの `httpx.Client()` を実行 | base で `InvalidURL`（FAIL）/ head 成功（PASS）— gold通り |
| `kb_0005` / `kb_0006`（afero） | head の `MemMapFs.Remove` の実装を読む | 非空ディレクトリを検査せず削除（FAIL）— gold通り |
| `kb_0009` / `kb_00010`（arrow） | head をチェックアウトして DST 跨ぎの `shift(hours=10)` を実行 | `04:30-05:00`（期待は `05:30`）→ FAIL — gold通り |
| `rg_0011` / `rg_0012`（express） | qs 6.13.0 / 6.14.0 / 6.14.2 を実際に `parse` | **gold誤り**を検出、参照PRを訂正 |

## Primary track: head-only accuracy

このベンチマークが実際に問うているのは「このテストとこのPRが与えられたとき、**今この瞬間**（PR適用後 = head）にPASSするかFAILするか」です。base revisionのケース（「このPRが適用される前はどうだったか」）は別の問いで、反実仮想（counterfactual）の推論力を測るものです。

そのため **`headAccuracy` を主指標**とし、baseとheadを合算した従来の `accuracy` は**副次指標（反実仮想トラック）**として区別しています。リーダーボード・ダッシュボードの既定ソートは `headAccuracy` です。`flipPairAccuracy`（変更の両側を正しく当てられるか）も同じ反実仮想トラックに属します。

```bash
pnpm benchmark leaderboard                        # 既定で headAccuracy 順
pnpm benchmark leaderboard --metric accuracy       # base+head 合算（副次トラック）を見る
```

## Implementation-only diff track

PRのdiffには、そのケースが説明している assertion そのもの（追加・変更されたテストファイル）が含まれていることが多く、「予測する」ではなく「assertionを読む」だけで正解できてしまう抜け道になります。これに対応するため、diffからテストファイルらしきhunkを機械的に除去する `IMPLEMENTATION_ONLY_DIFF` コンテキスト戦略を追加しました（`packages/core/src/context/diff-filter.ts`）。テストファイルの判定はディレクトリ名・ファイル名のヒューリスティックで、この148ケースの実際の証拠ファイルパスに対して検証済みです（`packages/core/test/diff-filter.test.ts`）。

```bash
pnpm benchmark run --model my-model --prompt reasoning-v1 --strategy IMPLEMENTATION_ONLY_DIFF
```

同じ18構成（17完走）を、同じdev splitに対してこの戦略で再実行しました。結果は下記の「Implementation-only diffでの結果」を参照してください。リーダーボードのスコープはコンテキスト戦略ごとに分離されており（[設計上の重要な選択](#設計上の重要な選択)参照）、通常diffのトラックと混ざって順位付けされることはありません。

## Results so far

dev split（**26ケース / 13 PRクラスタ、gold 13 PASS / 13 FAIL**）を `reasoning-v1` / `TEST_PLUS_TITLE_DESCRIPTION_DIFF` で解かせた結果です。モデルはエージェントハーネス経由で駆動し、PRの参照は禁じています（[方法](#measuring-a-model-through-an-agent-harness)）。24構成を試し、うち21構成が完走しました。生の回答は [`data/raw-answers/`](./data/raw-answers/) にモデルごとにJSONLで残っており、誰でも同じ結果を再現できます。

主指標である **Accuracy (head)** で並べています。MCC・FAIL recall・False PASSは副次トラック（base+head合算）の値です。

| # | 構成 | Accuracy (head) | 95%区間 (head) | Accuracy (base+head) | MCC* | FAIL recall* | False PASS* |
|---|---|---|---|---|---|---|---|
| 1 | **GLM-5.3**（Z.AI） | **84.6%** | 61.5–100.0% | 84.6% | 0.692 | 84.6% | 2 |
| 2 | Claude Opus 5 | 76.9% | 46.2–92.3% | 76.9% | 0.566 | 61.5% | 5 |
| 3 | GLM-5.2（Z.AI） | 69.2% | 38.5–92.3% | 73.1% | 0.500 | 53.8% | 6 |
| 4 | Claude Sonnet 5 | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Grok 4.6（xAI） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | GPT-5.6 Luna（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | DeepSeek V4 Flash（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | DeepSeek V4 Flash Free（OpenCode Zen） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 4 | DeepSeek V4 Pro（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Big Pickle（OpenCode Zen, free） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 4 | MiniMax M3（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Hy3（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Kimi K3（OpenCode/go） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 4 | Hy3 Free（OpenCode Zen） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | MiMo V2.5 Free（OpenCode Zen） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 4 | Qwen3.8 Max（Alibaba Token Plan） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Qwen3.7 Max（Alibaba Token Plan） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 4 | Qwen3.6 Flash（Alibaba Token Plan） | 61.5% | 30.8–84.6% | 57.7% | 0.289 | 15.4% | 11 |
| 19 | Claude Haiku 4.5 | 53.8% | 23.1–76.9% | 50.0% | 0.000 | 30.8% | 9 |
| 19 | Nemotron 3 Ultra Free（OpenCode Zen） | 53.8% | 23.1–76.9% | 53.8% | 0.087 | 30.8% | 9 |
| 19 | Nemotron 3.5 Lightning Free（OpenCode Zen） | 53.8% | 23.1–76.9% | 50.0% | 0.000 | 30.8% | 9 |

\* base+head 合算（副次トラック）で計算した値。head-onlyでの内訳はまだ計算していません（下記 Known limitations 参照）。

**完走できなかったもの**: `go/qwen3.8-max`（OpenCode/goゲートウェイ経由）は3回試行してもエンドポイント障害（連続リトライ、バックオフ最終30分超）から回復せず除外。ただし Alibaba Token Plan 経由の `alibaba-qwen3.8-max` は問題なく完走しています——同じモデルでもゲートウェイが違えば結果が違うことがある、という点も記録しておきます。`Laguna S 2.1 Free` は1コマンド実行後20分以上応答なしで停止したため除外。`Fable 5`（Claude Code サブエージェント経由）は利用クレジット切れで実行できず。無理に埋めていません。

### 分解能の限界——特にAccuracy (head)は13ケースしかない

dev splitは26ケースですが、**Accuracy (head)はhead revisionのケースだけで計算する**ため、実際の分母は13ケースです（13 PRクラスタ×2リビジョン=26、うちheadは半分）。正解数は0〜13の整数しか取れないので、取りうる値は **1/13 ≈ 7.7ポイント刻み**——14通りしかありません。以前この節は「26ケースだから約3.8ポイント刻み」と書いていましたが、それはbase+head合算（副次トラック、分母26）の話であって、主指標のAccuracy (head)には当てはまりません。誤りだったので訂正します。

**Accuracy (head) では21構成中15構成が61.5%（8/13）にぴったり並んでいます**——これらのモデルが同じ性能だからではなく、この標本数・この分母では区別できる細かさがそれしかないからです。14通りしかない値に21構成を割り振れば、鳩の巣原理だけでもかなりの集中が起きます。同じスコアの並びを「横並びで実力伯仲」と読むのではなく、「この物差しの目盛りがそこにしかない」と読んでください。

有意な差を測りたい、あるいはAccuracy (head)の分母そのものを増やしたい場合は、より大きな split で回してください（`--split test` で122ケース、head側はその半分程度）。

### 統計的に言えること・言えないこと

ほとんどの差が **区別できません**。GLM-5.3とOpus 5の差 -7.7%は95%区間 -31.0%〜15.4%で、GLM-5.3とGLM-5.2の差もゼロを含みます。61.5%に並ぶ15構成は accuracy がすべて一致しており、この標本数ではもはや**同一の点としか言えません**。

唯一、区別できた差が1つあります（base+head合算トラックでの対応比較）。**GLM-5.3 と Claude Haiku 4.5** — 対応比較で -34.6%、95%区間 **-61.5%〜-11.5%（ゼロを含まない）**。これだけは「たまたま」では説明できません。

### 一貫して出ている所見

**FAIL recallが上位2件を除いて軒並み低い**（15.4%〜53.8%、大半は30.8%〜53.8%）ことと、**False PASSが5〜9件に集中している**（最低のQwen3.6 Flashのみ11件）ことです（いずれもbase+head合算の値）。gold FAIL 13件のうち、中位クラスタは8〜9件を「通る」と誤判定しています。これは運用上いちばん高くつく誤りの方向で、モデルの選択やプロンプトを変えてもこの帯から抜け出せていません。GLM-5.3だけがFAIL recall 84.6%・False PASS 2件と、この帯から明確に外れています——ただし前述の通り、Opus 5との差自体は統計的に有意ではありません。

## Implementation-only diffでの結果

同じ26ケース・同じ18構成（17完走、`opencode-zen-mimo-v2.5-free` はハーネスが応答なしで停止したため除外）を、テストファイルを除去したdiffで再度解かせました。生の回答は [`data/raw-answers-implementation-only/`](./data/raw-answers-implementation-only/) にあります。

| # | 構成 | Accuracy (head) | 95%区間 (head) | Accuracy (base+head) | MCC* | FAIL recall* | False PASS* |
|---|---|---|---|---|---|---|---|
| 1 | **Claude Opus 5** | **84.6%** | 61.5–100.0% | 88.5% | 0.772 | 84.6% | 2 |
| 2 | GLM-5.3（Z.AI） | 69.2% | 46.2–92.3% | 69.2% | 0.404 | 53.8% | 6 |
| 3 | Claude Sonnet 5 | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 3 | Grok 4.6（xAI） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 3 | GPT-5.6 Luna（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 3 | DeepSeek V4 Flash（OpenCode/go） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | DeepSeek V4 Flash Free（OpenCode Zen） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | DeepSeek V4 Pro（OpenCode/go） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 3 | GLM-5.2（Z.AI） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | Big Pickle（OpenCode Zen, free） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | MiniMax M3（OpenCode/go） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | Hy3（OpenCode/go） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | Kimi K3（OpenCode/go） | 61.5% | 30.8–84.6% | 61.5% | 0.260 | 38.5% | 8 |
| 3 | Hy3 Free（OpenCode Zen） | 61.5% | 30.8–84.6% | 65.4% | 0.365 | 38.5% | 8 |
| 15 | Claude Haiku 4.5 | 53.8% | 23.1–76.9% | 53.8% | 0.087 | 30.8% | 9 |
| 15 | Nemotron 3 Ultra Free（OpenCode Zen） | 53.8% | 23.1–76.9% | 50.0% | — | 0.0% | 13 |
| 17 | Nemotron 3.5 Lightning Free（OpenCode Zen） | 46.2% | 15.4–76.9% | 50.0% | 0.000 | 7.7% | 12 |

\* base+head合算の値。Nemotron 3 Ultra Freeは全ケースをFAILと予測したため分散がゼロになり、MCCが定義できず `—` です。

### 通常diffとの比較: 抜け道は塞げたか

**GLM-5.3が首位から陥落しました（84.6% → 69.2%、-15.4pt）。Claude Opus 5は逆に上昇し首位に立ちました（76.9% → 88.5%、base+head合算、+11.5pt）。** これはまさにこのトラックが検出しようとしていた種類のシグナルです——GLM-5.3の通常diffトラックでの高スコアの一部は、diffに含まれていたテストのassertionを読んでいたことに支えられていた可能性があります。

ただし対応比較（`pnpm benchmark compare`）で見ると、**どちらの変化も統計的には有意ではありません**。GLM-5.3の-15.4ptは95%区間 -38.5%〜0.0%でゼロを含み、Opus 5の+11.5%も95%区間 -7.7%〜34.6%でゼロを含みます。n=26では、これだけ大きく見える点推定の変化ですら「たまたま」の範囲を否定できません。この観察は方向性としては筋が通っている（テスト除去でスコアが下がるのはリークがあった証拠、下がらない/上がるのは実際に推論していた証拠）とはいえ、確証ではなく仮説として扱ってください。より大きな split でこの比較を再現できれば、確証に近づきます。

## Architecture

```
packages/core       純粋ドメイン。I/Oゼロ。型・スコアリング・統計・
                    コンテキスト構築・出力コントラクト解析。
packages/db         Drizzle + SQLite。スキーマ・マイグレーション・リポジトリ。
packages/providers  ModelAdapter（openai / anthropic / gemini / openai-compatible）。
                    mock は開発・自己テスト専用。
packages/runner     並列度・リトライ・リピート・再開・キャンセル。
packages/cli        commander CLI。
apps/web            Next.js ダッシュボード。CLIと同じサービス層を使用。
```

依存は一方向（core ← その他）。coreがI/Oを持たないので、スコアリングエンジンのゴールデンfixtureテストはDBもHTTPも起動せずに走ります。

### 設計上の重要な選択

**Gold リーク防止を型で担保。** コンテキスト構築関数は `ModelFacingCase`（= `Omit<BenchmarkCase, 'gold'>`）しか受け取りません。加えて実行時に `gold` を削除し、さらに「goldだけが違う2ケースのレンダリング結果がバイト単位で一致すること」を全ContextStrategyでテストしています。

**障害の2分類を型で強制。** `InfrastructureError`（429/5xx/timeout → 指数バックオフでリトライ）と `OutputContractViolation`（不正JSON等 → リトライせず記録）は別の型です。混ぜるとAccuracyが静かに歪みます。400のような再試行しても同じ結果になるものは `retryable: false` になります。

**未回答のケースを分母から消さない。** 外部ハーネスの回答を取り込む `import-run` は、ハーネスが答えなかったケースも「未回答」という明示的な不正解として記録します。単に除外すると、難しいケースを飛ばしたハーネスが全問正解したハーネスに見えてしまいます。

**Accuracyの分母はpredictionモードに応じて決まる。** FORCEDモードでは棄権・不正出力も不正解として数える`accuracy`（= `strictAccuracy`）だけを見ます。SELECTIVEモードでは棄権が正当な選択肢なので、解決できたケースだけを分母にした`accuracy`と、カバレッジ（`selective.coverage`）を別々に報告します。どちらのモードでも、難しいケースへの無回答でリーダーボードの順位を上げることはできません。

**リーダーボードは同一スコープ（データセット版・split・コンテキスト戦略）でのみ順位付け。** データセットのバージョンやsplitはもちろん、コンテキスト戦略が異なるrunを同じ表に混ぜて注記だけで済ませるのではなく、最も多くのrunが使っているスコープ（dominant scope）だけで順位付けし、それ以外は除外・件数を明示します。24ケースのdev split runと122ケースのtest split runを同じ表で1位・2位と並べることはなく、通常diffのrunとimplementation-only-diffのrunが同じランキングに混ざることもありません——後者は実装時、初回のimplementation-only-diffベンチマーク実行で実際に発生し、コンテキスト戦略もスコープに含めるよう修正しました。

**信頼区間はPR単位のクラスターブートストラップ。** 同一PR由来のケースは差分も失敗モードも共有するため、独立標本として扱うと区間が実際より狭く出ます。

**再開可能性。** 予測は `(run_id, case_id, repetition)` 一意で1件ずつ即コミット。中断しても部分結果が残り、再開は残りだけ実行します。スループット（tests/min）はセッションをまたいで蓄積した実時間を分母にするため、再開のたびに見かけ上速くなることはありません。

**データセットバージョンのcontentHashはケースの全内容から計算。** IDだけでなく本文・gold・provenanceすべてを含めてハッシュ化するため、同じIDのケースが中身だけ差し替わっても検出できます。

**外部ハーネスの実行条件を構造化して記録。** `import-run` で取り込んだrunは、どのツールが・どんな制約のもとで回答したか（`harnessConditions`）をrun snapshotに保存します。「PRを検索して良いハーネス」と「禁じられたハーネス」は、同じ質問に答えていても別の実験条件です。

## CLI

実行はCLI、閲覧はWeb、という分担です。

```bash
pnpm benchmark seed [--force] [--with-mocks]
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
pnpm benchmark leaderboard [--metric headAccuracy|accuracy|failRecall|flipPairAccuracy|costPerTest|...] [--include-mocks]
pnpm benchmark verify-dataset [--only <ids>] [--json <path>]   # 上流GitHubとの突き合わせ
```

`--metric` の既定値は `headAccuracy`（primary track）です。`accuracy` はbase+head合算（副次トラック）を指します。

### 行列を一発で回す

```bash
pnpm benchmark sweep --models model-a,model-b --prompts reasoning-v1,concise-v1 \
                     --strategies TEST_ONLY,TEST_PLUS_DIFF --repetitions 3
```

セルは1つずつ順番に実行します。各runがすでにプロバイダの並列上限まで使うので、セルを並列化してもレート制限とレイテンシ計測の汚染しか起きません。途中のセルが失敗しても記録して続行します。

### アダプタが届かないモデルを測る

`export-cases` は**アダプタが送るのと同一の入力**（goldは除去済み）をJSONLに書き出し、`import-run` はその回答をrunとして取り込みます。取り込んだrunはネイティブなrunと同じスコアリング・区間・比較の対象になります。

```bash
pnpm benchmark export-cases --prompt reasoning-v1 --split dev --out /tmp/cases.jsonl
# 何らかのハーネスで回答し、{"caseId":"...","verdict":"PASS","confidence":0.8,"reason":"..."} をJSONLで用意
pnpm benchmark import-run --model my-model --prompt reasoning-v1 --split dev --file /tmp/answers.jsonl \
  --harness-tool "OpenCode CLI" --harness-policy "No gh, no web search, no repository browsing." \
  --harness-instructions "Answer from the exported prompt only."
```

`--harness-tool` を指定すると、そのハーネスの実行条件（ツール・制約・指示）がrun snapshotに構造化して残ります。省略した場合、run snapshotの `harnessConditions` は `null` になります。

未回答のケースは黙って捨てず件数を報告します（難しいケースを飛ばしたハーネスが、全問正解したハーネスに見えないように）。

### 人間ベンチマーク

```bash
pnpm benchmark human run --participant alice --limit 10
pnpm benchmark human score
pnpm benchmark human sessions
```

モデルとまったく同じ入力を人間に提示し、PASS/FAIL・確信度・所要時間を記録します。

## Metrics

Accuracy (head)（主指標、95%CI付き）/ Accuracy (base+head)（副次・反実仮想トラック）/ strict accuracy /
PASS・FAIL の precision・recall・F1 / Macro F1 / Balanced Accuracy / MCC / 混同行列 / ベースライン4種 /
Brier score / ECE / キャリブレーション曲線 / 閾値別 accuracy・coverage /
Coverage・Selective Accuracy・Abstention（SELECTIVEモード）/ latency p50・p90・p95・p99・TTFT /
トークンとコスト（cost/test, cost/1000, correct per dollar）/ Consistency・Flip rate・Majority@N・run間分散 /
Flip Pair Accuracy / スライス分析 / SafeSkip分析。

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
- **Netlify / Cloudflare Pages** — `netlify.toml` の通り。ビルドコマンド `pnpm install && pnpm seed && pnpm site`、公開ディレクトリ `apps/web/out`。DBが同梱されていればそのまま使われ、なければ `pnpm seed` が公開データセットとプロンプトだけを投入します（mockは登録されません）。

公開されるのは結果とデータセットです。データセットは公開PR由来で、各ケースが provenance（PR URL・Issue URL・根拠テストファイル・gold labelの根拠の強さ）を持つので、第三者がラベルを検証できます。APIキーはDBにもrun snapshotにも保存されないため、書き出しに含まれることはありません。

サイトはビルド時点のDBのスナップショットです。新しいrunを反映するには再ビルドしてください。ローカルで `pnpm dev` を使う場合は常に最新のDBを読みます。

## Testing

```bash
pnpm test          # 284 tests
pnpm coverage
pnpm typecheck
pnpm build
pnpm verify:dataset  # データセットを上流GitHubと突き合わせる（ネットワーク必須・数分かかる）
```

スコアリングは手計算できる値のゴールデンfixtureで検証しています（例: ECE = (0.6+0.3+0.8+0.1)/4 = 0.45）。ランナーは in-memory SQLite + mockアダプタでフル実行・再開・キャンセル・リトライ・goldリークを検証します。`import-run` の未回答ケース処理・headAccuracyの分母・IMPLEMENTATION_ONLY_DIFFのテストファイル除去は、それぞれ専用のゴールデンケースで検証しています。

## Measuring a model through an agent harness

APIキーがない環境では、`export-cases` / `import-run` を使ってエージェント経由でモデルに解かせられます。同梱の結果もこの方法で取得しています。

```bash
pnpm benchmark export-cases --prompt reasoning-v1 --split dev --out /tmp/cases.jsonl
# エージェントに cases.jsonl を解かせ、answers.jsonl を書かせる
pnpm benchmark import-run --model claude-haiku-4.5 --prompt reasoning-v1 --split dev --file /tmp/answers.jsonl
```

**測定の妥当性のために必須の条件**: 解かせる側に「PRや結果を一切調べさせない」ことです。`gh`・Web検索・リポジトリの参照を許すと、実際の結果を見つけてしまい、予測ではなく検索を測ることになります。この違いは出力からは見分けがつかないので、指示で明示的に禁じる必要があります。今回の全構成（通常diffトラック18件・implementation-only-diffトラック17件、あわせて35run）はすべてこの制約（`gh` 禁止・Web検索禁止・リポジトリ参照禁止・実行禁止）のもとで取得しており、その条件は各runの `harnessConditions` として構造化して保存し、[`data/raw-answers/README.md`](./data/raw-answers/README.md) と [`data/raw-answers-implementation-only/README.md`](./data/raw-answers-implementation-only/README.md) にも明記しています。

**この数字の読み方に関する注意**: これはエージェントハーネス経由で駆動したモデルであって、生のAPI呼び出しではありません。したがって latency と cost はこの経路では意味を持ちません（`import-run` で取り込んだrunにトークン計測がないため、コスト指標は空になります）。比較して意味があるのは Accuracy・FAIL recall・flip pair accuracy・較正といった予測の質に関する指標だけです。実運用の速度・コストを測りたい場合は、APIキーを設定して `anthropic` / `openai` アダプタで回してください。

## Known limitations

- **Gemini アダプタは非ストリーミング**です。したがってTTFTは常に `null` になります。総レイテンシから推定はしません。
- **mockプロバイダのスループット表示は非現実的**です。mockはシミュレートしたレイテンシを報告する一方、実時間ではほとんどsleepしないため、`tests/minute` が数万になります。実プロバイダでは正しい値になります。
- **データセットは148ケース / 71 PR クラスタ**です。スライスによっては n が小さく、区間が広くなります。UIは常に n と scope（データセット版・split）を併記します。
- `REPOSITORY_AGENT` コンテキスト戦略は入力の構築のみ実装されています。実際の静的リポジトリ探索にはツール使用に対応したアダプタが必要です。
- **MCC・FAIL recall・False PASSはhead-onlyで再計算していません。** `headAccuracy` は主指標として追加しましたが、分類指標（MCC等）の内訳はまだbase+head合算のままです。head-onlyの分類指標が必要な場合は `pnpm benchmark show <runId>` の `slices` セクションの `revision` バケットを参照してください（そちらはhead単体の値を持っています）。
- **gold provenanceは現状すべてOSSの記録から再構築したもの**です（`CI_EXECUTED`/`HUMAN_EXECUTED` は0件）。「このベンチマーク自身が実行して確認した」トラックはまだ存在しません。
- **gold ラベルの正しさは機械検証できません。** `pnpm verify:dataset` が保証するのはPR・コミット・diff・根拠パスが上流と一致することまでで、「そのテストが本当にそのリビジョンでFAILするか」は含みません。実際、抜き取りで実行検証したところ1件（`rg_0011`/`rg_0012`）で参照PRの誤りが見つかりました（[data/CORRECTIONS.md](./data/CORRECTIONS.md)）。同種の誤りが残っている可能性は排除できません。
- **15 PR（30ケース）で `baseSha` は `headSha` の親ではありません。** GitHubのPRの `base` はマージベースではなくベースブランチ先端なので、base と head の差にはそのPR以外のコミットも含まれます。`pnpm verify:dataset` が `REVISIONS_DIFFER_BEYOND_PR` として一覧します。
- **テストファイル判定はヒューリスティックです。** ディレクトリ名・ファイル名の命名規則に基づく推定であり、リポジトリ独自の変則的な命名規則（例: スナップショット形式のfixtureファイル）は捕捉できないことがあります。
- **implementation-only-diffトラックでの通常diffトラックとの差は、いずれも統計的に有意ではありません。** n=26では点推定の変化が大きく見えても対応比較の95%区間がゼロを含むことが多く、「テストを除去したら精度が落ちた/上がった」という言説は方向性の示唆であって確証ではありません（詳細は上記「Implementation-only diffでの結果」）。
- **`opencode-zen-mimo-v2.5-free` はimplementation-only-diffトラックを完走できませんでした。** ハーネスセッションが応答なしで15分以上停止したため除外しています。通常diffトラックでは同モデルは完走しています。

詳細仕様は [SPECIFICATION.md](./SPECIFICATION.md)、設計判断は [docs/superpowers/specs/](./docs/superpowers/specs/) を参照してください。
