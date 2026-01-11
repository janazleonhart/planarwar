// worldcore/test/testUtils.ts

/**
 * Temporarily overrides Math.random() with a deterministic sequence.
 * - Values should be in [0, 1).
 * - If the sequence runs out, it repeats the last value (or 0.5 if empty).
 */
export function withRandomSequence<T>(seq: number[], fn: () => T): T {
  const orig = Math.random;
  let i = 0;

  (Math as any).random = () => {
    const last = seq.length ? seq[seq.length - 1] : 0.5;
    const v = seq[i] ?? last;
    i++;
    return v;
  };

  try {
    return fn();
  } finally {
    (Math as any).random = orig;
  }
}

/** Async-friendly version for tests that await. */
export async function withRandomSequenceAsync<T>(
  seq: number[],
  fn: () => Promise<T>,
): Promise<T> {
  const orig = Math.random;
  let i = 0;

  (Math as any).random = () => {
    const last = seq.length ? seq[seq.length - 1] : 0.5;
    const v = seq[i] ?? last;
    i++;
    return v;
  };

  try {
    return await fn();
  } finally {
    (Math as any).random = orig;
  }
}
