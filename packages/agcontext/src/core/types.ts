/**
 * Core domain model for AGContext.
 *
 * These types are pure data — no IO, no dependencies on outer layers.
 * Everything else in the package (indexing, graph, retrieval, ranking,
 * compression, context assembly) speaks in terms of this vocabulary.
 */

/** Kinds of nodes in the code graph. */
export enum NodeKind {
  Repository = "repository",
  Directory = "directory",
  File = "file",
  /** An external package (e.g. `express`) referenced by imports. */
  Module = "module",
  Class = "class",
  Interface = "interface",
  Function = "function",
  Method = "method",
  Type = "type",
  Enum = "enum",
  Variable = "variable",
}

/** Kinds of edges in the code graph. */
export enum EdgeKind {
  /** Structural containment: repository → directory → file → symbol. */
  Contains = "contains",
  Imports = "imports",
  Exports = "exports",
  References = "references",
  Calls = "calls",
  /** `extends` and `implements` relationships (see edge meta.variant). */
  Inheritance = "inheritance",
  /** Has-a relationships: a class property typed as / initialized with another symbol. */
  Composition = "composition",
}

export type Language = "ts" | "js";

/**
 * Corpus-level metrics precomputed at index time and stored on nodes.
 * All normalized values are in [0, 1].
 */
export interface NodeMetrics {
  /** PageRank centrality, log-scaled and min-max normalized across the graph. */
  centrality?: number;
  /** Composite file importance (entrypoints, fan-in, exports, path heuristics). */
  importance?: number;
  /** Git activity: commit count over the configured window, log-scaled and normalized. */
  activity?: number;
  /** Recency: exponential decay on the last commit (or mtime) age. */
  recency?: number;
  /** Dependency weight: import fan-in, log-scaled and normalized. */
  dependency?: number;
  /** Symbol usage: incoming Calls + References, log-scaled and normalized. */
  usage?: number;
  /** Raw incoming Imports edge count (files). */
  fanIn?: number;
  /** Raw outgoing Imports edge count (files). */
  fanOut?: number;
  /** Lines of code (files). */
  loc?: number;
  /** Raw commit count within the git window (files). */
  commitCount?: number;
  /** Last modification time (last commit or file mtime), epoch milliseconds. */
  lastModifiedAt?: number;
}

export interface GraphNode {
  /** Stable id, e.g. `file:src/auth/service.ts`, `sym:src/auth/service.ts#AuthService.login`. */
  id: string;
  kind: NodeKind;
  name: string;
  /** Repo-relative POSIX path for repository/directory/file nodes. */
  path?: string;
  /** Containing file (repo-relative POSIX path) for symbol nodes. */
  file?: string;
  /** 1-based line range for file-backed nodes. */
  startLine?: number;
  endLine?: number;
  /** Declaration signature (up to the body), whitespace-collapsed. */
  signature?: string;
  /** First JSDoc paragraph, if present. */
  doc?: string;
  exported?: boolean;
  language?: Language;
  /** True for external package Module nodes. */
  external?: boolean;
  metrics: NodeMetrics;
}

export interface GraphEdgeMeta {
  variant?: "extends" | "implements" | "instantiates" | "reexport" | "type-only";
  /** How the target was resolved: same-file, via an import binding, or unique global name. */
  resolution?: "local" | "import" | "global-unique";
  count?: number;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  meta?: GraphEdgeMeta;
}

/** A retrievable unit of text: one symbol or one compressed file view. */
export interface Chunk {
  /** Equals the graph node id this chunk represents. */
  id: string;
  file: string;
  name: string;
  kind: NodeKind;
  text: string;
  /** Content hash of `text`; keys the embedding cache. */
  hash: string;
  startLine: number;
  endLine: number;
}

export type CandidateSource = "lexical" | "semantic" | "graph";

export type SignalName =
  | "semantic"
  | "lexical"
  | "graph"
  | "centrality"
  | "importance"
  | "activity"
  | "recency"
  | "dependency"
  | "usage";

export type SignalWeights = Record<SignalName, number>;

/**
 * Signal maps are open records: keys are {@link SignalName} for built-ins,
 * plus any custom signal names contributed by RankingPlugins.
 */
export type SignalMap = Record<string, number>;

export interface Candidate {
  nodeId: string;
  sources: CandidateSource[];
  /** Raw signal values (query-dependent signals are unnormalized here). */
  raw: SignalMap;
  /** Normalized signal values in [0, 1], populated by the ranking engine. */
  signals: SignalMap;
  /** Final fused score, populated by the ranking engine. */
  score: number;
  /** Hop distance from the nearest retrieval seed (0 = direct hit). */
  depth?: number;
}

export type RetrievalStrategy = "hybrid" | "graph" | "lexical" | "semantic";

export type ContextFormat = "markdown" | "xml" | "json";

