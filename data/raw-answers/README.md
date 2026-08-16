# Raw answer artifacts

Every non-Anthropic-native model on the leaderboard was benchmarked by an
external harness (a CLI agent — Codex, OpenCode, Antigravity, or a Claude Code
subagent) rather than by this repository calling the model's API directly.
Each harness saw only the exported cases (`export-cases`, gold already
stripped) and produced one JSON line per case in the files here. `data/benchmark.sqlite`
scores the result of importing these exact files — nothing here is
regenerated or hand-edited after the fact.

This directory exists because a scored result that cannot be traced back to
the raw answers it was scored from is not verifiable. Anyone who doubts a
number on the leaderboard can re-run the import against the file it came
from and get the identical result.

## Files

One file per model configuration, named `<model-config-name>.jsonl` — the
same name shown in the CLI (`benchmark models`) and the `model` column in the
database. Each line is one `{ caseId, repetition, verdict, confidence,
reason }` record, in the shape `export-cases` produced and `import-run`
consumes. All 18 files answer the same 26-case `dev` split with prompt
`reasoning-v1` and context strategy `TEST_PLUS_TITLE_DESCRIPTION_DIFF`.

## Reproducing a run

```bash
pnpm benchmark import-run \
  --model <model-config-name> \
  --prompt reasoning-v1 \
  --file data/raw-answers/<model-config-name>.jsonl \
  --strategy TEST_PLUS_TITLE_DESCRIPTION_DIFF \
  --mode FORCED \
  --split dev
```

This reproduces the same metrics currently stored for that model, because
`import-run` is a pure function of the file's contents plus the dataset
version and scoring code — there is no hidden state.

## What "harness condition" means here

Every harness answering these cases was instructed not to look anything up:
no `gh`, no web search, no browsing the source repository, no running the
actual test. The question posed to the model was exactly the exported
prompt — test case plus PR title/description/diff — and nothing else. This
is recorded here as a fact about how the data was produced; the run
snapshot in the database does not yet capture harness instructions or tool
policy as a structured field (tracked as follow-up work).
