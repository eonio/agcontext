import { BinaryHeap } from "../core/heap.js";
import type { EdgeKind } from "../core/types.js";
import type { CodeGraph } from "./graph.js";

/**
 * Graph expansion (phase 8). Best-first traversal from retrieval seeds with
 * four independent guards against graph explosion:
 *
 * 1. **Depth limit** — no node further than `maxDepth` hops from a seed.
 * 2. **Traversal budget** — at most `traversalBudget` node visits total; the
 *    priority queue spends the budget on the most promising frontiers first,
 *    which is what makes the expansion *adaptive*: strong seeds naturally
 *    claim more of the budget than weak ones.
 * 3. **Score threshold** — propagated relevance decays by `decay` x
 *    edge-kind weight per hop; frontiers below `minScore` are recorded but
 *    not expanded further.
 * 4. **Hub damping** — nodes with degree above `hubDegreeLimit` (barrel
 *    files, god utils) are included but never expanded, so one `index.ts`
 *    cannot pull in the whole repository.
 */
export interface ExpansionOptions {
  maxDepth: number;
  maxNodes: number;
  traversalBudget: number;
  minScore: number;
  decay: number;
  edgeWeights: Record<EdgeKind, number>;
  hubDegreeLimit: number;
}

export interface ExpansionSeed {
  id: string;
  /** Seed relevance in [0, 1]. */
  score: number;
}

export interface ExpandedNode {
  id: string;
  score: number;
  depth: number;
  /** Node this one was reached from (undefined for seeds). */
  via?: string;
}

export interface ExpansionResult {
  nodes: Map<string, ExpandedNode>;
  visited: number;
}

interface Frontier extends ExpandedNode {
  seq: number;
}

export function expandFromSeeds(
  graph: CodeGraph,
  seeds: readonly ExpansionSeed[],
  options: ExpansionOptions,
): ExpansionResult {
  const best = new Map<string, ExpandedNode>();
  let seq = 0;
  const heap = new BinaryHeap<Frontier>((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.seq - b.seq;
  });

  const seedBest = new Map<string, number>();
  for (const seed of seeds) {
    if (!graph.hasNode(seed.id)) continue;
    const prev = seedBest.get(seed.id);
    if (prev === undefined || seed.score > prev) seedBest.set(seed.id, seed.score);
  }
  for (const [id, score] of seedBest) {
    heap.push({ id, score, depth: 0, seq: seq++ });
  }

  let visited = 0;
  while (heap.size > 0 && visited < options.traversalBudget) {
    const current = heap.pop() as Frontier;
    const existing = best.get(current.id);
    if (existing && existing.score >= current.score) continue;
    best.set(current.id, {
      id: current.id,
      score: current.score,
      depth: current.depth,
      ...(current.via !== undefined ? { via: current.via } : {}),
    });
    visited++;

    if (current.depth >= options.maxDepth) continue;
    if (current.score < options.minScore) continue;
    // Seeds (depth 0) always expand; hubs beyond that are terminal.
    if (current.depth > 0 && graph.degree(current.id) > options.hubDegreeLimit) continue;

    const neighbors = [
      ...graph.outEdges(current.id).map((edge) => ({ edge, next: edge.to })),
      ...graph.inEdges(current.id).map((edge) => ({ edge, next: edge.from })),
    ];
    for (const { edge, next } of neighbors) {
      const kindWeight = options.edgeWeights[edge.kind] ?? 0.5;
      if (kindWeight <= 0) continue;
      const nextScore = current.score * options.decay * kindWeight;
      if (nextScore <= 0) continue;
      const known = best.get(next);
      if (known && known.score >= nextScore) continue;
      heap.push({
        id: next,
        score: nextScore,
        depth: current.depth + 1,
        via: current.id,
        seq: seq++,
      });
    }
  }

  if (best.size > options.maxNodes) {
    const trimmed = [...best.values()]
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, options.maxNodes);
    return { nodes: new Map(trimmed.map((n) => [n.id, n])), visited };
  }
  return { nodes: best, visited };
}
