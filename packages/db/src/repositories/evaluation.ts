import { clusterIdOf, deriveSlices } from '@tob/core';
import { getRun } from './runs';
import { listCases } from './datasets';
import { listPredictions } from './predictions';
import type { BenchmarkCase, EvaluatedPrediction, PredictionRecord } from '@tob/core';
import type { Db } from '../client';

export interface RunCaseDetail {
  readonly prediction: PredictionRecord;
  readonly benchmarkCase: BenchmarkCase;
  readonly correct: boolean | null;
}

const caseIndexFor = (db: Db, runId: string): Map<string, BenchmarkCase> => {
  const run = getRun(db, runId);
  if (run === null) throw new Error(`Unknown run ${runId}`);

  const index = new Map<string, BenchmarkCase>();
  for (const item of listCases(db, run.config.datasetVersionId)) {
    index.set(item.id, item);
  }
  return index;
};

/**
 * Joins stored predictions with their cases to produce the scoring engine's
 * input. Slice values and the cluster id are derived here rather than stored,
 * so adding a slice dimension does not require a migration or a re-run.
 */
export const buildEvaluatedPredictions = (db: Db, runId: string): EvaluatedPrediction[] => {
  const index = caseIndexFor(db, runId);

  return listPredictions(db, runId).flatMap((prediction): EvaluatedPrediction[] => {
    const benchmarkCase = index.get(prediction.caseId);
    if (benchmarkCase === undefined) return [];

    return [
      {
        caseId: prediction.caseId,
        repetition: prediction.repetition,
        clusterId: clusterIdOf(benchmarkCase),
        goldVerdict: prediction.goldVerdict,
        predictedVerdict: prediction.predictedVerdict,
        confidence: prediction.confidence,
        errorKind: prediction.error?.kind ?? null,
        latency: prediction.latency,
        usage: prediction.usage,
        costUsd: prediction.costUsd,
        flipPairId: benchmarkCase.flipPairId,
        revision: benchmarkCase.revision,
        slices: deriveSlices(benchmarkCase),
      },
    ];
  });
};

export const listRunCaseDetails = (db: Db, runId: string): RunCaseDetail[] => {
  const index = caseIndexFor(db, runId);

  return listPredictions(db, runId).flatMap((prediction): RunCaseDetail[] => {
    const benchmarkCase = index.get(prediction.caseId);
    if (benchmarkCase === undefined) return [];

    const correct =
      prediction.predictedVerdict === 'PASS' || prediction.predictedVerdict === 'FAIL'
        ? prediction.predictedVerdict === prediction.goldVerdict
        : null;

    return [{ prediction, benchmarkCase, correct }];
  });
};

/** Tests that really fail, predicted to pass — the drill-down that matters most. */
export const listFalsePassCases = (db: Db, runId: string): RunCaseDetail[] =>
  listRunCaseDetails(db, runId).filter(
    (detail) =>
      detail.prediction.goldVerdict === 'FAIL' && detail.prediction.predictedVerdict === 'PASS',
  );

export const listHighConfidenceMistakes = (
  db: Db,
  runId: string,
  threshold = 0.8,
): RunCaseDetail[] =>
  listRunCaseDetails(db, runId)
    .filter(
      (detail) =>
        detail.correct === false &&
        detail.prediction.confidence !== null &&
        detail.prediction.confidence >= threshold,
    )
    .sort((left, right) => (right.prediction.confidence ?? 0) - (left.prediction.confidence ?? 0));

export const listErroredCases = (db: Db, runId: string): RunCaseDetail[] =>
  listRunCaseDetails(db, runId).filter((detail) => detail.prediction.error !== null);
