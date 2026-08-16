import type { ContextStrategy } from '../domain/context';
import type { InferenceSettings, ProviderId } from '../domain/model';
import type { RunMetrics } from '../scoring/aggregate';

/** A finished run, flattened to what ranking and comparison views need. */
export interface RunSummary {
  readonly runId: string;
  readonly runName: string;
  readonly modelConfigId: string;
  readonly modelName: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly settings: InferenceSettings;
  readonly promptId: string;
  readonly promptName: string;
  readonly promptVersion: number;
  readonly promptHash: string;
  readonly contextStrategy: ContextStrategy;
  readonly datasetVersionId: string;
  /** Surfaced in rankings: runs scored on different case sets are not comparable. */
  readonly datasetVersion: number;
  /** Which split was scored. A dev-split run and a full run are different samples. */
  readonly split: string | null;
  /** Predictions actually scored, so a small sample is visible as a small sample. */
  readonly resolved: number;
  readonly finishedAt: string | null;
  readonly metrics: RunMetrics;
}

/**
 * Mock adapters exist to exercise the benchmark machinery, not to compete with
 * real models. Formal dashboards and leaderboards use this view by default.
 */
export const formalBenchmarkRuns = (summaries: readonly RunSummary[]): RunSummary[] =>
  summaries.filter((summary) => summary.provider !== 'mock');

export const LEADERBOARD_METRICS = [
  'headAccuracy',
  'accuracy',
  'strictAccuracy',
  'macroF1',
  'balancedAccuracy',
  'mcc',
  'failRecall',
  'flipPairAccuracy',
  'majorityAccuracy',
  'consistencyRate',
  'costPerTest',
  'correctPerDollar',
  'latencyP95',
  'brierScore',
] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

interface MetricDescriptor {
  readonly label: string;
  readonly direction: 'higher' | 'lower';
  readonly select: (metrics: RunMetrics) => number | null;
  readonly format: 'ratio' | 'currency' | 'milliseconds' | 'score';
}

export const METRIC_DESCRIPTORS: Readonly<Record<LeaderboardMetric, MetricDescriptor>> = {
  /**
   * The primary track: given this test and this PR, does it pass or fail
   * right now. Restricted to head-revision cases, so a run cannot climb this
   * ranking on the strength of the (different, counterfactual) base-revision
   * cases — see `accuracy` for that combined, secondary figure.
   */
  headAccuracy: {
    label: 'Accuracy (head)',
    direction: 'higher',
    select: (metrics) => metrics.headAccuracy,
    format: 'ratio',
  },
  /** Base+head combined — a secondary, counterfactual-reasoning track. */
  accuracy: {
    label: 'Accuracy (base+head)',
    direction: 'higher',
    select: (metrics) => metrics.accuracy,
    format: 'ratio',
  },
  strictAccuracy: {
    label: 'Strict accuracy',
    direction: 'higher',
    select: (metrics) => metrics.strictAccuracy,
    format: 'ratio',
  },
  macroF1: {
    label: 'Macro F1',
    direction: 'higher',
    select: (metrics) => metrics.classification.macroF1,
    format: 'score',
  },
  balancedAccuracy: {
    label: 'Balanced accuracy',
    direction: 'higher',
    select: (metrics) => metrics.classification.balancedAccuracy,
    format: 'ratio',
  },
  mcc: {
    label: 'MCC',
    direction: 'higher',
    select: (metrics) => metrics.classification.mcc,
    format: 'score',
  },
  failRecall: {
    label: 'FAIL recall',
    direction: 'higher',
    select: (metrics) => metrics.classification.fail.recall,
    format: 'ratio',
  },
  flipPairAccuracy: {
    label: 'Flip pair accuracy',
    direction: 'higher',
    select: (metrics) => metrics.flipPairs.accuracy,
    format: 'ratio',
  },
  majorityAccuracy: {
    label: 'Majority@N accuracy',
    direction: 'higher',
    select: (metrics) => metrics.stability.majorityAccuracy,
    format: 'ratio',
  },
  consistencyRate: {
    label: 'Consistency rate',
    direction: 'higher',
    select: (metrics) => metrics.stability.consistencyRate,
    format: 'ratio',
  },
  costPerTest: {
    label: 'Cost per test',
    direction: 'lower',
    select: (metrics) => metrics.cost.costPerTest,
    format: 'currency',
  },
  correctPerDollar: {
    label: 'Correct predictions per dollar',
    direction: 'higher',
    select: (metrics) => metrics.cost.correctPerDollar,
    format: 'score',
  },
  latencyP95: {
    label: 'Latency p95',
    direction: 'lower',
    select: (metrics) => metrics.latency.endToEnd.p95,
    format: 'milliseconds',
  },
  brierScore: {
    label: 'Brier score',
    direction: 'lower',
    select: (metrics) => metrics.calibration.brierScore,
    format: 'score',
  },
};

