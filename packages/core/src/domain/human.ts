import type { Verdict } from './verdict';

/**
 * A human answering the same question as the model, on the same input, so the
 * benchmark can eventually report the human number next to the model numbers
 * (spec §19).
 */
export interface HumanResponse {
  readonly id: string;
  readonly sessionId: string;
  readonly participantLabel: string;
  readonly caseId: string;
  readonly contextStrategy: string;
  readonly verdict: Verdict;
  readonly confidence: number | null;
  readonly timeSpentMs: number;
  readonly notes: string;
  readonly createdAt: string;
}

export interface HumanSession {
  readonly id: string;
  readonly datasetVersionId: string;
  readonly participantLabel: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}
