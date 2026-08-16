import { and, asc, desc, eq, max } from 'drizzle-orm';
import { checkDatasetIntegrity, hashCaseIds } from '@tob/core';
import { cases, datasetVersions, datasets } from '../schema';
import { newId, nowIso } from '../ids';
import type { BenchmarkCase, BenchmarkDataset, DatasetVersion, Split } from '@tob/core';
import type { Db } from '../client';

const toDataset = (row: typeof datasets.$inferSelect): BenchmarkDataset => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
});

const toVersion = (row: typeof datasetVersions.$inferSelect): DatasetVersion => ({
  id: row.id,
  datasetId: row.datasetId,
  version: row.version,
  caseCount: row.caseCount,
  contentHash: row.contentHash,
  frozenAt: row.frozenAt,
  notes: row.notes,
});

const toCase = (row: typeof cases.$inferSelect): BenchmarkCase => ({
  id: row.caseId,
  revision: row.revision,
  flipPairId: row.flipPairId,
  pr: row.pr,
  testCase: row.testCase,
  gold: { result: row.goldResult },
  metadata: row.metadata,
});

export const createDataset = (
  db: Db,
  input: { name: string; description?: string },
): BenchmarkDataset => {
  const record = {
    id: newId('ds'),
    name: input.name,
    description: input.description ?? '',
    createdAt: nowIso(),
  };
  db.insert(datasets).values(record).run();
  return toDataset(record);
};

export const listDatasets = (db: Db): BenchmarkDataset[] =>
  db.select().from(datasets).orderBy(asc(datasets.name)).all().map(toDataset);

export const findDatasetByName = (db: Db, name: string): BenchmarkDataset | null => {
  const row = db.select().from(datasets).where(eq(datasets.name, name)).get();
  return row === undefined ? null : toDataset(row);
};

export const getDataset = (db: Db, id: string): BenchmarkDataset | null => {
  const row = db.select().from(datasets).where(eq(datasets.id, id)).get();
  return row === undefined ? null : toDataset(row);
};

export interface FreezeVersionInput {
  readonly datasetId: string;
  readonly cases: readonly BenchmarkCase[];
  readonly notes?: string;
  readonly splits?: Readonly<Record<string, Split>>;
}

export class DatasetIntegrityError extends Error {
  readonly issues: readonly { code: string; message: string }[];

  constructor(issues: readonly { code: string; message: string }[]) {
    super(`Dataset failed integrity checks: ${issues.map((issue) => issue.code).join(', ')}`);
    this.name = 'DatasetIntegrityError';
    this.issues = issues;
  }
}

/**
 * Freezes a set of cases as a new immutable version.
 *
 * Cases are copied into the version rather than referenced, so editing or
 * re-importing later cannot change what an existing run was scored against.
 * Integrity errors block the freeze; warnings are returned for the caller to
 * surface, because a warning describes a dataset that is usable but worth
 * knowing about.
 */
export const freezeDatasetVersion = (
  db: Db,
  input: FreezeVersionInput,
): { version: DatasetVersion; warnings: readonly { code: string; message: string }[] } => {
  const report = checkDatasetIntegrity(input.cases);
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new DatasetIntegrityError(errors);

  const previous = db
    .select({ value: max(datasetVersions.version) })
    .from(datasetVersions)
    .where(eq(datasetVersions.datasetId, input.datasetId))
    .get();

  const version: DatasetVersion = {
    id: newId('dv'),
    datasetId: input.datasetId,
    version: (previous?.value ?? 0) + 1,
    caseCount: input.cases.length,
    contentHash: hashCaseIds(input.cases.map((item) => item.id)),
    frozenAt: nowIso(),
    notes: input.notes ?? '',
  };

  db.transaction((tx) => {
    tx.insert(datasetVersions).values(version).run();
    for (const item of input.cases) {
      tx.insert(cases)
        .values({
          id: newId('case'),
          datasetVersionId: version.id,
          caseId: item.id,
          revision: item.revision,
          flipPairId: item.flipPairId,
          split: input.splits?.[item.id] ?? 'test',
          goldResult: item.gold.result,
          repository: item.pr.repository,
          prNumber: item.pr.number,
          testType: item.metadata.testType,
          casePattern: item.metadata.casePattern,
          pr: item.pr,
          testCase: item.testCase,
          metadata: item.metadata,
        })
        .run();
    }
  });

  return {
    version,
    warnings: report.issues.filter((issue) => issue.severity === 'warning'),
  };
};

export const listVersions = (db: Db, datasetId: string): DatasetVersion[] =>
  db
    .select()
    .from(datasetVersions)
    .where(eq(datasetVersions.datasetId, datasetId))
    .orderBy(desc(datasetVersions.version))
    .all()
    .map(toVersion);

export const getVersion = (db: Db, versionId: string): DatasetVersion | null => {
  const row = db.select().from(datasetVersions).where(eq(datasetVersions.id, versionId)).get();
  return row === undefined ? null : toVersion(row);
};

export const latestVersion = (db: Db, datasetId: string): DatasetVersion | null =>
  listVersions(db, datasetId)[0] ?? null;

export const listCases = (db: Db, versionId: string, split?: Split | null): BenchmarkCase[] => {
  const condition =
    split === undefined || split === null
      ? eq(cases.datasetVersionId, versionId)
      : and(eq(cases.datasetVersionId, versionId), eq(cases.split, split));

  return db.select().from(cases).where(condition).orderBy(asc(cases.caseId)).all().map(toCase);
};
