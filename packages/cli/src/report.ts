import { count, heading, interval, millis, money, percent, score, table } from './format';
import type { RunMetrics } from '@tob/core';

const confusionTable = (metrics: RunMetrics): string =>
  table([
    ['', 'predicted PASS', 'predicted FAIL'],
    [
      'gold PASS',
      count(metrics.confusionMatrix.goldPassPredictedPass),
      count(metrics.confusionMatrix.goldPassPredictedFail),
    ],
    [
      'gold FAIL',
      count(metrics.confusionMatrix.goldFailPredictedPass),
      count(metrics.confusionMatrix.goldFailPredictedFail),
    ],
  ]);

/**
 * Prints the scorecard in the priority order from spec §15: accuracy first,
 * then class performance, speed and cost, calibration, stability, and the
 * deeper analyses.
 */
export const renderRunReport = (metrics: RunMetrics, title: string): string => {
  const lines: string[] = [];

  lines.push(heading(title));
  lines.push(
    table([
      [
        'Accuracy',
        interval(
          metrics.accuracy,
          metrics.accuracyInterval.lower,
          metrics.accuracyInterval.upper,
        ),
        `${count(metrics.counts.correct)}/${count(metrics.counts.resolved)} resolved`,
      ],
      [
        'Strict accuracy',
        percent(metrics.strictAccuracy),
        `over ${count(metrics.counts.attempted)} attempts`,
      ],
      [
        'Unresolved',
        count(metrics.counts.attempted - metrics.counts.resolved),
        `${count(metrics.counts.abstained)} abstained, ${count(metrics.counts.contractViolations)} malformed, ${count(metrics.counts.infrastructureErrors)} errored`,
      ],
    ]),
  );

  if (metrics.accuracyInterval.clusters > 0) {
    lines.push(
      `\n95% interval from a cluster bootstrap over ${count(metrics.accuracyInterval.clusters)} pull requests.`,
    );
  }

  lines.push(heading('Class performance'));
  lines.push(
    table([
      ['', 'precision', 'recall', 'F1', 'support'],
      [
        'PASS',
        percent(metrics.classification.pass.precision),
        percent(metrics.classification.pass.recall),
        score(metrics.classification.pass.f1),
        count(metrics.classification.pass.support),
      ],
      [
        'FAIL',
        percent(metrics.classification.fail.precision),
        percent(metrics.classification.fail.recall),
        score(metrics.classification.fail.f1),
        count(metrics.classification.fail.support),
      ],
    ]),
  );
  lines.push(
    `\nMacro F1 ${score(metrics.classification.macroF1)}   Balanced accuracy ${percent(metrics.classification.balancedAccuracy)}   MCC ${score(metrics.classification.mcc)}`,
  );
  lines.push(`False PASS (real failures predicted to pass): ${count(metrics.counts.falsePass)}`);

  lines.push(heading('Confusion matrix'));
  lines.push(confusionTable(metrics));

  lines.push(heading('Baselines'));
  lines.push(
    table([
      ['Always PASS', percent(metrics.baselines.alwaysPass.accuracy)],
      ['Always FAIL', percent(metrics.baselines.alwaysFail.accuracy)],
      ['Random', percent(metrics.baselines.random.accuracy)],
      [metrics.baselines.majorityClass.label, percent(metrics.baselines.majorityClass.accuracy)],
    ]),
  );

  lines.push(heading('Speed'));
  lines.push(
    table([
      [
        'End to end',
        `p50 ${millis(metrics.latency.endToEnd.p50)}`,
        `p95 ${millis(metrics.latency.endToEnd.p95)}`,
        `p99 ${millis(metrics.latency.endToEnd.p99)}`,
        `n=${count(metrics.latency.endToEnd.count)}`,
      ],
      [
        'Time to first token',
        `p50 ${millis(metrics.latency.timeToFirstToken.p50)}`,
        `p95 ${millis(metrics.latency.timeToFirstToken.p95)}`,
        '',
        `n=${count(metrics.latency.timeToFirstToken.count)}`,
      ],
      [
        'Throughput',
        metrics.latency.testsPerMinute === null
          ? '—'
          : `${metrics.latency.testsPerMinute.toFixed(1)} tests/min`,
        '',
        '',
        '',
      ],
    ]),
  );

  if (metrics.latency.endToEnd.count === 0) {
    lines.push(
      '\nNo timing was recorded for this run. Imported runs carry no per-request timing, so speed cannot be compared against runs this benchmark executed.',
    );
  } else if (metrics.latency.timeToFirstToken.count === 0) {
    lines.push('\nTime to first token was not observable: no response was streamed.');
  }

  lines.push(heading('Cost'));
  lines.push(
    table([
      ['Total', money(metrics.cost.totalUsd)],
      ['Per test', money(metrics.cost.costPerTest)],
      ['Per 1000 tests', money(metrics.cost.costPer1000Tests)],
      [
        'Correct per dollar',
        metrics.cost.correctPerDollar === null
          ? '—'
          : metrics.cost.correctPerDollar.toFixed(1),
      ],
      [
        'Tokens',
        `${count(metrics.cost.tokens.inputTokens)} in / ${count(metrics.cost.tokens.outputTokens)} out`,
      ],
    ]),
  );

  lines.push(heading('Confidence'));
  lines.push(
    table([
      ['Brier score', score(metrics.calibration.brierScore)],
      ['Expected calibration error', score(metrics.calibration.expectedCalibrationError)],
      [
        'With confidence',
        `${count(metrics.calibration.withConfidence)}/${count(metrics.calibration.resolvedTotal)} resolved`,
      ],
    ]),
  );
  lines.push('');
  lines.push(
    table([
      ['threshold', 'coverage', 'accuracy'],
      ...metrics.calibration.thresholds.map((point) => [
        `≥ ${point.threshold.toFixed(2)}`,
        percent(point.coverage),
        percent(point.accuracy),
      ]),
    ]),
  );

  lines.push(heading('Stability'));
  lines.push(
    table([
      ['Repetitions', count(metrics.stability.repetitions)],
      ['Consistency rate', percent(metrics.stability.consistencyRate)],
      ['Flip rate', percent(metrics.stability.flipRate)],
      ['Majority@N accuracy', percent(metrics.stability.majorityAccuracy)],
      [
        'Per repetition',
        metrics.stability.perRepetitionAccuracy.map((value) => percent(value)).join('  '),
      ],
    ]),
  );

  lines.push(heading('Flip pairs'));
  if (metrics.flipPairs.pairs === 0) {
    lines.push('No flip pairs in this dataset.');
  } else {
    lines.push(
      table([
        ['Pairs', count(metrics.flipPairs.pairs)],
        [
          'Both sides correct',
          `${count(metrics.flipPairs.bothCorrect)}/${count(metrics.flipPairs.evaluated)}`,
        ],
        ['Flip pair accuracy', percent(metrics.flipPairs.accuracy)],
      ]),
    );
  }

  lines.push(heading('Safe skip analysis'));
  lines.push(
    table([
      ['threshold', 'skipped', 'safe PASS accuracy', 'missed failures'],
      ...metrics.safeSkip.points.map((point) => [
        `≥ ${point.threshold.toFixed(2)}`,
        `${count(point.skipped)} (${percent(point.skipRate)})`,
        percent(point.safePassAccuracy),
        count(point.missedFailures),
      ]),
    ]),
  );

  const interestingSlices = metrics.slices.filter((slice) =>
    ['casePattern', 'revision', 'testType', 'language'].includes(slice.key),
  );

  if (interestingSlices.length > 0) {
    lines.push(heading('Slices'));
    for (const slice of interestingSlices) {
      lines.push(`\n${slice.key}`);
      lines.push(
        table(
          slice.buckets.map((bucket) => [
            `  ${bucket.value}`,
            percent(bucket.accuracy),
            `n=${count(bucket.resolved)}`,
            `${count(bucket.goldPassCount)} PASS / ${count(bucket.goldFailCount)} FAIL`,
          ]),
        ),
      );
    }
  }

  return lines.join('\n');
};
