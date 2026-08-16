import type { BenchmarkCase } from '../domain/case';

export interface IntegrityIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
}

export interface IntegrityReport {
  readonly issues: readonly IntegrityIssue[];
  readonly ok: boolean;
}

/**
 * Structural checks a dataset must survive before it can be frozen.
 *
 * The label-balance warnings matter as much as the hard errors: a dataset where
 * every base case is FAIL and every head case is PASS is answerable from the
 * revision field alone, and would report high accuracy while measuring nothing.
 */
export const checkDatasetIntegrity = (cases: readonly BenchmarkCase[]): IntegrityReport => {
  const issues: IntegrityIssue[] = [];

  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_CASE_ID', message: `Duplicate case id ${item.id}` });
    }
    seen.add(item.id);
  }

  const byFlipPair = new Map<string, BenchmarkCase[]>();
  for (const item of cases) {
    if (item.flipPairId === null) continue;
    const members = byFlipPair.get(item.flipPairId) ?? [];
    members.push(item);
    byFlipPair.set(item.flipPairId, members);
  }

  for (const [flipPairId, members] of byFlipPair) {
    if (members.length !== 2) {
      issues.push({
        severity: 'error',
        code: 'FLIP_PAIR_SIZE',
        message: `Flip pair ${flipPairId} has ${members.length} members, expected 2`,
      });
      continue;
    }
    const [first, second] = members as [BenchmarkCase, BenchmarkCase];
    if (first.gold.result === second.gold.result) {
      issues.push({
        severity: 'error',
        code: 'FLIP_PAIR_NO_FLIP',
        message: `Flip pair ${flipPairId} does not flip: both sides are ${first.gold.result}`,
      });
    }
    if (first.revision === second.revision) {
      issues.push({
        severity: 'error',
        code: 'FLIP_PAIR_SAME_REVISION',
        message: `Flip pair ${flipPairId} has both members at revision ${first.revision}`,
      });
    }
  }

  const counts = { base: { PASS: 0, FAIL: 0 }, head: { PASS: 0, FAIL: 0 } };
  for (const item of cases) {
    counts[item.revision][item.gold.result] += 1;
  }

  if (counts.base.PASS === 0 && counts.base.FAIL > 0) {
    issues.push({
      severity: 'warning',
      code: 'REVISION_PREDICTS_LABEL',
      message: 'Every base-revision case is FAIL; the gold label is recoverable from the revision alone',
    });
  }
  if (counts.head.FAIL === 0 && counts.head.PASS > 0) {
    issues.push({
      severity: 'warning',
      code: 'REVISION_PREDICTS_LABEL',
      message: 'Every head-revision case is PASS; the gold label is recoverable from the revision alone',
    });
  }

  const passTotal = counts.base.PASS + counts.head.PASS;
  const failTotal = counts.base.FAIL + counts.head.FAIL;
  if (passTotal === 0 || failTotal === 0) {
    issues.push({
      severity: 'error',
      code: 'SINGLE_CLASS_DATASET',
      message: `Dataset contains only one class (PASS=${passTotal}, FAIL=${failTotal})`,
    });
  }

  return { issues, ok: issues.every((issue) => issue.severity !== 'error') };
};
