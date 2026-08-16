import { buildConfusionMatrix, falsePassCount, resolvedPredictions } from './confusion';
import type { EvaluatedPrediction } from '../domain/prediction';

export interface SliceBucket {
  readonly value: string;
  readonly count: number;
  readonly resolved: number;
  readonly accuracy: number | null;
  readonly falsePassCount: number;
  readonly goldPassCount: number;
  readonly goldFailCount: number;
}

export interface SliceDimension {
  readonly key: string;
  readonly buckets: readonly SliceBucket[];
}

const formatValue = (value: string | number | boolean | null): string => {
  if (value === null) return 'unknown';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

/**
 * Groups predictions by every slice key present. Buckets carry their own counts
 * so a slice with four samples is visibly a slice with four samples rather than
 * a suspiciously round accuracy.
 */
export const computeSlices = (
  predictions: readonly EvaluatedPrediction[],
): SliceDimension[] => {
  const keys = new Set<string>();
  for (const prediction of predictions) {
    for (const key of Object.keys(prediction.slices)) keys.add(key);
  }

  return [...keys]
    .sort()
    .map((key) => {
      const byValue = new Map<string, EvaluatedPrediction[]>();
      for (const prediction of predictions) {
        const value = formatValue(prediction.slices[key] ?? null);
        const existing = byValue.get(value) ?? [];
        existing.push(prediction);
        byValue.set(value, existing);
      }

      const buckets = [...byValue.entries()]
        .map(([value, members]): SliceBucket => {
          const matrix = buildConfusionMatrix(members);
          const resolved = resolvedPredictions(members);
          const correct = resolved.filter(
            (prediction) => prediction.predictedVerdict === prediction.goldVerdict,
          ).length;

          return {
            value,
            count: members.length,
            resolved: resolved.length,
            accuracy: resolved.length === 0 ? null : correct / resolved.length,
            falsePassCount: falsePassCount(matrix),
            goldPassCount: members.filter((item) => item.goldVerdict === 'PASS').length,
            goldFailCount: members.filter((item) => item.goldVerdict === 'FAIL').length,
          };
        })
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));

      return { key, buckets };
    });
};
