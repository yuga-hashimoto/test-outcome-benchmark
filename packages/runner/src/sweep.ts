import { startRun } from './service';
import type { StartRunInput } from './service';
import type { BenchmarkRun, ContextStrategy, RunMetrics } from '@tob/core';
import type { Db } from '@tob/db';

export interface SweepCell {
  readonly modelConfigId: string;
  readonly promptId: string;
  readonly contextStrategy: ContextStrategy;
  readonly run: BenchmarkRun | null;
  readonly metrics: RunMetrics | null;
  readonly error: string | null;
}

export interface SweepInput
  extends Omit<StartRunInput, 'modelConfigId' | 'promptId' | 'contextStrategy' | 'onProgress'> {
  readonly modelConfigIds: readonly string[];
  readonly promptIds: readonly string[];
  readonly contextStrategies?: readonly ContextStrategy[];
  readonly onCellStart?: (cell: {
    index: number;
    total: number;
    modelConfigId: string;
    promptId: string;
    contextStrategy: ContextStrategy;
  }) => void;
  readonly onCellFinish?: (cell: SweepCell) => void;
}

export interface SweepResult {
  readonly cells: readonly SweepCell[];
  readonly completed: number;
  readonly failed: number;
  readonly wallClockMs: number;
}

/**
 * Runs a whole Model × Prompt × Context matrix.
 *
 * Cells run one after another rather than concurrently: each individual run
 * already saturates its provider's concurrency ceiling, so overlapping them
 * would only produce rate limiting and make latency measurements meaningless.
 *
 * A cell that throws is recorded and the sweep continues. Losing eleven
 * finished cells because the twelfth hit an expired key would be the wrong
 * trade, and every finished run is already durable on its own.
 */
export const runSweep = async (db: Db, input: SweepInput): Promise<SweepResult> => {
  const strategies = input.contextStrategies ?? ['TEST_PLUS_TITLE_DESCRIPTION_DIFF'];
  const startedAt = Date.now();
  const cells: SweepCell[] = [];

  const combinations = input.modelConfigIds.flatMap((modelConfigId) =>
    input.promptIds.flatMap((promptId) =>
      strategies.map((contextStrategy) => ({ modelConfigId, promptId, contextStrategy })),
    ),
  );

  let index = 0;
  for (const combination of combinations) {
    index += 1;
    input.onCellStart?.({ index, total: combinations.length, ...combination });

    let cell: SweepCell;
    try {
      const result = await startRun(db, {
        ...input,
        modelConfigId: combination.modelConfigId,
        promptId: combination.promptId,
        contextStrategy: combination.contextStrategy,
      });
      cell = { ...combination, run: result.run, metrics: result.metrics, error: null };
    } catch (error) {
      cell = {
        ...combination,
        run: null,
        metrics: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    cells.push(cell);
    input.onCellFinish?.(cell);
  }

  return {
    cells,
    completed: cells.filter((cell) => cell.metrics !== null).length,
    failed: cells.filter((cell) => cell.error !== null).length,
    wallClockMs: Date.now() - startedAt,
  };
};
