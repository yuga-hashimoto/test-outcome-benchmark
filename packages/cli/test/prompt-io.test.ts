import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { InputEnded, ask, createLineReader } from '@tob/cli/commands/prompt-io';

const streamOf = (text: string): Readable => Readable.from([text]);

const sink = () => {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  return { stream, written };
};

describe('line reader', () => {
  /**
   * The bug this replaces: readline's `question()` only captures a line that
   * arrives after it is called. Piped input emits every line immediately, so
   * all but the first were dropped and the command silently recorded nothing.
   */
  it('keeps every line when the whole input arrives at once', async () => {
    const reader = createLineReader(streamOf('first\nsecond\nthird\n'));

    expect(await reader.next()).toBe('first');
    expect(await reader.next()).toBe('second');
    expect(await reader.next()).toBe('third');

    reader.close();
  });

  it('reports end of input as null rather than hanging', async () => {
    const reader = createLineReader(streamOf('only\n'));

    expect(await reader.next()).toBe('only');
    expect(await reader.next()).toBeNull();
    expect(await reader.next()).toBeNull();

    reader.close();
  });

  it('resolves a pending read when input ends', async () => {
    const reader = createLineReader(streamOf(''));
    await expect(reader.next()).resolves.toBeNull();
    reader.close();
  });
});

describe('ask', () => {
  it('writes the prompt and returns the trimmed answer', async () => {
    const reader = createLineReader(streamOf('  yes  \n'));
    const output = sink();

    const answer = await ask(reader, output.stream, 'Continue? ');

    expect(answer).toBe('yes');
    expect(output.written.join('')).toContain('Continue? ');
    reader.close();
  });

  it('echoes the answer so a piped transcript stays readable', async () => {
    const reader = createLineReader(streamOf('p\n'));
    const output = sink();

    await ask(reader, output.stream, 'PASS or FAIL? ');

    expect(output.written.join('')).toContain('p\n');
    reader.close();
  });

  it('raises InputEnded when input runs out mid-question', async () => {
    const reader = createLineReader(streamOf('one\n'));
    const output = sink();

    await ask(reader, output.stream, 'first: ');
    await expect(ask(reader, output.stream, 'second: ')).rejects.toBeInstanceOf(InputEnded);

    reader.close();
  });
});
