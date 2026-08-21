import { clamp01, halfLifeDecay, logMinMaxScaler, minMaxScaler } from "../core/math.js";
import { stem } from "../core/paths.js";
import { EdgeKind, NodeKind, type GraphNode } from "../core/types.js";
import type { GitStats } from "../indexing/git.js";
import type { CodeGraph } from "./graph.js";

export interface PageRankOptions {
  damping?: number;
  iterations?: number;
}

/**
 * Weighted PageRank over the full graph. An edge A→B confers importance on B,
 * which matches code semantics: things that are imported/called/extended a lot
 * are load-bearing. Dangling mass is redistributed uniformly.
 */
export function computePageRank(
  graph: CodeGraph,
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 25;
  const ids = [...graph.allNodes()].map((node) => node.id);
  const n = ids.length;
  const result = new Map<string, number>();
  if (n === 0) return result;

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  const outWeight = new Float64Array(n);
  interface Link {
    from: number;
    to: number;
    weight: number;
  }
  const links: Link[] = [];
  for (const edge of graph.allEdges()) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const weight = Math.max(edge.weight, 1e-9);
    links.push({ from, to, weight });
    outWeight[from] = (outWeight[from] as number) + weight;
  }

  let rank = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  for (let iter = 0; iter < iterations; iter++) {
    next.fill(0);
    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      if ((outWeight[i] as number) === 0) danglingMass += rank[i] as number;
    }
    for (const link of links) {
      next[link.to] =
        (next[link.to] as number) +
        ((rank[link.from] as number) * link.weight) / (outWeight[link.from] as number);
    }
    const base = (1 - damping) / n + (damping * danglingMass) / n;
    for (let i = 0; i < n; i++) {
      next[i] = base + damping * (next[i] as number);
    }
    [rank, next] = [next, rank];
  }

  ids.forEach((id, i) => result.set(id, rank[i] as number));
  return result;
}

export interface MetricsInput {
  gitStats?: GitStats;
  /** File path → mtime (ms) fallback when git data is unavailable. */
  fileMtimes?: Map<string, number>;
  /** Repo-relative paths of package entrypoints (main/bin/exports). */
  entrypoints?: Set<string>;
  now: number;
  /** Recency half-life in days. Default: 30. */
  recencyHalfLifeDays?: number;
}

const FILE_LIKE = new Set([NodeKind.File]);

function isSymbolNode(node: GraphNode): boolean {
  return node.file !== undefined && !FILE_LIKE.has(node.kind);
}

/**
 * Computes and stores every corpus-level ranking signal on node metrics
 * (phase 10 precomputation): centrality, file importance, dependency weight,
 * git activity, recency, and symbol usage — each normalized to [0, 1] at
 * index time so query-time ranking is pure arithmetic.
 */
