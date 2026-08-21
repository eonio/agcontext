import { architectureSummary } from "../compression/architecture.js";
import { dependencySummary } from "../compression/dependencies.js";
import { fileSummary } from "../compression/summaries.js";
import type { ResolvedConfig } from "../config/resolve.js";
import type { TokenCounter } from "../core/interfaces.js";
import {
  EdgeKind,
  NodeKind,
  type Chunk,
  type ContextFile,
  type ContextPackage,
  type ContextSymbol,
  type RepositoryAnalysis,
  type RetrievalStrategy,
  type RetrievedItem,
} from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";
import type { FileAnalysis } from "../indexing/analyzer.js";
import { buildRecommendations } from "./recommendations.js";

export interface ContextBuilderDeps {
  graph: CodeGraph;
  chunkMap: ReadonlyMap<string, Chunk>;
  analyses: ReadonlyMap<string, FileAnalysis>;
  report?: RepositoryAnalysis;
  config: ResolvedConfig;
  tokenCounter: TokenCounter;
  /** Reads a repo-relative file; undefined when unreadable. */
  readFile: (relPath: string) => Promise<string | undefined>;
  /** Compressed-view producer; defaults to {@link fileSummary}. CompressionPlugins chain here. */
  summarizeFile?: (analysis: FileAnalysis) => string;
}

export interface BuildContextOptions {
  maxTokens?: number;
  includeArchitecture?: boolean;
  includeRecommendations?: boolean;
  strategy: RetrievalStrategy;
  indexedAt?: string;
}

/**
 * Context assembly (phase 11). Turns ranked nodes into the final package under
 * a hard token budget:
 *
 * - **Redundancy removal** — a file included in full swallows its symbols; an
 *   included class swallows its methods; symbol-level code demotes later
 *   file-level inclusion to a compressed view.
 * - **Density maximization** — every candidate gets the richest
 *   representation that fits, walking down a ladder: full source →
 *   compressed signature view → one-line mention.
 * - **Token awareness** — an injectable {@link TokenCounter} prices every
 *   piece; the builder never exceeds the budget.
 * - **Deterministic output** — rank order in, stable ordering and stable
 *   trimming out. Identical inputs produce byte-identical packages.
 */
export class ContextBuilder {
  constructor(private readonly deps: ContextBuilderDeps) {}

  async build(
    query: string,
    ranked: readonly RetrievedItem[],
    options: BuildContextOptions,
  ): Promise<ContextPackage> {
    const { config, tokenCounter, graph } = this.deps;
    const budget = options.maxTokens ?? config.context.maxTokens;
    const includeArchitecture = options.includeArchitecture ?? config.context.includeArchitecture;
    const includeRecommendations =
      options.includeRecommendations ?? config.context.includeRecommendations;

    /* Reserve headroom for the framing sections; content gets the rest. */
    const reserve = Math.min(Math.floor(budget * 0.25), 3000);
    let contentRemaining = budget - reserve;

    const files: ContextFile[] = [];
    const symbols: ContextSymbol[] = [];
    const fullFiles = new Set<string>();
    const compressedFiles = new Set<string>();
    const symbolCodePaths = new Set<string>();
    const includedSymbolIds = new Set<string>();

    for (const item of ranked) {
      if (contentRemaining <= 20) break;
      if (item.kind === NodeKind.File) {
        const added = await this.addFile(item, files, {
          remaining: () => contentRemaining,
          spend: (tokens) => {
            contentRemaining -= tokens;
          },
          fullFiles,
          compressedFiles,
          symbolCodePaths,
        });
        if (!added) continue;
      } else {
        this.addSymbol(item, symbols, {
          remaining: () => contentRemaining,
          spend: (tokens) => {
            contentRemaining -= tokens;
          },
          fullFiles,
          symbolCodePaths,
          includedSymbolIds,
        });
      }
    }

    const includedPaths = new Set<string>([...fullFiles, ...compressedFiles, ...symbolCodePaths]);

    /* Architecture + dependency map. */
    let architecture: string[] = [];
    if (includeArchitecture) {
      architecture = architectureSummary(this.deps.report, graph);
      const archBudget = Math.floor(budget * 0.15);
      architecture = trimToBudget(architecture, archBudget, tokenCounter);
      const deps = dependencySummary([...includedPaths], graph);
      if (deps.length > 0) {
        const depsBudget = Math.floor(budget * 0.06);
        architecture = [
          ...architecture,
          "Dependency map of the selected files:",
          ...trimToBudget(deps, depsBudget, tokenCounter),
        ];
      }
    }

    /* Recommendations. */
    const recommendations = includeRecommendations
      ? buildRecommendations({ ranked, graph, includedPaths })
      : [];

    /* Summary. */
    const repoName = this.deps.report?.name ?? "repository";
    const focus = [...new Set(ranked.map((item) => item.path))].slice(0, 3);
    const summaryParts = [
      `Context for "${query}" in ${repoName}: ${files.length} files and ${symbols.length} symbols selected via ${options.strategy} retrieval.`,
    ];
    if (focus.length > 0) summaryParts.push(`Focus areas: ${focus.join(", ")}.`);
    const firstPattern = this.deps.report?.patterns[0];
    if (firstPattern !== undefined) summaryParts.push(`Repository shape: ${firstPattern}.`);
    const summary = summaryParts.join(" ");

    /* Token accounting. */
    const breakdown: Record<string, number> = {
      summary: tokenCounter.count(summary),
      architecture: architecture.reduce((sum, line) => sum + tokenCounter.count(line), 0),
      files: files.reduce((sum, file) => sum + file.tokens, 0),
      symbols: symbols.reduce((sum, symbol) => sum + this.symbolTokens(symbol), 0),
      recommendations: recommendations.reduce((sum, line) => sum + tokenCounter.count(line), 0),
    };
    const used = Object.values(breakdown).reduce((sum, tokens) => sum + tokens, 0);

    return {
      summary,
      architecture,
      files,
      symbols,
      recommendations,
      tokens: { budget, used, breakdown },
      meta: {
        query,
        strategy: options.strategy,
        nodeCount: ranked.length,
        ...(options.indexedAt !== undefined ? { indexedAt: options.indexedAt } : {}),
      },
    };
  }

