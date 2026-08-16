import type { Distribution, Split } from './dataset';
import type { ContextStrategy } from './context';
import type { InferenceSettings, ModelPricing, ProviderId } from './model';
import type { PredictionMode } from './verdict';

export const RUN_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** What the user chose. Everything here is an axis of comparison. */
export interface RunConfiguration {
  readonly datasetVersionId: string;
  readonly split: Split | null;
  readonly distribution: Distribution;
  readonly modelConfigId: string;
  readonly promptId: string;
  readonly contextStrategy: ContextStrategy;
  readonly predictionMode: PredictionMode;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly seed: number;
}

/**
 * Everything needed to interpret a run's numbers after the fact, copied at
 * start time. Editing a prompt or repricing a model later cannot retroactively
 * change what a completed run means.
 */
export interface RunSnapshot {
  readonly datasetId: string;
  readonly datasetName: string;
  readonly datasetVersion: number;
  readonly datasetContentHash: string;
  readonly modelName: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly settings: InferenceSettings;
  readonly pricing: ModelPricing | null;
  readonly promptName: string;
  readonly promptVersion: number;
  readonly promptHash: string;
  readonly promptContent: string;
  readonly benchmarkGitSha: string | null;
}

export interface BenchmarkRun {
  readonly id: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly config: RunConfiguration;
  readonly snapshot: RunSnapshot;
  readonly totalPredictions: number;
  readonly completedPredictions: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: string | null;
}

export const defaultRunConfiguration = (
  overrides: Partial<RunConfiguration> &
    Pick<RunConfiguration, 'datasetVersionId' | 'modelConfigId' | 'promptId'>,
): RunConfiguration => ({
  split: null,
  distribution: 'natural',
  contextStrategy: 'TEST_PLUS_TITLE_DESCRIPTION_DIFF',
  predictionMode: 'FORCED',
  repetitions: 3,
  concurrency: 4,
  maxAttempts: 3,
  timeoutMs: 120_000,
  seed: 20260816,
  ...overrides,
});
