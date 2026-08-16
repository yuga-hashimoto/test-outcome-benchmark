import { asc, eq } from 'drizzle-orm';
import { defaultInferenceSettings } from '@tob/core';
import { modelConfigs } from '../schema';
import { newId, nowIso } from '../ids';
import type { InferenceSettings, ModelConfiguration, ModelPricing, ProviderId } from '@tob/core';
import type { Db } from '../client';

const toModelConfig = (row: typeof modelConfigs.$inferSelect): ModelConfiguration => ({
  id: row.id,
  name: row.name,
  provider: row.provider as ProviderId,
  model: row.model,
  settings: row.settings,
  baseUrl: row.baseUrl,
  apiKeyEnvVar: row.apiKeyEnvVar,
  pricing: row.pricing ?? null,
  createdAt: row.createdAt,
});

export interface ModelConfigDraft {
  readonly name: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly settings?: Partial<InferenceSettings>;
  readonly baseUrl?: string | null;
  readonly apiKeyEnvVar?: string | null;
  readonly pricing?: ModelPricing | null;
}

export const createModelConfig = (db: Db, draft: ModelConfigDraft): ModelConfiguration => {
  const record = {
    id: newId('model'),
    name: draft.name,
    provider: draft.provider,
    model: draft.model,
    settings: { ...defaultInferenceSettings(), ...draft.settings },
    baseUrl: draft.baseUrl ?? null,
    apiKeyEnvVar: draft.apiKeyEnvVar ?? null,
    pricing: draft.pricing ?? null,
    createdAt: nowIso(),
  };
  db.insert(modelConfigs).values(record).run();
  return toModelConfig(record);
};

export const listModelConfigs = (db: Db): ModelConfiguration[] =>
  db.select().from(modelConfigs).orderBy(asc(modelConfigs.name)).all().map(toModelConfig);

export const getModelConfig = (db: Db, id: string): ModelConfiguration | null => {
  const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
  return row === undefined ? null : toModelConfig(row);
};

export const findModelConfigByName = (db: Db, name: string): ModelConfiguration | null => {
  const row = db.select().from(modelConfigs).where(eq(modelConfigs.name, name)).get();
  return row === undefined ? null : toModelConfig(row);
};
