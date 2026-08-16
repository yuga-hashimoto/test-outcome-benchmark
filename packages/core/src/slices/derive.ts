import { diffLinesOf, testTextLengthOf } from '../domain/case';
import type { BenchmarkCase } from '../domain/case';
import type { SliceValues } from '../domain/prediction';

/**
 * Continuous quantities are bucketed rather than sliced raw. A slice per
 * distinct diff size would produce one case per bucket and an accuracy of 0 or
 * 1 everywhere, which looks like signal and is not.
 */
const bucketize = (value: number, edges: readonly number[]): string => {
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index] as number;
    if (value <= edge) {
      const previous = index === 0 ? 0 : (edges[index - 1] as number) + 1;
      return `${previous}-${edge}`;
    }
  }
  return `${(edges[edges.length - 1] as number) + 1}+`;
};

/** Slice dimensions from spec §12, derived from a case's own metadata. */
export const deriveSlices = (benchmarkCase: BenchmarkCase): SliceValues => ({
  testType: benchmarkCase.metadata.testType,
  casePattern: benchmarkCase.metadata.casePattern,
  revision: benchmarkCase.revision,
  goldVerdict: benchmarkCase.gold.result,
  feature: benchmarkCase.metadata.feature,
  platform: benchmarkCase.metadata.platform,
  specificity: benchmarkCase.metadata.specificity,
  ambiguity: benchmarkCase.metadata.ambiguity,
  externalDependency: benchmarkCase.metadata.externalDependency,
  tags: benchmarkCase.metadata.tags.length === 0 ? 'none' : [...benchmarkCase.metadata.tags].sort().join('+'),
  repository: benchmarkCase.pr.repository,
  language: benchmarkCase.pr.language,
  labels:
    benchmarkCase.pr.labels.length === 0 ? 'none' : [...benchmarkCase.pr.labels].sort().join('+'),
  stepCount: bucketize(benchmarkCase.testCase.steps.length, [2, 4, 6]),
  testTextLength: bucketize(testTextLengthOf(benchmarkCase.testCase), [200, 500, 1000]),
  expectedResultLength: bucketize(benchmarkCase.testCase.expectedResult.length, [80, 200, 400]),
  changedFiles:
    benchmarkCase.pr.changedFiles === null
      ? null
      : bucketize(benchmarkCase.pr.changedFiles, [1, 3, 10]),
  diffLines: bucketize(diffLinesOf(benchmarkCase.pr), [20, 100, 400]),
  commits: benchmarkCase.pr.commits === null ? null : bucketize(benchmarkCase.pr.commits, [1, 3, 10]),
});
