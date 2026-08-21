import { performance } from "node:perf_hooks";
import type { ResolvedConfig } from "../config/resolve.js";
import type { Logger } from "../core/interfaces.js";
import { clamp01, minMaxScaler } from "../core/math.js";
import {
  NodeKind,
  type Candidate,
  type Chunk,
  type RetrievalDiagnostics,
  type RetrievalStrategy,
} from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";
import { expandFromSeeds, type ExpansionSeed } from "../graph/traversal.js";
import type { LLMProvider } from "../providers/types.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type { BM25Index } from "./bm25.js";
import { type Bm25Hit } from "./bm25.js";
import type { EmbeddingHit, EmbeddingIndex } from "./embedding-index.js";
import { parseQuery } from "./query.js";

export interface RetrieverDeps {
  graph: CodeGraph;
  chunks: ReadonlyMap<string, Chunk>;
  bm25: BM25Index;
  embeddings?: EmbeddingIndex;
  embedProvider?: LLMProvider;
  config: ResolvedConfig;
  logger: Logger;
  telemetry: Telemetry;
}

export interface RetrieveStageOptions {
  strategy?: RetrievalStrategy;
  graphDepth?: number;
  maxNodes?: number;
  signal?: AbortSignal;
}

export interface RawRetrieval {
  candidates: Candidate[];
  diagnostics: RetrievalDiagnostics;
}

const MAX_EXPANSION_SEEDS = 12;
const MAX_NAME_LOOKUPS = 16;

/**
 * The hybrid retrieval pipeline (phase 7):
 *
 * 1. **Candidate generation** — lexical (BM25) and semantic (embedding
 *    cosine) hits over chunks, plus exact symbol-name matches from the graph
 *    name index.
 * 2. **Candidate expansion** — best-first graph traversal (phase 8) from the
 *    strongest seeds, pulling in structurally related code the text stages
 *    cannot see.
 * 3. **Deduplication** — everything merges into one candidate per graph node,
 *    accumulating per-source raw signals.
 * 4. **Ranking** happens downstream in the ranking engine; this class also
 *    attaches the precomputed corpus signals each candidate's node carries.
 */
export class HybridRetriever {
  constructor(private readonly deps: RetrieverDeps) {}

  async retrieve(query: string, options: RetrieveStageOptions = {}): Promise<RawRetrieval> {
    const { config, graph, telemetry, logger } = this.deps;
    const strategy = options.strategy ?? config.strategy;
    const timings: Record<string, number> = {};
    const started = performance.now();
    const parsed = parseQuery(query);

    const wantLexical = strategy === "hybrid" || strategy === "lexical" || strategy === "graph";
    const wantSemantic = strategy === "hybrid" || strategy === "semantic";
    const wantGraph = strategy === "hybrid" || strategy === "graph";
    const candidateLimit = config.retrieval.candidateLimit;

    /* Stage 1a: lexical. (Graph strategy still needs lexical seeds.) */
    let lexicalHits: Bm25Hit[] = [];
    if (wantLexical) {
      const t = performance.now();
      lexicalHits = this.deps.bm25.search(parsed.tokens, candidateLimit);
      timings["lexical"] = performance.now() - t;
    }

    /* Stage 1b: semantic. */
    let semanticHits: EmbeddingHit[] = [];
    let embeddingUsed = false;
    if (wantSemantic) {
      const t = performance.now();
      semanticHits = await this.semanticSearch(parsed.text, candidateLimit, options.signal);
      embeddingUsed = semanticHits.length > 0;
      timings["semantic"] = performance.now() - t;
    }

    /* Stage 1c: exact name matches from the graph index. */
    const nameMatches = this.nameMatches(parsed.identifiers, parsed.tokens);

    /* Stage 2: graph expansion from the strongest seeds. */
    const maxNodes = options.maxNodes ?? config.maxNodes;
    let expandedCount = 0;
    let expansionNodes = new Map<string, { id: string; score: number; depth: number }>();
    const seeds = this.buildSeeds(lexicalHits, semanticHits, nameMatches);
    if (wantGraph && seeds.length > 0) {
      const t = performance.now();
      const result = expandFromSeeds(graph, seeds, {
        maxDepth: options.graphDepth ?? config.graphDepth,
        maxNodes: Math.max(maxNodes * 3, 60),
        traversalBudget: config.expansion.traversalBudget,
        minScore: config.expansion.minScore,
        decay: config.expansion.decay,
        edgeWeights: config.expansion.edgeWeights,
        hubDegreeLimit: config.expansion.hubDegreeLimit,
      });
      expansionNodes = result.nodes;
      expandedCount = result.nodes.size;
      timings["expansion"] = performance.now() - t;
    }

    /* Stage 3: merge + dedupe into per-node candidates. */
    const t = performance.now();
    const candidates = new Map<string, Candidate>();
    const ensure = (nodeId: string): Candidate | undefined => {
      const existing = candidates.get(nodeId);
      if (existing) return existing;
      const node = graph.node(nodeId);
      if (!node) return undefined;
      if (node.kind !== NodeKind.File && node.file === undefined) return undefined;
      const candidate: Candidate = { nodeId, sources: [], raw: {}, signals: {}, score: 0 };
      candidates.set(nodeId, candidate);
      return candidate;
    };

    for (const hit of lexicalHits) {
      const candidate = ensure(hit.id);
      if (!candidate) continue;
      candidate.raw["lexical"] = Math.max(candidate.raw["lexical"] ?? 0, hit.score);
      if (!candidate.sources.includes("lexical")) candidate.sources.push("lexical");
      candidate.depth = 0;
    }
    for (const hit of semanticHits) {
      const candidate = ensure(hit.id);
      if (!candidate) continue;
      candidate.raw["semantic"] = Math.max(candidate.raw["semantic"] ?? 0, clamp01(hit.score));
      if (!candidate.sources.includes("semantic")) candidate.sources.push("semantic");
      candidate.depth = 0;
    }
    const maxLexical = lexicalHits.reduce((max, hit) => Math.max(max, hit.score), 0);
    for (const nodeId of nameMatches) {
      const candidate = ensure(nodeId);
      if (!candidate) continue;
      // An exact symbol/file-name match outranks any body match lexically.
      candidate.raw["lexical"] = Math.max(
        candidate.raw["lexical"] ?? 0,
        maxLexical > 0 ? maxLexical * 1.05 : 1,
      );
      if (!candidate.sources.includes("lexical")) candidate.sources.push("lexical");
      candidate.depth = 0;
    }
    for (const expanded of expansionNodes.values()) {
      const candidate = ensure(expanded.id);
      if (!candidate) continue;
      candidate.raw["graph"] = Math.max(candidate.raw["graph"] ?? 0, expanded.score);
      if (!candidate.sources.includes("graph")) candidate.sources.push("graph");
      candidate.depth = Math.min(candidate.depth ?? expanded.depth, expanded.depth);
    }

    /* Attach precomputed corpus signals from node metrics. */
    for (const candidate of candidates.values()) {
      const metrics = graph.node(candidate.nodeId)?.metrics;
      if (!metrics) continue;
      if (metrics.centrality !== undefined) candidate.raw["centrality"] = metrics.centrality;
      if (metrics.importance !== undefined) candidate.raw["importance"] = metrics.importance;
      if (metrics.activity !== undefined) candidate.raw["activity"] = metrics.activity;
      if (metrics.recency !== undefined) candidate.raw["recency"] = metrics.recency;
      if (metrics.dependency !== undefined) candidate.raw["dependency"] = metrics.dependency;
      if (metrics.usage !== undefined) candidate.raw["usage"] = metrics.usage;
    }
    timings["merge"] = performance.now() - t;

    const totalMs = performance.now() - started;
    const diagnostics: RetrievalDiagnostics = {
      timings,
      totalMs,
      strategy,
      seedCount: seeds.length,
      expandedCount,
      candidateCount: candidates.size,
      embeddingUsed,
    };
    telemetry.record("retrieval.pipeline", {
      durationMs: totalMs,
      strategy,
      candidates: candidates.size,
      seeds: seeds.length,
      expanded: expandedCount,
      embeddingUsed,
    });
    logger.debug(
      `retrieved ${candidates.size} candidates (seeds=${seeds.length}, expanded=${expandedCount}) in ${totalMs.toFixed(1)}ms`,
    );
    return { candidates: [...candidates.values()], diagnostics };
  }

