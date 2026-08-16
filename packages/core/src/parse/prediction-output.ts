import { OutputContractViolation } from '../domain/errors';
import { extractJsonObject } from './extract-json';
import { isPredictedVerdict } from '../domain/verdict';
import type { Evidence, ParsedPrediction } from '../domain/prediction';
import type { PredictionMode } from '../domain/verdict';

/**
 * Non-fatal deviations from the contract. The verdict is still scoreable, so
 * discarding the prediction would lose real signal — but the deviation is
 * counted and reported rather than silently absorbed.
 */
export const CONTRACT_WARNINGS = [
  'CONFIDENCE_MISSING',
  'CONFIDENCE_OUT_OF_RANGE',
  'EVIDENCE_MALFORMED',
  'REASON_MISSING',
  'WRAPPED_IN_PROSE',
] as const;
export type ContractWarning = (typeof CONTRACT_WARNINGS)[number];

export interface ParseOutcome {
  readonly prediction: ParsedPrediction;
  readonly warnings: readonly ContractWarning[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseEvidence = (value: unknown): { evidence: Evidence[]; malformed: boolean } => {
  if (value === undefined || value === null) return { evidence: [], malformed: false };
  if (!Array.isArray(value)) return { evidence: [], malformed: true };

  const evidence: Evidence[] = [];
  let malformed = false;

  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) {
      malformed = true;
      continue;
    }
    const file = typeof record['file'] === 'string' ? record['file'] : null;
    const location = typeof record['location'] === 'string' ? record['location'] : '';
    const reason = typeof record['reason'] === 'string' ? record['reason'] : '';
    if (file === null) {
      malformed = true;
      continue;
    }
    evidence.push({ file, location, reason });
  }

  return { evidence, malformed };
};

export const parsePredictionOutput = (raw: string, mode: PredictionMode): ParseOutcome => {
  const json = extractJsonObject(raw);
  if (json === null) {
    throw new OutputContractViolation('Response contained no JSON object', {
      rawResponse: raw,
      code: 'NO_JSON',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new OutputContractViolation(
      `Response JSON did not parse: ${error instanceof Error ? error.message : String(error)}`,
      { rawResponse: raw, code: 'INVALID_JSON' },
    );
  }

  const record = asRecord(parsed);
  if (record === null) {
    throw new OutputContractViolation('Response JSON was not an object', {
      rawResponse: raw,
      code: 'NOT_AN_OBJECT',
    });
  }

  const warnings: ContractWarning[] = [];
  if (json.trim() !== raw.trim()) warnings.push('WRAPPED_IN_PROSE');

  const rawVerdict = record['verdict'];
  const verdict =
    typeof rawVerdict === 'string' ? rawVerdict.trim().toUpperCase() : rawVerdict;

  if (!isPredictedVerdict(verdict)) {
    throw new OutputContractViolation(
      `Response verdict was ${JSON.stringify(rawVerdict)}, expected PASS, FAIL${
        mode === 'SELECTIVE' ? ' or UNKNOWN' : ''
      }`,
      { rawResponse: raw, code: 'INVALID_VERDICT' },
    );
  }

  if (verdict === 'UNKNOWN' && mode === 'FORCED') {
    throw new OutputContractViolation('Response abstained in forced prediction mode', {
      rawResponse: raw,
      code: 'UNKNOWN_IN_FORCED_MODE',
    });
  }

  const rawConfidence = record['confidence'];
  let confidence: number | null = null;
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    if (rawConfidence >= 0 && rawConfidence <= 1) {
      confidence = rawConfidence;
    } else {
      warnings.push('CONFIDENCE_OUT_OF_RANGE');
    }
  } else {
    warnings.push('CONFIDENCE_MISSING');
  }

  const rawReason = record['reason'];
  const reason = typeof rawReason === 'string' ? rawReason : '';
  if (reason.trim().length === 0) warnings.push('REASON_MISSING');

  const { evidence, malformed } = parseEvidence(record['evidence']);
  if (malformed) warnings.push('EVIDENCE_MALFORMED');

  const rawRequiresRuntime = record['requiresRuntimeInformation'];
  const requiresRuntimeInformation =
    typeof rawRequiresRuntime === 'boolean' ? rawRequiresRuntime : null;

  return {
    prediction: { verdict, confidence, reason, evidence, requiresRuntimeInformation },
    warnings,
  };
};
