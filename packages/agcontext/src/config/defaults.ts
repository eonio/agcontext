import { EdgeKind, type SignalWeights } from "../core/types.js";

/**
 * Default ranking weights (phase 10). Relative values; the ranker renormalizes
 * over the signals actually available for a given query, so a repository
 * without embeddings or git history is not penalized.
 */
export const DEFAULT_WEIGHTS: SignalWeights = {
  semantic: 0.28,
  lexical: 0.18,
  graph: 0.2,
  centrality: 0.07,
  importance: 0.07,
  usage: 0.06,
  activity: 0.04,
  recency: 0.04,
  dependency: 0.06,
};

/**
 * Default per-edge-kind traversal weights (phase 8). Call edges carry the most
 * behavioral relevance; structural containment carries the least.
 */
export const DEFAULT_EDGE_WEIGHTS: Record<EdgeKind, number> = {
  [EdgeKind.Calls]: 1.0,
  [EdgeKind.Inheritance]: 0.9,
  [EdgeKind.Composition]: 0.8,
  [EdgeKind.Imports]: 0.7,
  [EdgeKind.References]: 0.6,
  [EdgeKind.Exports]: 0.5,
  [EdgeKind.Contains]: 0.4,
};

export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Directories and files never worth indexing, applied before .gitignore. */
export const DEFAULT_IGNORES = [
  ".git/",
  ".agcontext/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  ".cache/",
  ".output/",
  "vendor/",
  "tmp/",
  "*.min.js",
  "*.bundle.js",
  "*.d.ts",
  "*.d.mts",
  "*.d.cts",
  "*.map",
] as const;

export const DEFAULT_MAX_FILE_SIZE_BYTES = 1_572_864; // 1.5 MB

export const DEFAULT_CACHE_DIRNAME = ".agcontext";

/** Version stamp for every persisted store; bump to force re-index on upgrade. */
export const CACHE_SCHEMA_VERSION = 1;
