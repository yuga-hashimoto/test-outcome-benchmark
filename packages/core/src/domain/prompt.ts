/**
 * A prompt is a versioned, hashed entity (spec §4). The user controls the
 * reasoning instructions; the benchmark appends the output contract, so every
 * response stays machine-scoreable regardless of what the user wrote.
 */
export interface Prompt {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly version: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromptDraft {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}
