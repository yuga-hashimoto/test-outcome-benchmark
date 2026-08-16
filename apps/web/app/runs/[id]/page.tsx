import { notFound } from 'next/navigation';
import {
  getRun,
  getRunMetrics,
  listRuns,
  listErroredCases,
  listFalsePassCases,
  listHighConfidenceMistakes,
} from '@tob/db';
import { CalibrationChart } from '@/components/CalibrationChart';
import { ConfusionMatrix } from '@/components/ConfusionMatrix';
import { Bar, Note, Stat, Verdict } from '@/components/Stat';
import { CaseTable } from '@/components/CaseTable';
import { db } from '@/lib/db';
import { count, intervalText, millis, money, percent, score, shortId } from '@/lib/format';

export const dynamic = 'force-static';

/** Pre-renders one page per run so the site can be exported statically. */
export function generateStaticParams(): { id: string }[] {
  return listRuns(db(), 500).map((run) => ({ id: run.id }));
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const handle = db();

  const run = getRun(handle, id);
  if (run === null) notFound();

  const metrics = getRunMetrics(handle, run.id);
  if (metrics === null) {
    return (
      <>
        <h1>{run.name}</h1>
        <Note>This run has no stored metrics yet. It is {run.status.toLowerCase()}.</Note>
      </>
    );
  }

  const falsePass = listFalsePassCases(handle, run.id);
  const confidentMistakes = listHighConfidenceMistakes(handle, run.id);
  const errored = listErroredCases(handle, run.id);

  const interestingSlices = metrics.slices.filter((slice) =>
    ['casePattern', 'revision', 'testType', 'language', 'specificity', 'ambiguity'].includes(
      slice.key,
    ),
  );

  return (
    <>
      <h1>{run.name}</h1>
      <p className="lede mono">
        {shortId(run.id)} · {run.snapshot.provider}/{run.snapshot.model} ·{' '}
        {run.snapshot.promptName} v{run.snapshot.promptVersion} ({run.snapshot.promptHash.slice(0, 10)}) ·{' '}
        dataset v{run.snapshot.datasetVersion} · {run.config.contextStrategy} ·{' '}
        {run.config.predictionMode} · {run.config.repetitions}× · seed {run.config.seed}
      </p>

      <div className="grid" style={{ marginTop: 18 }}>
        <Stat
          label="Accuracy"
          value={percent(metrics.accuracy)}
          note={
            intervalText(metrics.accuracyInterval.lower, metrics.accuracyInterval.upper) ??
            `${count(metrics.counts.correct)}/${count(metrics.counts.resolved)} resolved`
          }
        />
        <Stat
          label="Strict accuracy"
          value={percent(metrics.strictAccuracy)}
          note={`over ${count(metrics.counts.attempted)} attempts`}
        />
        <Stat
          label="FAIL recall"
          value={percent(metrics.classification.fail.recall)}
          note={`${count(metrics.counts.falsePass)} real failures predicted to pass`}
        />
        <Stat
          label="Flip pair accuracy"
          value={percent(metrics.flipPairs.accuracy)}
          note={`${count(metrics.flipPairs.bothCorrect)}/${count(metrics.flipPairs.evaluated)} pairs, both sides right`}
        />
      </div>

      {metrics.accuracyInterval.clusters > 0 && (
        <Note>
          The 95% interval comes from a bootstrap that resamples whole pull requests (
          {count(metrics.accuracyInterval.clusters)} of them), not individual predictions. Cases
          from one pull request share a diff and often share a failure mode, so treating them as
          independent would make the interval look tighter than the evidence supports.
        </Note>
      )}

      {metrics.counts.attempted !== metrics.counts.resolved && (
        <Note tone="warn">
          {count(metrics.counts.attempted - metrics.counts.resolved)} of{' '}
          {count(metrics.counts.attempted)} attempts produced no usable verdict:{' '}
          {count(metrics.counts.abstained)} abstained, {count(metrics.counts.contractViolations)}{' '}
          violated the output contract, {count(metrics.counts.infrastructureErrors)} failed
          in transport. Accuracy excludes them; strict accuracy counts them as wrong.
        </Note>
      )}

      <h2>Class performance</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th className="num">Precision</th>
              <th className="num">Recall</th>
              <th className="num">F1</th>
              <th className="num">Support</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PASS</td>
              <td className="num">{percent(metrics.classification.pass.precision)}</td>
              <td className="num">{percent(metrics.classification.pass.recall)}</td>
              <td className="num">{score(metrics.classification.pass.f1)}</td>
              <td className="num muted">{count(metrics.classification.pass.support)}</td>
            </tr>
            <tr>
              <td>FAIL</td>
              <td className="num">{percent(metrics.classification.fail.precision)}</td>
              <td className="num">{percent(metrics.classification.fail.recall)}</td>
              <td className="num">{score(metrics.classification.fail.f1)}</td>
              <td className="num muted">{count(metrics.classification.fail.support)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ marginTop: 12 }}>
        <Stat label="Macro F1" value={score(metrics.classification.macroF1)} />
        <Stat label="Balanced accuracy" value={percent(metrics.classification.balancedAccuracy)} />
        <Stat label="MCC" value={score(metrics.classification.mcc)} note="0 = no better than chance" />
      </div>

      <h2>Confusion matrix</h2>
      <ConfusionMatrix matrix={metrics.confusionMatrix} />

      <h2>Baselines</h2>
      <div className="grid">
        <Stat label="Always PASS" value={percent(metrics.baselines.alwaysPass.accuracy)} />
        <Stat label="Always FAIL" value={percent(metrics.baselines.alwaysFail.accuracy)} />
        <Stat label="Random" value={percent(metrics.baselines.random.accuracy)} />
        <Stat
          label={metrics.baselines.majorityClass.label}
          value={percent(metrics.baselines.majorityClass.accuracy)}
        />
      </div>
      <Note>
        Baselines are scored on exactly the items this run resolved, so abstaining on the hard
        cases cannot flatter the comparison.
      </Note>

      <h2>Confidence</h2>
      <div className="split">
        <div className="card">
          <h3>Calibration</h3>
          <CalibrationChart buckets={metrics.calibration.buckets} />
        </div>
        <div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Stat label="Brier score" value={score(metrics.calibration.brierScore)} note="lower is better" />
            <Stat
              label="Calibration error"
              value={score(metrics.calibration.expectedCalibrationError)}
              note={`${count(metrics.calibration.withConfidence)}/${count(metrics.calibration.resolvedTotal)} had a confidence`}
            />
          </div>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Threshold</th>
                  <th className="num">Coverage</th>
                  <th className="num">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {metrics.calibration.thresholds.map((point) => (
                  <tr key={point.threshold}>
                    <td>≥ {point.threshold.toFixed(2)}</td>
                    <td className="num">{percent(point.coverage)}</td>
                    <td className="num">{percent(point.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2>Safe skip analysis</h2>
      <p className="lede">
        If a confident PASS were used to skip running a test, how much work is saved and what gets
        through?
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Confidence</th>
              <th className="num">Tests skipped</th>
              <th className="num">Safe PASS accuracy</th>
              <th className="num">Missed failures</th>
            </tr>
          </thead>
          <tbody>
            {metrics.safeSkip.points.map((point) => (
              <tr key={point.threshold}>
                <td>≥ {point.threshold.toFixed(2)}</td>
                <td className="num">
                  {count(point.skipped)} <span className="muted">({percent(point.skipRate)})</span>
                </td>
                <td className="num">{percent(point.safePassAccuracy)}</td>
                <td className="num">
                  {point.missedFailures > 0 ? (
                    <span className="pill pill-fail">{count(point.missedFailures)}</span>
                  ) : (
                    <span className="muted">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Speed and cost</h2>
      <div className="grid">
        <Stat
          label="Latency p50"
          value={millis(metrics.latency.endToEnd.p50)}
          note={`p95 ${millis(metrics.latency.endToEnd.p95)} · p99 ${millis(metrics.latency.endToEnd.p99)}`}
        />
        <Stat
          label="Time to first token"
          value={millis(metrics.latency.timeToFirstToken.p50)}
          note={
            metrics.latency.timeToFirstToken.count === 0
              ? 'not observable: nothing was streamed'
              : `measured on ${count(metrics.latency.timeToFirstToken.count)} responses`
          }
        />
        <Stat
          label="Throughput"
          value={
            metrics.latency.testsPerMinute === null
              ? '—'
              : `${metrics.latency.testsPerMinute.toFixed(1)}/min`
          }
        />
        <Stat
          label="Cost per test"
          value={money(metrics.cost.costPerTest)}
          note={`${money(metrics.cost.totalUsd)} total · ${money(metrics.cost.costPer1000Tests)} per 1000`}
        />
      </div>

      <h2>Stability</h2>
      <div className="grid">
        <Stat
          label="Consistency"
          value={percent(metrics.stability.consistencyRate)}
          note={`across ${count(metrics.stability.repetitions)} repetitions`}
        />
        <Stat label="Flip rate" value={percent(metrics.stability.flipRate)} />
        <Stat label="Majority@N accuracy" value={percent(metrics.stability.majorityAccuracy)} />
        <Stat
          label="Per repetition"
          value={
            <span style={{ fontSize: 17 }}>
              {metrics.stability.perRepetitionAccuracy.map((value) => percent(value)).join(' · ')}
            </span>
          }
        />
      </div>

      {interestingSlices.length > 0 && (
        <>
          <h2>Slices</h2>
          <div className="split">
            {interestingSlices.map((slice) => (
              <div key={slice.key} className="card">
                <h3>{slice.key}</h3>
                <div className="table-scroll" style={{ border: 'none' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Value</th>
                        <th className="num">Accuracy</th>
                        <th className="num">n</th>
                        <th className="num">Gold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slice.buckets.map((bucket) => (
                        <tr key={bucket.value}>
                          <td>{bucket.value}</td>
                          <td className="num">
                            {percent(bucket.accuracy)} <Bar value={bucket.accuracy} />
                          </td>
                          <td className="num muted">{count(bucket.resolved)}</td>
                          <td className="num muted">
                            {bucket.goldPassCount}P / {bucket.goldFailCount}F
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Real failures predicted to pass ({count(falsePass.length)})</h2>
      <CaseTable details={falsePass} emptyMessage="No false PASS predictions in this run." />

      <h2>Confidently wrong ({count(confidentMistakes.length)})</h2>
      <CaseTable
        details={confidentMistakes}
        emptyMessage="No incorrect prediction was made at 0.80 confidence or above."
      />

      {errored.length > 0 && (
        <>
          <h2>Errors ({count(errored.length)})</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Kind</th>
                  <th>Code</th>
                  <th className="wrap">Message</th>
                  <th className="num">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {errored.slice(0, 40).map((detail) => (
                  <tr key={`${detail.prediction.caseId}-${detail.prediction.repetition}`}>
                    <td className="mono">{detail.prediction.caseId}</td>
                    <td>
                      <Verdict value={null} />{' '}
                      <span className="muted">{detail.prediction.error?.kind}</span>
                    </td>
                    <td className="muted">{detail.prediction.error?.code ?? '—'}</td>
                    <td className="wrap muted">{detail.prediction.error?.message}</td>
                    <td className="num muted">{detail.prediction.error?.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Prompt</h2>
      <pre>{run.snapshot.promptContent}</pre>
    </>
  );
}
