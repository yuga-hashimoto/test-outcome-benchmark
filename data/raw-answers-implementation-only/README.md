# Raw answer artifacts — implementation-only-diff track

Same purpose as [`data/raw-answers/`](../raw-answers/README.md), but for the
**secondary measurement**: the same 26-case `dev` split, the same 18
harnesses, the same "no lookup" policy — with one difference. The exported
cases here used the `IMPLEMENTATION_ONLY_DIFF` context strategy, which
strips file hunks that look like test files out of the diff before it is
shown to the model (see `packages/core/src/context/diff-filter.ts`). A PR
diff often contains the literal test assertion a case describes; this track
measures whether a model's accuracy holds up once that shortcut is removed.

## Files

One file per model configuration, named `<model-config-name>.jsonl`, same
shape as the base-diff track. **17 of 18 models are present** —
`opencode-zen-mimo-v2.5-free` never completed: its harness session stalled
mid-run with no further server activity for over 15 minutes and no
completion, so it was killed and excluded rather than guessed at, the same
way `go/qwen3.8-max` and `Laguna S 2.1 Free` were excluded from the base
track.

## Reproducing a run

```bash
pnpm benchmark import-run \
  --model <model-config-name> \
  --prompt reasoning-v1 \
  --file data/raw-answers-implementation-only/<model-config-name>.jsonl \
  --strategy IMPLEMENTATION_ONLY_DIFF \
  --mode FORCED \
  --split dev
```
