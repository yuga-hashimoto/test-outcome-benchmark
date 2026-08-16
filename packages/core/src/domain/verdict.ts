/**
 * The gold outcome recorded for a real test execution. Only ever PASS or FAIL —
 * a benchmark case with an unknown real outcome is not a benchmark case.
 */
export const VERDICTS = ['PASS', 'FAIL'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * What a model is allowed to answer. UNKNOWN is reachable only in SELECTIVE
 * prediction mode; in FORCED mode it is an output-contract violation.
 */
export const PREDICTED_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type PredictedVerdict = (typeof PREDICTED_VERDICTS)[number];

export const PREDICTION_MODES = ['FORCED', 'SELECTIVE'] as const;
export type PredictionMode = (typeof PREDICTION_MODES)[number];

export const isVerdict = (value: unknown): value is Verdict =>
  typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);

export const isPredictedVerdict = (value: unknown): value is PredictedVerdict =>
  typeof value === 'string' && (PREDICTED_VERDICTS as readonly string[]).includes(value);

/** True when the model committed to an answer that can be scored against gold. */
export const isResolved = (verdict: PredictedVerdict | null): verdict is Verdict =>
  verdict === 'PASS' || verdict === 'FAIL';

export const oppositeVerdict = (verdict: Verdict): Verdict => (verdict === 'PASS' ? 'FAIL' : 'PASS');
