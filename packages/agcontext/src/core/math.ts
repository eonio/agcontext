/**
 * Normalization primitives (phase 10 strategy):
 *
 * - Query-dependent signals (BM25, cosine, graph propagation) are min-max
 *   normalized *within the candidate set*, because their absolute scales are
 *   query-specific and only relative order matters.
 * - Corpus-level signals (centrality, fan-in, git activity, usage) are heavily
 *   right-skewed, so they are log-scaled first and min-max normalized *across
 *   the corpus* at index time.
 * - Time decays use an exponential half-life, mapping age directly to [0, 1].
 *
 * Degenerate distributions (all values equal) normalize to 0.5 so a uniform
 * signal neither boosts nor buries anything.
 */

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Returns a function mapping values to [0, 1] by min-max over `values`. */
export function minMaxScaler(values: readonly number[]): (value: number) => number {
  if (values.length === 0) return () => 0.5;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-12) {
    return () => 0.5;
  }
  const span = max - min;
  return (value: number) => clamp01((value - min) / span);
}

/** Min-max over log1p-scaled values; the right tool for skewed count data. */
export function logMinMaxScaler(values: readonly number[]): (value: number) => number {
  const scaled = values.map((v) => Math.log1p(Math.max(0, v)));
  const inner = minMaxScaler(scaled);
  return (value: number) => inner(Math.log1p(Math.max(0, value)));
}

/** Exponential half-life decay: `age = halfLife` → 0.5, `age = 0` → 1. */
export function halfLifeDecay(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  if (halfLifeMs <= 0) return 0;
  return clamp01(2 ** (-ageMs / halfLifeMs));
}
