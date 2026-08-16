import { checkDatasetIntegrity } from '@tob/core';
import { latestVersion, listCases, listDatasets, listVersions } from '@tob/db';
import { Empty, Note, Stat } from '@/components/Stat';
import { db } from '@/lib/db';
import { count, percent } from '@/lib/format';
import type { BenchmarkCase } from '@tob/core';

export const dynamic = 'force-dynamic';

const tally = <K extends string>(
  cases: readonly BenchmarkCase[],
  key: (item: BenchmarkCase) => K,
): [K, number][] => {
  const counts = new Map<K, number>();
  for (const item of cases) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([, a], [, b]) => b - a);
};

export default function DatasetsPage() {
  const handle = db();
  const datasets = listDatasets(handle);

  if (datasets.length === 0) {
    return (
      <>
        <h1>Dataset</h1>
        <Empty>No datasets yet. Run `pnpm seed`.</Empty>
      </>
    );
  }

  return (
    <>
      <h1>Dataset</h1>
      <p className="lede">
        Natural-language test cases over real merged pull requests. Versions are immutable: editing
        or re-importing produces a new version, so a finished run always resolves to the exact cases
        it was scored against.
      </p>

      {datasets.map((dataset) => {
        const versions = listVersions(handle, dataset.id);
        const newest = latestVersion(handle, dataset.id);
        const cases = newest === null ? [] : listCases(handle, newest.id);
        const report = checkDatasetIntegrity(cases);

        const passCount = cases.filter((item) => item.gold.result === 'PASS').length;
        const headFail = cases.filter(
          (item) => item.revision === 'head' && item.gold.result === 'FAIL',
        ).length;
        const basePass = cases.filter(
          (item) => item.revision === 'base' && item.gold.result === 'PASS',
        ).length;

        return (
          <section key={dataset.id}>
            <h2>
              {dataset.name} <span className="muted">v{newest?.version ?? '—'}</span>
            </h2>

            <div className="grid">
              <Stat label="Cases" value={count(cases.length)} note={`${versions.length} version${versions.length === 1 ? '' : 's'}`} />
              <Stat
                label="Repositories"
                value={count(new Set(cases.map((item) => item.pr.repository)).size)}
                note={`${new Set(cases.map((item) => item.pr.language)).size} languages`}
              />
              <Stat
                label="Gold PASS"
                value={percent(cases.length === 0 ? null : passCount / cases.length)}
                note={`${count(passCount)} PASS · ${count(cases.length - passCount)} FAIL`}
              />
              <Stat
                label="Flip pairs"
                value={count(
                  new Set(
                    cases.filter((item) => item.flipPairId !== null).map((item) => item.flipPairId),
                  ).size,
                )}
                note="same test, outcome flips across a change"
              />
            </div>

            <Note>
              The gold label must not be recoverable from the revision alone. This version has{' '}
              {count(basePass)} PASS cases at the base revision and {count(headFail)} FAIL cases at
              the head revision, so neither side of a change carries a single answer.
            </Note>

            {report.issues.length > 0 && (
              <Note tone="warn">
                {report.issues.map((issue) => `${issue.code}: ${issue.message}`).join(' · ')}
              </Note>
            )}

            <div className="split">
              {(
                [
                  ['Case pattern', tally(cases, (item) => item.metadata.casePattern)],
                  ['Test type', tally(cases, (item) => item.metadata.testType)],
                  ['Language', tally(cases, (item) => item.pr.language ?? 'unknown')],
                  ['Split', tally(cases, () => 'test')],
                ] as const
              )
                .slice(0, 3)
                .map(([title, rows]) => (
                  <div key={title} className="card">
                    <h3>{title}</h3>
                    <div className="table-scroll" style={{ border: 'none' }}>
                      <table>
                        <tbody>
                          {rows.map(([value, total]) => (
                            <tr key={value}>
                              <td>{value}</td>
                              <td className="num muted">{count(total)}</td>
                              <td className="num muted">
                                {percent(cases.length === 0 ? null : total / cases.length, 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>

            <h3 style={{ marginTop: 24 }}>Versions</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th className="num">Cases</th>
                    <th>Content hash</th>
                    <th>Frozen</th>
                    <th className="wrap">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td>v{version.version}</td>
                      <td className="num">{count(version.caseCount)}</td>
                      <td className="mono muted">{version.contentHash.slice(0, 16)}</td>
                      <td className="muted">{version.frozenAt.slice(0, 10)}</td>
                      <td className="wrap muted">{version.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