  private async semanticSearch(
    text: string,
    limit: number,
    signal: AbortSignal | undefined,
  ): Promise<EmbeddingHit[]> {
    const { embeddings, embedProvider, logger } = this.deps;
    if (!embeddings || embeddings.size === 0) return [];
    if (!embedProvider) return [];
    if (embedProvider.name !== embeddings.provider) {
      logger.warn(
        `Embedding index was built with provider "${embeddings.provider}" but "${embedProvider.name}" is active. Run "agc index" to rebuild; semantic retrieval skipped.`,
      );
      return [];
    }
    try {
      const result = await embedProvider.embed({ texts: [text], ...(signal ? { signal } : {}) });
      const vector = result.vectors[0];
      if (!vector || vector.length !== embeddings.dim) {
        logger.warn(
          `Query embedding dim ${vector?.length ?? 0} does not match index dim ${embeddings.dim}; semantic retrieval skipped.`,
        );
        return [];
      }
      return embeddings.search(vector, limit);
    } catch (error) {
      logger.warn(
        `Semantic retrieval unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private nameMatches(identifiers: readonly string[], tokens: readonly string[]): string[] {
    const { graph } = this.deps;
    const terms = [...new Set([...identifiers, ...tokens])].slice(0, MAX_NAME_LOOKUPS);
    const ids: string[] = [];
    for (const term of terms) {
      for (const node of graph.findByName(term)) {
        if (node.kind === NodeKind.File || node.file !== undefined) {
          ids.push(node.id);
        }
      }
    }
    return [...new Set(ids)];
  }

  private buildSeeds(
    lexicalHits: readonly Bm25Hit[],
    semanticHits: readonly EmbeddingHit[],
    nameMatches: readonly string[],
  ): ExpansionSeed[] {
    const scores = new Map<string, number>();
    const lexScaler = minMaxScaler(lexicalHits.map((hit) => hit.score));
    for (const hit of lexicalHits.slice(0, MAX_EXPANSION_SEEDS)) {
      scores.set(hit.id, Math.max(scores.get(hit.id) ?? 0, 0.9 * lexScaler(hit.score)));
    }
    for (const hit of semanticHits.slice(0, MAX_EXPANSION_SEEDS)) {
      scores.set(hit.id, Math.max(scores.get(hit.id) ?? 0, clamp01(hit.score)));
    }
    for (const id of nameMatches) {
      scores.set(id, 1);
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_EXPANSION_SEEDS);
  }
}