export interface RankedRun {
  readonly rank: number;
  readonly summary: RunSummary;
  readonly value: number;
}

/**
 * Runs with no value for the chosen metric are dropped rather than ranked last:
 * a configuration with no cost data is not the cheapest.
 */
export const rankRuns = (
  summaries: readonly RunSummary[],
  metric: LeaderboardMetric,
): RankedRun[] => {
  const descriptor = METRIC_DESCRIPTORS[metric];

  const scored = summaries
    .map((summary) => ({ summary, value: descriptor.select(summary.metrics) }))
    .filter((entry): entry is { summary: RunSummary; value: number } => entry.value !== null);

  scored.sort((left, right) =>
    descriptor.direction === 'higher' ? right.value - left.value : left.value - right.value,
  );

  return scored.map((entry, index) => ({ rank: index + 1, ...entry }));
};

export interface Scope {
  readonly datasetVersion: number;
  readonly split: string | null;
}

const scopeKey = (summary: RunSummary): string =>
  `${summary.datasetVersion}:${summary.split ?? 'all'}`;

/**
 * The (dataset version, split) pair used by the largest number of runs. A
 * run's accuracy is an estimate over the specific sample it was scored on,
 * so a 24-case dev-split run and a 124-case full-dataset run are estimates
 * of different quantities — this is what a ranking should hold fixed rather
 * than mix, the same way it already holds prompt and context strategy fixed.
 */
export const dominantScope = (summaries: readonly RunSummary[]): Scope | null => {
  if (summaries.length === 0) return null;

  const counts = new Map<string, { scope: Scope; count: number }>();
  for (const summary of summaries) {
    const key = scopeKey(summary);
    const entry = counts.get(key);
    counts.set(key, {
      scope: { datasetVersion: summary.datasetVersion, split: summary.split },
      count: (entry?.count ?? 0) + 1,
    });
  }

  const [best] = [...counts.values()].sort((left, right) => right.count - left.count);
  return best?.scope ?? null;
};

const inScope = (summaries: readonly RunSummary[], scope: Scope | null): RunSummary[] =>
  scope === null
    ? []
    : summaries.filter(
        (summary) =>
          summary.datasetVersion === scope.datasetVersion && summary.split === scope.split,
      );

export interface ScopedRanking {
  readonly scope: Scope | null;
  readonly ranked: RankedRun[];
  /** Runs excluded because they were scored on a different dataset version or split. */
  readonly excluded: readonly RunSummary[];
}

/**
 * Ranks only within the dominant scope, so a small easier sample can never
 * outrank a large harder one at the same nominal accuracy. Callers that used
 * to mix scopes with a footnote warning should use this instead — the
 * footnote described the problem, this prevents it.
 */
export const rankRunsInScope = (
  summaries: readonly RunSummary[],
  metric: LeaderboardMetric,
): ScopedRanking => {
  const scope = dominantScope(summaries);
  const scoped = inScope(summaries, scope);
  const excluded = summaries.filter((summary) => !scoped.includes(summary));

  return { scope, ranked: rankRuns(scoped, metric), excluded };
};

export interface MatrixCell {
  readonly modelConfigId: string;
  readonly promptId: string;
  readonly value: number | null;
  readonly runId: string | null;
}

export interface ModelPromptMatrix {
  readonly models: readonly { id: string; label: string }[];
  readonly prompts: readonly { id: string; label: string }[];
  readonly cells: readonly MatrixCell[];
  readonly metric: LeaderboardMetric;
}

