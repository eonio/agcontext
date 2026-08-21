import { clamp01 } from "../core/math.js";
import type { Candidate } from "../core/types.js";

export interface RankerOptions {
  mode: "weighted" | "rrf";
  /** Relative signal weights (built-in {@link SignalName}s plus plugin signals). */
  weights: Record<string, number>;
  /** Reciprocal-rank-fusion constant. Default: 60. */
  rrfK?: number;
}

/** Signals whose raw scale is query-specific and needs candidate-set normalization. */
const QUERY_SIGNALS = ["lexical", "semantic", "graph"] as const;

/**
 * Multi-signal ranking engine (phase 10).
 *
 * Normalization strategy:
 * - Query-dependent signals (BM25 score, cosine similarity, graph
 *   propagation) are min-max normalized **within the candidate set** — their
 *   absolute scales vary per query, only relative order is meaningful. A
 *   degenerate distribution (all present values equal) maps to 1.0: matching
 *   at all is the information.
 * - Corpus signals (centrality, importance, activity, recency, dependency,
 *   usage) arrive already normalized to [0, 1] at index time (log-scaled
 *   min-max across the corpus) and pass through.
 * - Weights are renormalized over the signals actually available for this
 *   query, so a repo without git history or embeddings is not penalized.
 *
 * Final score (weighted mode):
 *
 * ```
 * finalScore = Σ over available signals s of (weight[s] / Σweights) * signal[s]
 * ```
 *
 * RRF mode replaces per-signal values with reciprocal ranks — more robust
 * when score distributions are unreliable, at the cost of magnitude
 * information. Ordering is fully deterministic: ties break on node id.
 */
export class Ranker {
  private readonly mode: "weighted" | "rrf";
  private readonly weights: Record<string, number>;
  private readonly rrfK: number;

  constructor(options: RankerOptions) {
    this.mode = options.mode;
    this.weights = options.weights;
    this.rrfK = options.rrfK ?? 60;
  }

  rank(candidates: Candidate[], limit: number): Candidate[] {
    if (candidates.length === 0) return [];

    /* Discover which signals exist in this candidate set. */
    const available = new Set<string>();
    for (const candidate of candidates) {
      for (const key of Object.keys(candidate.raw)) available.add(key);
    }

    /* Normalize query-dependent signals within the set. */
    for (const signal of QUERY_SIGNALS) {
      if (!available.has(signal)) continue;
      const values: number[] = [];
      for (const candidate of candidates) {
        const value = candidate.raw[signal];
        if (value !== undefined) values.push(value);
      }
      const scale = degenerateAwareScaler(values);
      for (const candidate of candidates) {
        const value = candidate.raw[signal];
        candidate.signals[signal] = value !== undefined ? scale(value) : 0;
      }
    }

    /* Corpus + plugin signals pass through, clamped. */
    const querySet = new Set<string>(QUERY_SIGNALS);
    for (const candidate of candidates) {
      for (const [key, value] of Object.entries(candidate.raw)) {
        if (querySet.has(key)) continue;
        candidate.signals[key] = clamp01(value);
      }
    }

    /* Renormalize weights over available signals. */
    let entries = [...available]
      .map((signal): [string, number] => [signal, this.weights[signal] ?? 0])
      .filter(([, weight]) => weight > 0);
    if (entries.length === 0) {
      entries = [...available].map((signal): [string, number] => [signal, 1]);
    }
    const weightSum = entries.reduce((sum, [, weight]) => sum + weight, 0);

    if (this.mode === "weighted") {
      for (const candidate of candidates) {
        let score = 0;
        for (const [signal, weight] of entries) {
          score += (weight / weightSum) * (candidate.signals[signal] ?? 0);
        }
        candidate.score = score;
      }
    } else {
      for (const candidate of candidates) candidate.score = 0;
      for (const [signal, weight] of entries) {
        // Rank on raw values so "absent" sorts strictly below the weakest
        // present value instead of tying with it after normalization.
        const ordered = [...candidates].sort((a, b) => {
          const aRaw = a.raw[signal];
          const bRaw = b.raw[signal];
          const aValue = aRaw ?? -Infinity;
          const bValue = bRaw ?? -Infinity;
          if (aValue !== bValue) return bValue - aValue;
          return a.nodeId < b.nodeId ? -1 : 1;
        });
        ordered.forEach((candidate, i) => {
          candidate.score += ((weight / weightSum) * (this.rrfK + 1)) / (this.rrfK + i + 1);
        });
      }
    }

    return [...candidates]
      .sort((a, b) => b.score - a.score || (a.nodeId < b.nodeId ? -1 : 1))
      .slice(0, Math.max(0, limit));
  }
}

/**
 * Min-max within the set; a degenerate (constant) distribution maps to 1.0
 * because for query signals, having matched at all is the information.
 */
function degenerateAwareScaler(values: readonly number[]): (value: number) => number {
  if (values.length === 0) return () => 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  if (span < 1e-12) return () => 1;
  return (value: number) => clamp01((value - min) / span);
}
