import { describe, expect, it } from 'vitest';
import { OutputContractViolation, extractJsonObject, parsePredictionOutput } from '@tob/core';

const forced = (raw: string) => parsePredictionOutput(raw, 'FORCED');

describe('json extraction', () => {
  it('reads a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('reads an object out of a fenced block', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('reads an object surrounded by prose', () => {
    expect(extractJsonObject('Sure! {"a":1} Hope that helps.')).toBe('{"a":1}');
  });

  it('respects braces inside strings', () => {
    expect(extractJsonObject('{"a":"}"}')).toBe('{"a":"}"}');
  });

  it('respects escaped quotes', () => {
    expect(extractJsonObject('{"a":"\\""}')).toBe('{"a":"\\""}');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('prediction output contract', () => {
  it('parses a well formed forced prediction', () => {
    const { prediction, warnings } = forced(
      JSON.stringify({
        verdict: 'FAIL',
        confidence: 0.82,
        reason: 'The guard is missing at the boundary.',
        evidence: [{ file: 'src/range.ts', location: 'L12', reason: 'no clamp' }],
        requiresRuntimeInformation: false,
      }),
    );

    expect(prediction.verdict).toBe('FAIL');
    expect(prediction.confidence).toBe(0.82);
    expect(prediction.evidence).toHaveLength(1);
    expect(prediction.requiresRuntimeInformation).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('normalises verdict casing', () => {
    expect(forced('{"verdict":"pass","confidence":0.5,"reason":"x"}').prediction.verdict).toBe('PASS');
  });

  it('rejects an unparseable response as a contract violation', () => {
    expect(() => forced('I think it will fail.')).toThrow(OutputContractViolation);
  });

  it('rejects a missing verdict', () => {
    expect(() => forced('{"confidence":0.9,"reason":"x"}')).toThrow(OutputContractViolation);
  });

  it('rejects abstention in forced mode', () => {
    try {
      forced('{"verdict":"UNKNOWN","confidence":0.4,"reason":"x"}');
      throw new Error('expected a violation');
    } catch (error) {
      expect(error).toBeInstanceOf(OutputContractViolation);
      expect((error as OutputContractViolation).code).toBe('UNKNOWN_IN_FORCED_MODE');
    }
  });

  it('accepts abstention in selective mode', () => {
    const { prediction } = parsePredictionOutput(
      '{"verdict":"UNKNOWN","confidence":0.4,"reason":"x"}',
      'SELECTIVE',
    );

    expect(prediction.verdict).toBe('UNKNOWN');
  });

  /**
   * A missing or out-of-range confidence loses calibration data but not the
   * verdict, so the prediction is still scored and the deviation is recorded.
   * Discarding it would throw away a usable answer.
   */
  it('keeps the verdict but flags a missing confidence', () => {
    const { prediction, warnings } = forced('{"verdict":"PASS","reason":"x"}');

    expect(prediction.verdict).toBe('PASS');
    expect(prediction.confidence).toBeNull();
    expect(warnings).toContain('CONFIDENCE_MISSING');
  });

  it('keeps the verdict but flags an out-of-range confidence', () => {
    const { prediction, warnings } = forced('{"verdict":"PASS","confidence":95,"reason":"x"}');

    expect(prediction.confidence).toBeNull();
    expect(warnings).toContain('CONFIDENCE_OUT_OF_RANGE');
  });

  it('flags malformed evidence entries and keeps the usable ones', () => {
    const { prediction, warnings } = forced(
      '{"verdict":"PASS","confidence":0.5,"reason":"x","evidence":[{"file":"a.ts"},"nope"]}',
    );

    expect(prediction.evidence).toHaveLength(1);
    expect(warnings).toContain('EVIDENCE_MALFORMED');
  });

  it('flags a response that was wrapped in prose', () => {
    const { warnings } = forced('Here you go: {"verdict":"PASS","confidence":0.5,"reason":"x"}');

    expect(warnings).toContain('WRAPPED_IN_PROSE');
  });
});
