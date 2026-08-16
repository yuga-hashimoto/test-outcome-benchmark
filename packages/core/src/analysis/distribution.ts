import { createRng } from '../rng';
import type { BenchmarkCase } from '../domain/case';
import type { Distribution } from '../domain/dataset';

/**
 * Deterministic shuffle. Used so the balanced view is a stable, reproducible
 * subset rather than a different sample on every page load.
 */
const seededShuffle = <T>(items: readonly T[], seed: number | string): T[] => {
  const rng = createRng(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    const current = result[index] as T;
    result[index] = result[swapIndex] as T;
    result[swapIndex] = current;
  }
  return result;
};

/**
 * Applies an evaluation view over an immutable case set.
 *
 * `balanced` downsamples the majority class so accuracy is not dominated by the
 * base rate. It is a view, not a new dataset: the underlying version is
 * unchanged, and both views are reported so the natural-distribution number
 * stays visible alongside it.
 */
export const applyDistribution = (
  cases: readonly BenchmarkCase[],
  distribution: Distribution,
  seed: number | string = 'distribution',
): BenchmarkCase[] => {
  const ordered = [...cases].sort((left, right) => left.id.localeCompare(right.id));
  if (distribution === 'natural') return ordered;

  const passing = ordered.filter((item) => item.gold.result === 'PASS');
  const failing = ordered.filter((item) => item.gold.result === 'FAIL');
  const size = Math.min(passing.length, failing.length);

  if (size === 0) return ordered;

  const selected = [
    ...seededShuffle(passing, `${seed}:pass`).slice(0, size),
    ...seededShuffle(failing, `${seed}:fail`).slice(0, size),
  ];

  return selected.sort((left, right) => left.id.localeCompare(right.id));
};
