import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';

export interface LineReader {
  /** Next line, or null once input has ended. */
  next(): Promise<string | null>;
  close(): void;
}

/**
 * A line reader that buffers.
 *
 * `readline/promises`' `question()` only captures a line that arrives *after*
 * it is called. With piped input every line is emitted immediately, so all but
 * the first are discarded and the next question waits on a stream that has
 * already closed — the process then exits 0 having silently done nothing.
 * Queuing lines makes piped and interactive input behave the same, and makes
 * end-of-input an explicit null rather than a hang.
 */
export const createLineReader = (input: NodeJS.ReadableStream): LineReader => {
  const rl: Interface = createInterface({ input, terminal: false });
  const queued: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let ended = false;

  rl.on('line', (line) => {
    const waiter = waiting.shift();
    if (waiter === undefined) queued.push(line);
    else waiter(line);
  });

  rl.on('close', () => {
    ended = true;
    while (waiting.length > 0) waiting.shift()?.(null);
  });

  return {
    next: () => {
      const line = queued.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (ended) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
  };
};

/** Thrown when input ends mid-session so the caller can stop cleanly. */
export class InputEnded extends Error {
  constructor() {
    super('Input ended');
    this.name = 'InputEnded';
  }
}

export const ask = async (
  reader: LineReader,
  output: NodeJS.WritableStream,
  question: string,
): Promise<string> => {
  output.write(question);
  const line = await reader.next();
  if (line === null) {
    output.write('\n');
    throw new InputEnded();
  }
  /** Piped input gets no terminal echo, so echo it to keep the log readable. */
  output.write(`${line}\n`);
  return line.trim();
};