  private async addFile(
    item: RetrievedItem,
    files: ContextFile[],
    state: {
      remaining: () => number;
      spend: (tokens: number) => void;
      fullFiles: Set<string>;
      compressedFiles: Set<string>;
      symbolCodePaths: Set<string>;
    },
  ): Promise<boolean> {
    const { config, tokenCounter } = this.deps;
    const path = item.path;
    if (state.fullFiles.has(path) || state.compressedFiles.has(path)) return false;
    const reason = describeReason(item);

    /* Full source — unless symbol-level code from this file is already in. */
    if (!state.symbolCodePaths.has(path)) {
      const content = await this.deps.readFile(path);
      if (content !== undefined) {
        const tokens = tokenCounter.count(content);
        if (tokens <= Math.min(config.context.maxFileTokens, state.remaining())) {
          files.push({
            path,
            reason,
            representation: "full",
            content,
            tokens,
            score: round3(item.score),
          });
          state.spend(tokens);
          state.fullFiles.add(path);
          return true;
        }
      }
    }

    /* Compressed signature view. */
    const analysis = this.deps.analyses.get(path);
    if (analysis) {
      const compressed = (this.deps.summarizeFile ?? fileSummary)(analysis);
      const tokens = tokenCounter.count(compressed);
      if (tokens <= state.remaining()) {
        files.push({
          path,
          reason,
          representation: "compressed",
          content: compressed,
          tokens,
          score: round3(item.score),
        });
        state.spend(tokens);
        state.compressedFiles.add(path);
        return true;
      }
    }

    /* Mention. */
    const mention = `${path}${item.signature ? ` — ${item.signature}` : ""}`;
    const tokens = tokenCounter.count(mention);
    if (tokens <= state.remaining()) {
      files.push({
        path,
        reason,
        representation: "mention",
        content: mention,
        tokens,
        score: round3(item.score),
      });
      state.spend(tokens);
      return true;
    }
    return false;
  }