/** When several runs share a model×prompt cell, the most recent one wins. */
export const buildModelPromptMatrix = (
  summaries: readonly RunSummary[],
  metric: LeaderboardMetric = 'accuracy',
): ModelPromptMatrix => {
  const descriptor = METRIC_DESCRIPTORS[metric];

  const models = new Map<string, string>();
  const prompts = new Map<string, string>();
  const byCell = new Map<string, RunSummary>();

  const sorted = [...summaries].sort((left, right) =>
    (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''),
  );

  for (const summary of sorted) {
    models.set(summary.modelConfigId, summary.modelName);
    prompts.set(summary.promptId, `${summary.promptName} v${summary.promptVersion}`);
    byCell.set(`${summary.modelConfigId}::${summary.promptId}`, summary);
  }

  const cells: MatrixCell[] = [];
  for (const modelConfigId of models.keys()) {
    for (const promptId of prompts.keys()) {
      const summary = byCell.get(`${modelConfigId}::${promptId}`);
      cells.push({
        modelConfigId,
        promptId,
        value: summary === undefined ? null : descriptor.select(summary.metrics),
        runId: summary?.runId ?? null,
      });
    }
  }

  return {
    models: [...models.entries()].map(([id, label]) => ({ id, label })),
    prompts: [...prompts.entries()].map(([id, label]) => ({ id, label })),
    cells,
    metric,
  };
};

export interface Highlight {
  readonly id: string;
  readonly label: string;
  readonly metric: LeaderboardMetric;
  readonly value: number | null;
  readonly summary: RunSummary | null;
}

const bestBy = (
  summaries: readonly RunSummary[],
  metric: LeaderboardMetric,
  id: string,
  label: string,
): Highlight => {
  const top = rankRunsInScope(summaries, metric).ranked[0];
  return {
    id,
    label,
    metric,
    value: top?.value ?? null,
    summary: top?.summary ?? null,
  };
};

/** The dashboard cards from spec §15. */
export const dashboardHighlights = (summaries: readonly RunSummary[]): Highlight[] => [
  bestBy(summaries, 'headAccuracy', 'best-accuracy', 'Best accuracy (head)'),
  bestBy(summaries, 'accuracy', 'best-combined-accuracy', 'Best accuracy (base+head)'),
  bestBy(summaries, 'latencyP95', 'fastest', 'Fastest configuration'),
  bestBy(summaries, 'costPerTest', 'cheapest', 'Cheapest configuration'),
  bestBy(summaries, 'failRecall', 'best-fail-recall', 'Best FAIL recall'),
  bestBy(summaries, 'correctPerDollar', 'best-value', 'Best accuracy per dollar'),
  bestBy(summaries, 'consistencyRate', 'most-stable', 'Most stable configuration'),
];

export interface ParetoPoint {
  readonly summary: RunSummary;
  readonly x: number;
  readonly y: number;
  readonly onFront: boolean;
}

/**
 * Pareto front for an (x, y) trade-off such as accuracy against cost. A point is
 * on the front when nothing else beats it on both axes at once.
 */
export const paretoFront = (
  summaries: readonly RunSummary[],
  xMetric: LeaderboardMetric,
  yMetric: LeaderboardMetric,
): ParetoPoint[] => {
  const xDescriptor = METRIC_DESCRIPTORS[xMetric];
  const yDescriptor = METRIC_DESCRIPTORS[yMetric];

  const points = summaries
    .map((summary) => ({
      summary,
      x: xDescriptor.select(summary.metrics),
      y: yDescriptor.select(summary.metrics),
    }))
    .filter((point): point is { summary: RunSummary; x: number; y: number } =>
      point.x !== null && point.y !== null,
    );

  const betterOrEqual = (
    candidate: number,
    incumbent: number,
    direction: 'higher' | 'lower',
  ): boolean => (direction === 'higher' ? candidate >= incumbent : candidate <= incumbent);

  const strictlyBetter = (
    candidate: number,
    incumbent: number,
    direction: 'higher' | 'lower',
  ): boolean => (direction === 'higher' ? candidate > incumbent : candidate < incumbent);

  return points.map((point) => {
    const dominated = points.some(
      (other) =>
        other !== point &&
        betterOrEqual(other.x, point.x, xDescriptor.direction) &&
        betterOrEqual(other.y, point.y, yDescriptor.direction) &&
        (strictlyBetter(other.x, point.x, xDescriptor.direction) ||
          strictlyBetter(other.y, point.y, yDescriptor.direction)),
    );
    return { ...point, onFront: !dominated };
  });
};
