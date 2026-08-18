# Raw answer artifacts — test split (122 cases)

Every non-Anthropic-native model on the leaderboard was benchmarked by an
external harness (a CLI agent — OpenCode or Antigravity via CAO, or a Claude
Code subagent) rather than by this repository calling the model's API
directly. Each harness saw only the exported cases (`export-cases`, gold
already stripped) and produced one JSON line per case in the files here.
`data/benchmark.sqlite` scores the result of importing these exact files —
nothing here is regenerated or hand-edited after the fact.

This directory exists because a scored result that cannot be traced back to
the raw answers it was scored from is not verifiable. Anyone who doubts a
number on the leaderboard can re-run the import against the file it came
from and get the identical result.

## Why a second directory, separate from `data/raw-answers/`

[`data/raw-answers/`](../raw-answers/) holds the original 26-case `dev`
split round. This directory holds a later, larger round on the 122-case
`test` split (61 PR clusters × 2 revisions, head=61) — run because the `dev`
split's head-only denominator (13 cases) only supports 14 distinct accuracy
values, which put most models within a point or two of each other purely
from quantization, not genuine ties. `test` gives `headAccuracy` a
1/61 ≈ 1.6pp resolution instead of 1/13 ≈ 7.7pp. Both rounds are kept and
neither supersedes the other — they're different samples of the same
dataset, and the README's published "Results so far" table uses `test` as
the primary result specifically because of this resolution difference.

## Files

One file per model configuration, named `<model-config-name>.jsonl` — the
same name shown in the CLI (`benchmark model list`) and the `model` column
in the database. Each line is one `{ caseId, verdict, confidence, reason }`
record, in the shape `export-cases` produced and `import-run` consumes. All
22 files answer the same 122-case `test` split with prompt `reasoning-v1`
and context strategy `TEST_PLUS_TITLE_DESCRIPTION_DIFF`.

## Reproducing a run

```bash
pnpm benchmark import-run \
  --model <model-config-name> \
  --prompt reasoning-v1 \
  --file data/raw-answers-test/<model-config-name>.jsonl \
  --strategy TEST_PLUS_TITLE_DESCRIPTION_DIFF \
  --mode FORCED \
  --split test
```

This reproduces the same metrics currently stored for that model, because
`import-run` is a pure function of the file's contents plus the dataset
version and scoring code — there is no hidden state.

## What "harness condition" means here

Every harness answering these cases was instructed not to look anything up:
no `gh`, no web search, no browsing the source repository, no running the
actual test. The question posed to the model was exactly the exported
prompt — test case plus PR title/description/diff — and nothing else. This
is recorded here as a fact about how the data was produced, and also
structurally on each run's snapshot (`harnessConditions`: tool, tool policy,
instructions) — set with `--harness-tool`/`--harness-policy`/
`--harness-instructions` on `import-run`.

## One correction made to raw output before import

`alibaba-qwen3.6-flash.jsonl` line 26 originally read `"caseId": "kb_0010"`
— a one-digit-short typo for `kb_00010` (the harness's own `reason` text on
that line says "Same as kb_0009", confirming it was answering the head-
revision case immediately following `kb_0009`, just mislabeled). The
caseId was corrected to `kb_00010` before import; no other field on that
line was touched. Without the fix, the file would have one caseId missing
(`kb_00010`) and one caseId not in the dataset (`kb_0010`), which the
validation pass this file went through (checking every file's caseId set
against the expected 122, before any of them were imported) caught.

## Models attempted this round but excluded

Not every model dispatched this round produced usable output. These were
excluded and are not on the leaderboard for the `test` split (or anywhere):

| model | gateway | reason excluded |
|---|---|---|
| `nvidia/openai/gpt-oss-120b` | nvidia via OpenCode | Reported "122 lines written" but the file had 101 lines / 96 unique caseIds (5 duplicates), and every verdict was PASS with the identical boilerplate reason "Based on the described expected behavior, the test should pass." — not real per-case reasoning. |
| `nvidia/meta/llama-4-maverick-17b-128e-instruct` | nvidia via OpenCode | `410 Gone — reached its end of life`. |
| `nvidia/mistralai/mistral-medium-3.5-128b` | nvidia via OpenCode | `410 Gone — reached its end of life`. |
| `nvidia/mistralai/mistral-large-3-675b-instruct-2512` | nvidia via OpenCode | Attempted as a replacement for the above; also `410 Gone — end of life`. |
| `nvidia/mistralai/mistral-medium-3-instruct` | nvidia via OpenCode | Attempted as a second replacement; `404 Not Found`. |
| `nvidia/meta/llama-3.3-70b-instruct` | nvidia via OpenCode | Started, then genuinely stalled — no change in session state across a full 25-minute check. |
| `opencode-zen-nemotron-3.5-lightning-free` | OpenCode Zen (free) | Completed 122/122 with the correct caseId set and every verdict PASS with `confidence: 0.6` and an *empty* `reason` string on all 122 lines — a different but equally clear degenerate-output pattern, not genuine reasoning. See `test-opencode-zen-nemotron-3.5-lightning-free.jsonl.broken` in the working directory this was generated in (not committed). |
| `gemini-3.5-flash-high` | Antigravity | Session launches/resumed repeatedly timed out or crashed and vanished from the tmux session list mid-generation; never reached completion. |
| `gemini-3.1-pro-high` | Antigravity | Same failure mode as above — crashed/vanished from the tmux session list twice; never reached completion. |
| `openrouter/google/gemma-4-31b-it:free` | OpenRouter (free) | Persistently rate-limited upstream (Google AI Studio); OpenCode's own retry backoff grew past 50 minutes with no sign of succeeding within a practical time budget. |

None of these are silently dropped — they're recorded here, and the models
that did complete (`antigravity-gemini-3.6-flash`,
`antigravity-gemini-3.7-flash`, `openrouter-cohere-north-mini-code`) are on
the leaderboard alongside the models carried over from the `dev`-split
round.