  private addSymbol(
    item: RetrievedItem,
    symbols: ContextSymbol[],
    state: {
      remaining: () => number;
      spend: (tokens: number) => void;
      fullFiles: Set<string>;
      symbolCodePaths: Set<string>;
      includedSymbolIds: Set<string>;
    },
  ): void {
    const { config, tokenCounter } = this.deps;
    /* Redundancy: skip symbols whose file or containing class is already in. */
    if (state.fullFiles.has(item.path)) return;
    if (state.includedSymbolIds.has(item.nodeId)) return;
    const hashIndex = item.nodeId.indexOf("#");
    const lastDot = item.nodeId.lastIndexOf(".");
    if (hashIndex !== -1 && lastDot > hashIndex) {
      const containerId = item.nodeId.slice(0, lastDot);
      if (state.includedSymbolIds.has(containerId)) return;
    }

    const relations = this.relationNotes(item.nodeId);
    const card: ContextSymbol = {
      id: item.nodeId,
      name: item.name,
      kind: item.kind,
      file: item.path,
      ...(item.startLine !== undefined ? { startLine: item.startLine } : {}),
      ...(item.endLine !== undefined ? { endLine: item.endLine } : {}),
      signature: item.signature ?? item.name,
      ...(item.doc !== undefined ? { doc: item.doc } : {}),
      relations,
      score: round3(item.score),
    };

    /* Try to carry the full symbol source. */
    const chunk = this.deps.chunkMap.get(item.nodeId);
    if (chunk) {
      const codeTokens = tokenCounter.count(chunk.text);
      const baseTokens = this.symbolTokens(card);
      if (
        codeTokens <= config.context.maxSymbolTokens &&
        codeTokens + baseTokens <= state.remaining()
      ) {
        card.code = chunk.text;
      }
    }

    const cost = this.symbolTokens(card);
    if (cost > state.remaining()) {
      delete card.code;
      const reducedCost = this.symbolTokens(card);
      if (reducedCost > state.remaining()) return;
      state.spend(reducedCost);
    } else {
      state.spend(cost);
    }
    symbols.push(card);
    state.includedSymbolIds.add(item.nodeId);
    if (card.code !== undefined) state.symbolCodePaths.add(item.path);
  }

  private relationNotes(nodeId: string): string[] {
    const { graph } = this.deps;
    const notes: string[] = [];
    const callers = graph
      .inEdges(nodeId, [EdgeKind.Calls])
      .map((edge) => ({ edge, node: graph.node(edge.from) }))
      .filter((entry) => entry.node !== undefined)
      .sort((a, b) => b.edge.weight - a.edge.weight || (a.edge.from < b.edge.from ? -1 : 1))
      .slice(0, 2);
    for (const { node } of callers) {
      if (node) notes.push(`called by ${node.name}${node.file ? ` (${node.file})` : ""}`);
    }
    const callees = graph
      .outEdges(nodeId, [EdgeKind.Calls])
      .map((edge) => graph.node(edge.to))
      .filter((node) => node !== undefined && !node.external)
      .slice(0, 2);
    if (callees.length > 0) {
      notes.push(`calls ${callees.map((node) => (node as { name: string }).name).join(", ")}`);
    }
    for (const edge of graph.outEdges(nodeId, [EdgeKind.Inheritance]).slice(0, 1)) {
      const base = graph.node(edge.to);
      if (base) {
        notes.push(
          `${edge.meta?.variant === "implements" ? "implements" : "extends"} ${base.name}`,
        );
      }
    }
    for (const edge of graph.inEdges(nodeId, [EdgeKind.Inheritance]).slice(0, 1)) {
      const derived = graph.node(edge.from);
      if (derived) notes.push(`subclassed by ${derived.name}`);
    }
    return notes.slice(0, 4);
  }

  private symbolTokens(symbol: ContextSymbol): number {
    const { tokenCounter } = this.deps;
    let tokens = tokenCounter.count(symbol.signature) + tokenCounter.count(symbol.file) + 8;
    if (symbol.doc !== undefined) tokens += tokenCounter.count(symbol.doc);
    for (const relation of symbol.relations) tokens += tokenCounter.count(relation);
    if (symbol.code !== undefined) tokens += tokenCounter.count(symbol.code);
    return tokens;
  }
}

function describeReason(item: RetrievedItem): string {
  const direct = item.sources.filter((source) => source !== "graph");
  if ((item.depth ?? 0) === 0 && direct.length > 0) {
    return `direct match (${direct.join(" + ")})`;
  }
  if (item.sources.includes("graph")) {
    return `related via code graph (${item.depth ?? 1} hop${(item.depth ?? 1) === 1 ? "" : "s"} from a match)`;
  }
  return `matched (${item.sources.join(" + ") || "ranking"})`;
}

function trimToBudget(
  lines: readonly string[],
  budgetTokens: number,
  tokenCounter: TokenCounter,
): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = tokenCounter.count(line);
    if (used + cost > budgetTokens) break;
    out.push(line);
    used += cost;
  }
  return out;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
