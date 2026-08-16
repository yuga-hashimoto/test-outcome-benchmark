/**
 * Bounded parallelism without a dependency.
 *
 * Tasks are started as slots free up rather than in fixed batches, so one slow
 * request cannot stall the whole batch behind it.
 */
export const createLimiter = (concurrency: number) => {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: (() => void)[] = [];

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next !== undefined) next();
  };

  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
};

export type Limiter = ReturnType<typeof createLimiter>;
