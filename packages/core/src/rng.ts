/**
 * Seeded pseudo-randomness. Every stochastic part of the benchmark — the random
 * baseline, bootstrap resampling, the mock provider — draws from here, so a run
 * and its confidence intervals reproduce exactly.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** FNV-1a, used to fold a string seed into 32 bits. */
export const hashString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const createRng = (seed: number | string): Rng => {
  let state = (typeof seed === 'number' ? seed >>> 0 : hashString(seed)) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive: number): number => Math.floor(next() * maxExclusive),
  };
};
