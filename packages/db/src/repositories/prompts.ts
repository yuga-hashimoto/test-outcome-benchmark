import { and, asc, desc, eq, max } from 'drizzle-orm';
import { hashPromptContent } from '@tob/core';
import { prompts } from '../schema';
import { newId, nowIso } from '../ids';
import type { Prompt, PromptDraft } from '@tob/core';
import type { Db } from '../client';

const toPrompt = (row: typeof prompts.$inferSelect): Prompt => ({
  id: row.id,
  name: row.name,
  description: row.description,
  content: row.content,
  version: row.version,
  contentHash: row.contentHash,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createPrompt = (db: Db, draft: PromptDraft): Prompt => {
  const timestamp = nowIso();
  const record = {
    id: newId('prompt'),
    familyId: newId('pf'),
    name: draft.name,
    description: draft.description,
    content: draft.content,
    version: 1,
    contentHash: hashPromptContent(draft.content),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.insert(prompts).values(record).run();
  return toPrompt(record);
};

/**
 * Editing a prompt appends a version instead of mutating the row. A run's
 * snapshot names a specific version, so old runs keep pointing at the text they
 * were actually scored with.
 */
export const revisePrompt = (db: Db, promptId: string, draft: Partial<PromptDraft>): Prompt => {
  const current = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
  if (current === undefined) throw new Error(`Unknown prompt ${promptId}`);

  const highest = db
    .select({ value: max(prompts.version) })
    .from(prompts)
    .where(eq(prompts.familyId, current.familyId))
    .get();

  const content = draft.content ?? current.content;
  const record = {
    id: newId('prompt'),
    familyId: current.familyId,
    name: draft.name ?? current.name,
    description: draft.description ?? current.description,
    content,
    version: (highest?.value ?? current.version) + 1,
    contentHash: hashPromptContent(content),
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  db.insert(prompts).values(record).run();
  return toPrompt(record);
};

/** A clone starts a new family, so its versions advance independently. */
export const clonePrompt = (db: Db, promptId: string, name: string): Prompt => {
  const source = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
  if (source === undefined) throw new Error(`Unknown prompt ${promptId}`);

  return createPrompt(db, {
    name,
    description: source.description,
    content: source.content,
  });
};

/** Only the newest version of each family, which is what selection UIs want. */
export const listPrompts = (db: Db): Prompt[] => {
  const rows = db.select().from(prompts).orderBy(desc(prompts.version)).all();
  const newest = new Map<string, typeof prompts.$inferSelect>();
  for (const row of rows) {
    if (!newest.has(row.familyId)) newest.set(row.familyId, row);
  }
  return [...newest.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(toPrompt);
};

export const listPromptVersions = (db: Db, familyId: string): Prompt[] =>
  db
    .select()
    .from(prompts)
    .where(eq(prompts.familyId, familyId))
    .orderBy(asc(prompts.version))
    .all()
    .map(toPrompt);

export const getPrompt = (db: Db, id: string): Prompt | null => {
  const row = db.select().from(prompts).where(eq(prompts.id, id)).get();
  return row === undefined ? null : toPrompt(row);
};

export const findPromptByName = (db: Db, name: string): Prompt | null => {
  const row = db
    .select()
    .from(prompts)
    .where(eq(prompts.name, name))
    .orderBy(desc(prompts.version))
    .get();
  return row === undefined ? null : toPrompt(row);
};

export const findPromptByHash = (db: Db, contentHash: string): Prompt | null => {
  const row = db
    .select()
    .from(prompts)
    .where(and(eq(prompts.contentHash, contentHash)))
    .get();
  return row === undefined ? null : toPrompt(row);
};
