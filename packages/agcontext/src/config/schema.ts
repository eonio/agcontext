import { z } from "zod";
import type { ContextFormat, PluginLike, RetrievalStrategy, SignalName } from "../core/types.js";

export type { ContextFormat };

/** How the multi-signal ranker fuses scores. `"hybrid"` is an alias of `"weighted"`. */
export type RankingMode = "hybrid" | "weighted" | "rrf";

/**
 * Built-in provider names, plus any custom name registered by a
 * ProviderPlugin (hence the open string union).
 */
export type ProviderName =
  "auto" | "openai" | "anthropic" | "azure" | "google" | "openrouter" | "local" | (string & {});

/**
 * User-facing configuration. Flat, ergonomic keys (`graphDepth`, `maxNodes`,
 * `strategy`, `provider`, `ranking`) cover the common cases; nested groups
 * expose the full surface. Everything is optional — defaults are production
 * quality out of the box.
 */
export interface AGContextUserConfig {
  /** Repository root, relative to the config file (or cwd). Default: ".". */
  root?: string;
  /** File extensions to index. Default: TS/JS family. */
  extensions?: string[];
  /** Extra gitignore-style exclude patterns (on top of .gitignore + built-ins). */
  exclude?: string[];
  /** Skip files larger than this. Default: 1.5 MB. */
  maxFileSizeBytes?: number;

  /** Maximum graph expansion depth from retrieval seeds. Default: 2. */
  graphDepth?: number;
  /** Maximum nodes returned by retrieval. Default: 50. */
  maxNodes?: number;
  /** Retrieval strategy. Default: "hybrid". */
  strategy?: RetrievalStrategy;
  /** Ranking fusion mode. Default: "hybrid" (weighted multi-signal). */
  ranking?: RankingMode;
  /** Generation provider. Default: "auto" (first configured key wins). */
  provider?: ProviderName;
  /** Embedding provider. Default: "auto" (falls back to the offline "local" provider). */
  embeddingProvider?: ProviderName;
  /** Model overrides per capability. */
  models?: { generate?: string; embed?: string };

  /** Ranking signal weight overrides (relative; renormalized to sum to 1). */
  weights?: Partial<Record<SignalName, number>>;

  /** Graph expansion guards (phase 8: preventing graph explosion). */
  expansion?: {
    /** Max nodes visited during traversal. Default: 300. */
    traversalBudget?: number;
    /** Propagated score below which a frontier is not expanded. Default: 0.05. */
    minScore?: number;
    /** Per-hop score decay factor. Default: 0.6. */
    decay?: number;
    /** Nodes with degree above this are included but never expanded. Default: 64. */
    hubDegreeLimit?: number;
    /** Per-edge-kind traversal weights (0..1). */
    edgeWeights?: Partial<Record<string, number>>;
  };

  retrieval?: {
    /** Result list size for retrieve(). Default: 20. */
    limit?: number;
    /** Candidates per lexical/semantic stage before fusion. Default: 100. */
    candidateLimit?: number;
    /** Snippet length in characters. Default: 240. */
    snippetLength?: number;
  };

  context?: {
    /** Token budget for assembled context. Default: 12000. */
    maxTokens?: number;
    /** Output format. Default: "markdown". */
    format?: ContextFormat;
    /** Max tokens for a single full-file inclusion. Default: 2000. */
    maxFileTokens?: number;
    /** Max tokens for a single full-symbol inclusion. Default: 800. */
    maxSymbolTokens?: number;
    includeArchitecture?: boolean;
    includeRecommendations?: boolean;
  };

  cache?: {
    /** Cache directory. Default: "<root>/.agcontext". */
    dir?: string;
  };

  telemetry?: {
    /** Master switch. Default: false — telemetry is opt-in. */
    enabled?: boolean;
    /** Also persist events to .agcontext/telemetry/events.jsonl. Default: false. */
    file?: boolean;
  };

  git?: {
    /** Collect git activity signals. Default: true (no-op outside a repo). */
    enabled?: boolean;
    /** History window in days. Default: 180. */
    windowDays?: number;
    /** Max commits parsed. Default: 2000. */
    maxCommits?: number;
  };

  /** Plugins: objects, or module specifiers resolved with dynamic import. */
  plugins?: Array<string | PluginLike>;
}

const signalNames = [
  "semantic",
  "lexical",
  "graph",
  "centrality",
  "importance",
  "activity",
  "recency",
  "dependency",
  "usage",
] as const;

const weightsShape = Object.fromEntries(
  signalNames.map((name) => [name, z.number().min(0).max(100).optional()]),
) as Record<SignalName, z.ZodOptional<z.ZodNumber>>;

export const userConfigSchema = z.object({
  root: z.string().min(1).optional(),
  extensions: z.array(z.string().regex(/^\./, "extensions must start with '.'")).optional(),
  exclude: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().int().min(1024).optional(),
  graphDepth: z.number().int().min(0).max(6).optional(),
  maxNodes: z.number().int().min(1).max(1000).optional(),
  strategy: z.enum(["hybrid", "graph", "lexical", "semantic"]).optional(),
  ranking: z.enum(["hybrid", "weighted", "rrf"]).optional(),
  provider: z.string().min(1).optional(),
  embeddingProvider: z.string().min(1).optional(),
  models: z.object({ generate: z.string().optional(), embed: z.string().optional() }).optional(),
  weights: z.object(weightsShape).optional(),
  expansion: z
    .object({
      traversalBudget: z.number().int().min(1).max(100_000).optional(),
      minScore: z.number().min(0).max(1).optional(),
      decay: z.number().gt(0).max(1).optional(),
      hubDegreeLimit: z.number().int().min(1).optional(),
      edgeWeights: z.record(z.string(), z.number().min(0).max(1)).optional(),
    })
    .optional(),
  retrieval: z
    .object({
      limit: z.number().int().min(1).max(500).optional(),
      candidateLimit: z.number().int().min(1).max(5000).optional(),
      snippetLength: z.number().int().min(0).max(4000).optional(),
    })
    .optional(),
  context: z
    .object({
      maxTokens: z.number().int().min(256).optional(),
      format: z.enum(["markdown", "xml", "json"]).optional(),
      maxFileTokens: z.number().int().min(64).optional(),
      maxSymbolTokens: z.number().int().min(32).optional(),
      includeArchitecture: z.boolean().optional(),
      includeRecommendations: z.boolean().optional(),
    })
    .optional(),
  cache: z.object({ dir: z.string().min(1).optional() }).optional(),
  telemetry: z.object({ enabled: z.boolean().optional(), file: z.boolean().optional() }).optional(),
  git: z
    .object({
      enabled: z.boolean().optional(),
      windowDays: z.number().int().min(1).max(3650).optional(),
      maxCommits: z.number().int().min(1).max(100_000).optional(),
    })
    .optional(),
  plugins: z
    .array(
      z.union([
        z.string().min(1),
        z.custom<PluginLike>(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { name?: unknown }).name === "string",
          { message: "plugin objects must have a string `name`" },
        ),
      ]),
    )
    .optional(),
});
