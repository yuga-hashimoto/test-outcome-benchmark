import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkDatasetIntegrity, clusterIdOf, hashString, parseBenchmarkCases } from '@tob/core';
import {
  createDataset,
  createModelConfig,
  createPrompt,
  findDatasetByName,
  findModelConfigByName,
  findPromptByName,
  freezeDatasetVersion,
  latestVersion,
} from '@tob/db';
import { SEED_PROMPTS } from './prompts-seed';
import type { BenchmarkCase, ModelPricing, Split } from '@tob/core';
import type { Db } from '@tob/db';

export const DEFAULT_DATASET_NAME = 'test-outcome-v1';

/**
 * Cases from one pull request always land in the same split. Splitting mid-PR
 * would put near-duplicate context on both sides of the divide.
 */
const splitFor = (benchmarkCase: BenchmarkCase): Split =>
  hashString(clusterIdOf(benchmarkCase)) % 5 === 0 ? 'dev' : 'test';

const MOCK_PRICING: ModelPricing = {
  currency: 'USD',
  inputPerMillion: 0.5,
  outputPerMillion: 1.5,
  cachedInputPerMillion: 0.05,
  reasoningPerMillion: null,
  source: 'synthetic pricing for the deterministic mock provider',
  snapshotAt: '2026-08-16T00:00:00.000Z',
};

const SEED_MODELS = [
  { name: 'mock-lean', model: 'mock-lean', description: 'Fast and noisy.' },
  { name: 'mock-thorough', model: 'mock-thorough', description: 'Slower, steadier, better calibrated.' },
  { name: 'mock-overconfident', model: 'mock-overconfident', description: 'Confident well beyond its accuracy.' },
  { name: 'mock-cautious', model: 'mock-cautious', description: 'Abstains when unsure.' },
] as const;

export const loadCaseFiles = (directory: string): BenchmarkCase[] => {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const cases: BenchmarkCase[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    cases.push(...parseBenchmarkCases(raw));
  }
  return cases;
};

export interface SeedResult {
  readonly datasetName: string;
  readonly datasetVersion: number;
  readonly caseCount: number;
  readonly repositories: number;
  readonly promptsCreated: number;
  readonly modelsCreated: number;
  readonly warnings: readonly { code: string; message: string }[];
  readonly skipped: boolean;
}

export interface SeedOptions {
  readonly dataDirectory?: string;
  readonly datasetName?: string;
  /** Freeze a new version even if one already exists. */
  readonly force?: boolean;
}

export const seedDatabase = (db: Db, options: SeedOptions = {}): SeedResult => {
  const directory = options.dataDirectory ?? 'data/oss';
  const datasetName = options.datasetName ?? DEFAULT_DATASET_NAME;

  const cases = loadCaseFiles(directory);
  const report = checkDatasetIntegrity(cases);

  const dataset =
    findDatasetByName(db, datasetName) ??
    createDataset(db, {
      name: datasetName,
      description:
        'Natural-language test cases over real merged pull requests from public repositories.',
    });

  const existing = latestVersion(db, dataset.id);
  let version = existing;
  let skipped = false;

  if (existing === null || options.force === true) {
    const splits: Record<string, Split> = {};
    for (const item of cases) splits[item.id] = splitFor(item);

    const frozen = freezeDatasetVersion(db, {
      datasetId: dataset.id,
      cases,
      splits,
      notes: `Imported from ${directory}`,
    });
    version = frozen.version;
  } else {
    skipped = true;
  }

  let promptsCreated = 0;
  for (const draft of SEED_PROMPTS) {
    if (findPromptByName(db, draft.name) !== null) continue;
    createPrompt(db, draft);
    promptsCreated += 1;
  }

  let modelsCreated = 0;
  for (const seed of SEED_MODELS) {
    if (findModelConfigByName(db, seed.name) !== null) continue;
    createModelConfig(db, {
      name: seed.name,
      provider: 'mock',
      model: seed.model,
      settings: { temperature: 0, stream: true },
      pricing: MOCK_PRICING,
    });
    modelsCreated += 1;
  }

  return {
    datasetName,
    datasetVersion: version?.version ?? 0,
    caseCount: version?.caseCount ?? cases.length,
    repositories: new Set(cases.map((item) => item.pr.repository)).size,
    promptsCreated,
    modelsCreated,
    warnings: report.issues.filter((issue) => issue.severity === 'warning'),
    skipped,
  };
};
