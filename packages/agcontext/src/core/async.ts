/** Minimal concurrency primitives — no external dependencies. */

export type LimitFn = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Returns a limiter that runs at most `concurrency` tasks at once,
 * preserving submission order for task starts.
 */
export function pLimit(concurrency: number): LimitFn {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    active--;
    const run = queue.shift();
    if (run) run();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        task().then(
          (value) => {
            resolve(value);
            next();
          },
          (error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)));
            next();
          },
        );
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/** Maps `items` through `fn` with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))));
}
