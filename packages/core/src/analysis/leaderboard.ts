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

export const LEADERBOARD_METRICS = [
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
  accuracy: {
    label: 'Accuracy',
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
  const ranked = rankRuns(summaries, metric);
  const top = ranked[0];
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
  bestBy(summaries, 'accuracy', 'best-accuracy', 'Best accuracy'),
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