export function applyGraphMetrics(graph: CodeGraph, input: MetricsInput): void {
  const halfLifeMs = (input.recencyHalfLifeDays ?? 30) * 86_400_000;

  /* Centrality: log-scaled PageRank, min-max normalized over all nodes. */
  const pagerank = computePageRank(graph);
  const prScaler = logMinMaxScaler([...pagerank.values()].map((v) => v * pagerank.size));
  for (const node of graph.allNodes()) {
    const pr = pagerank.get(node.id);
    if (pr !== undefined) node.metrics.centrality = prScaler(pr * pagerank.size);
  }

  /* File-level structure signals. */
  const files: GraphNode[] = [];
  for (const node of graph.allNodes()) {
    if (node.kind === NodeKind.File) files.push(node);
  }

  const fanIns: number[] = [];
  const exportCounts: number[] = [];
  for (const file of files) {
    const fanIn = graph.inEdges(file.id, [EdgeKind.Imports]).length;
    const fanOut = graph.outEdges(file.id, [EdgeKind.Imports]).length;
    const exports = graph.outEdges(file.id, [EdgeKind.Exports]).length;
    file.metrics.fanIn = fanIn;
    file.metrics.fanOut = fanOut;
    fanIns.push(fanIn);
    exportCounts.push(exports);
  }
  const fanInScaler = logMinMaxScaler(fanIns);
  const exportScaler = logMinMaxScaler(exportCounts);

  const importanceRaw: number[] = [];
  for (const file of files) {
    const path = file.path ?? "";
    const raw =
      0.35 * fanInScaler(file.metrics.fanIn ?? 0) +
      0.2 * exportScaler(graph.outEdges(file.id, [EdgeKind.Exports]).length) +
      0.25 * (input.entrypoints?.has(path) ? 1 : 0) +
      0.2 * pathHeuristicScore(path);
    importanceRaw.push(raw);
  }
  const importanceScaler = minMaxScaler(importanceRaw);
  files.forEach((file, i) => {
    file.metrics.importance = importanceScaler(importanceRaw[i] as number);
    file.metrics.dependency = fanInScaler(file.metrics.fanIn ?? 0);
  });

  /* Git activity and recency. */
  const gitAvailable = input.gitStats?.available === true && input.gitStats.files.size > 0;
  const commitCounts = gitAvailable
    ? files.map((f) => input.gitStats?.files.get(f.path ?? "")?.commitCount ?? 0)
    : [];
  const activityScaler = logMinMaxScaler(commitCounts);
  for (const file of files) {
    const path = file.path ?? "";
    const git = input.gitStats?.files.get(path);
    if (gitAvailable) {
      file.metrics.commitCount = git?.commitCount ?? 0;
      file.metrics.activity = activityScaler(git?.commitCount ?? 0);
    }
    const lastModified = git?.lastCommitAt ?? input.fileMtimes?.get(path);
    if (lastModified !== undefined && lastModified > 0) {
      file.metrics.lastModifiedAt = lastModified;
      file.metrics.recency = halfLifeDecay(input.now - lastModified, halfLifeMs);
    }
  }

  /* Symbol usage + inherited file signals. */
  const symbols: GraphNode[] = [];
  for (const node of graph.allNodes()) {
    if (isSymbolNode(node)) symbols.push(node);
  }
  const usageCounts = symbols.map((symbol) =>
    graph
      .inEdges(symbol.id, [EdgeKind.Calls, EdgeKind.References])
      .reduce((sum, edge) => sum + edge.weight, 0),
  );
  const usageScaler = logMinMaxScaler(usageCounts);
  symbols.forEach((symbol, i) => {
    symbol.metrics.usage = usageScaler(usageCounts[i] as number);
    const file = symbol.file !== undefined ? graph.fileNode(symbol.file) : undefined;
    if (!file) return;
    // Symbols inherit their file's corpus signals so ranking reads uniformly.
    if (file.metrics.importance !== undefined) symbol.metrics.importance = file.metrics.importance;
    if (file.metrics.dependency !== undefined) symbol.metrics.dependency = file.metrics.dependency;
    if (file.metrics.activity !== undefined) symbol.metrics.activity = file.metrics.activity;
    if (file.metrics.recency !== undefined) symbol.metrics.recency = file.metrics.recency;
    if (file.metrics.lastModifiedAt !== undefined) {
      symbol.metrics.lastModifiedAt = file.metrics.lastModifiedAt;
    }
  });
}

/** Path-shape prior: entry-like names up, deep nesting and test scaffolding down. */
export function pathHeuristicScore(path: string): number {
  let score = 0.5;
  const base = stem(path);
  if (base === "index" || base === "main" || base === "app" || base === "server") score += 0.3;
  if (path.startsWith("src/")) score += 0.1;
  const depth = path.split("/").length;
  score -= Math.max(0, depth - 2) * 0.05;
  if (
    /(^|\/)(tests?|__tests__|__mocks__|spec|specs|fixtures?|mocks?|examples?|stories)(\/|$)/.test(
      path,
    ) ||
    /\.(test|spec|stories)\.[^/]+$/.test(path)
  ) {
    score -= 0.5;
  }
  return clamp01(score);
}
