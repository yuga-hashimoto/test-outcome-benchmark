import { asc, eq } from 'drizzle-orm';
import { humanResponses, humanSessions } from '../schema';
import { newId, nowIso } from '../ids';
import type { HumanResponse, HumanSession, Verdict } from '@tob/core';
import type { Db } from '../client';

const toSession = (row: typeof humanSessions.$inferSelect): HumanSession => ({
  id: row.id,
  datasetVersionId: row.datasetVersionId,
  participantLabel: row.participantLabel,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

const toResponse = (row: typeof humanResponses.$inferSelect): HumanResponse => ({
  id: row.id,
  sessionId: row.sessionId,
  participantLabel: row.participantLabel,
  caseId: row.caseId,
  contextStrategy: row.contextStrategy,
  verdict: row.verdict,
  confidence: row.confidence,
  timeSpentMs: row.timeSpentMs,
  notes: row.notes,
  createdAt: row.createdAt,
});

export const startHumanSession = (
  db: Db,
  input: { datasetVersionId: string; participantLabel: string },
): HumanSession => {
  const record = {
    id: newId('hs'),
    datasetVersionId: input.datasetVersionId,
    participantLabel: input.participantLabel,
    startedAt: nowIso(),
    finishedAt: null,
  };
  db.insert(humanSessions).values(record).run();
  return toSession(record);
};

export const finishHumanSession = (db: Db, sessionId: string): void => {
  db.update(humanSessions)
    .set({ finishedAt: nowIso() })
    .where(eq(humanSessions.id, sessionId))
    .run();
};

export interface HumanAnswerInput {
  readonly sessionId: string;
  readonly participantLabel: string;
  readonly caseId: string;
  readonly contextStrategy: string;
  readonly verdict: Verdict;
  readonly confidence: number | null;
  readonly timeSpentMs: number;
  readonly notes?: string;
}

export const recordHumanResponse = (db: Db, input: HumanAnswerInput): void => {
  db.insert(humanResponses)
    .values({
      id: newId('hr'),
      sessionId: input.sessionId,
      participantLabel: input.participantLabel,
      caseId: input.caseId,
      contextStrategy: input.contextStrategy,
      verdict: input.verdict,
      confidence: input.confidence,
      timeSpentMs: input.timeSpentMs,
      notes: input.notes ?? '',
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .run();
};

export const listHumanResponses = (db: Db, sessionId: string): HumanResponse[] =>
  db
    .select()
    .from(humanResponses)
    .where(eq(humanResponses.sessionId, sessionId))
    .orderBy(asc(humanResponses.caseId))
    .all()
    .map(toResponse);

export const listHumanSessions = (db: Db): HumanSession[] =>
  db.select().from(humanSessions).orderBy(asc(humanSessions.startedAt)).all().map(toSession);