/** Options for {@link RetrievalResult}-producing calls (AGContext.retrieve). */
export interface RetrieveOptions {
  query: string;
  /** Result count. Default: config retrieval.limit (20). */
  limit?: number;
  strategy?: RetrievalStrategy;
  graphDepth?: number;
  maxNodes?: number;
  signal?: AbortSignal;
}

/** Options for context assembly (AGContext.context). */
export interface ContextOptions extends RetrieveOptions {
  /** Token budget. Default: config context.maxTokens (12000). */
  maxTokens?: number;
  format?: ContextFormat;
  includeArchitecture?: boolean;
  includeRecommendations?: boolean;
}

export interface RetrievedItem {
  nodeId: string;
  kind: NodeKind;
  name: string;
  path: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  doc?: string;
  score: number;
  signals: SignalMap;
  sources: CandidateSource[];
  depth?: number;
  snippet?: string;
}

export interface RetrievalDiagnostics {
  /** Per-stage wall-clock timings in milliseconds. */
  timings: Record<string, number>;
  totalMs: number;
  strategy: RetrievalStrategy;
  seedCount: number;
  expandedCount: number;
  candidateCount: number;
  embeddingUsed: boolean;
}

export interface RetrievalResult {
  query: string;
  items: RetrievedItem[];
  diagnostics: RetrievalDiagnostics;
}

export type ContextRepresentation = "full" | "compressed" | "mention";

export interface ContextFile {
  path: string;
  /** Why this file is part of the context. */
  reason: string;
  representation: ContextRepresentation;
  content: string;
  tokens: number;
  score: number;
}

export interface ContextSymbol {
  id: string;
  name: string;
  kind: NodeKind;
  file: string;
  startLine?: number;
  endLine?: number;
  signature: string;
  doc?: string;
  /** Human-readable relation notes, e.g. `called by LoginController.handle`. */
  relations: string[];
  /** Full source of the symbol, included when the token budget allows. */
  code?: string;
  score: number;
}

export interface ContextTokenReport {
  budget: number;
  used: number;
  breakdown: Record<string, number>;
}

/** The final assembled context package handed to an agent. */
export interface ContextPackage {
  summary: string;
  architecture: string[];
  files: ContextFile[];
  symbols: ContextSymbol[];
  recommendations: string[];
  tokens: ContextTokenReport;
  meta: {
    query: string;
    strategy: RetrievalStrategy;
    nodeCount: number;
    /** ISO timestamp of the underlying index (stable between re-indexes). */
    indexedAt?: string;
  };
}

export interface IndexStats {
  files: number;
  symbols: number;
  nodes: number;
  edges: number;
  chunks: number;
  embeddedChunks: number;
  addedFiles: number;
  changedFiles: number;
  removedFiles: number;
  incremental: boolean;
  durationMs: number;
  indexedAt: string;
  warnings: string[];
}

export interface ExplainRelation {
  kind: EdgeKind;
  direction: "in" | "out";
  nodeId: string;
  name: string;
  path?: string;
  variant?: string;
}

export interface SymbolExplanation {
  id: string;
  kind: NodeKind;
  name: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  doc?: string;
  exported?: boolean;
  metrics: NodeMetrics;
  relations: ExplainRelation[];
  fileSummary?: string;
  /** Present when an LLM explanation was requested and a generate provider is available. */
  aiExplanation?: string;
}

/* ------------------------------------------------------------------ */
/* Repository analysis                                                 */
/* ------------------------------------------------------------------ */

export interface PackageEntrypoint {
  kind: "main" | "module" | "exports" | "bin" | "types";
  path: string;
}

export interface DirectoryProfile {
  path: string;
  role: string;
  files: number;
  loc: number;
}

export interface HotspotFile {
  path: string;
  commitCount?: number;
  centrality?: number;
  reason: string;
}

export interface OwnershipRecord {
  path: string;
  topAuthor: string;
  /** Share of commits by the top author, 0..1. */
  share: number;
  authors: number;
}

export interface RepositoryAnalysis {
  name: string;
  version?: string;
  description?: string;
  root: string;
  filesTotal: number;
  locTotal: number;
  languages: Record<string, { files: number; loc: number }>;
  entrypoints: PackageEntrypoint[];
  frameworks: string[];
  patterns: string[];
  layout: DirectoryProfile[];
  topImported: Array<{ path: string; fanIn: number }>;
  topCentral: Array<{ path: string; centrality: number }>;
  externalDependencies: Array<{ name: string; usedBy: number }>;
  hotspots: HotspotFile[];
  ownership: OwnershipRecord[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Misc shared shapes                                                  */
/* ------------------------------------------------------------------ */

/** Minimal plugin shape referenced by config; full contracts live in `plugins/`. */
export interface PluginLike {
  name: string;
  [key: string]: unknown;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}
