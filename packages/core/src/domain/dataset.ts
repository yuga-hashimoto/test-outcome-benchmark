export const SPLITS = ['train', 'dev', 'test', 'hidden-test'] as const;
export type Split = (typeof SPLITS)[number];

export const DISTRIBUTIONS = ['natural', 'balanced'] as const;
/** `balanced` is an evaluation *view* over the same immutable cases, not a
 * different dataset: it downsamples the majority class deterministically. */
export type Distribution = (typeof DISTRIBUTIONS)[number];

export interface BenchmarkDataset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
}

/**
 * Dataset versions are immutable. Adding or editing cases produces a new
 * version, so a run's dataset reference always resolves to the exact cases that
 * were scored.
 */
export interface DatasetVersion {
  readonly id: string;
  readonly datasetId: string;
  readonly version: number;
  readonly caseCount: number;
  readonly contentHash: string;
  readonly frozenAt: string;
  readonly notes: string;
}
