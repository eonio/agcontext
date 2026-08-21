import { defineConfig } from "@eonio/agcontext";

/**
 * A fully tuned configuration. Every value shown here has a sensible
 * default — override only what your repository needs.
 */
export default defineConfig({
  /* Repository shape */
  root: ".",
  exclude: ["generated/", "**/*.gen.ts"],
  maxFileSizeBytes: 1_048_576,

  /* Retrieval behavior */
  strategy: "hybrid", // hybrid | graph | lexical | semantic
  graphDepth: 3, // deeper expansion for a heavily-layered codebase
  maxNodes: 60,
  retrieval: { limit: 25, candidateLimit: 150, snippetLength: 200 },

  /* Graph expansion guards */
  expansion: {
    traversalBudget: 500,
    minScore: 0.04,
    decay: 0.65,
    hubDegreeLimit: 96, // this repo has big barrels
    edgeWeights: { calls: 1.0, imports: 0.6 },
  },

  /* Ranking: lean harder on structure for this monolith */
  ranking: "hybrid",
  weights: {
    semantic: 0.25,
    lexical: 0.15,
    graph: 0.28,
    centrality: 0.08,
    importance: 0.08,
    usage: 0.06,
    dependency: 0.06,
    activity: 0.02,
    recency: 0.02,
  },

  /* Providers */
  provider: "anthropic", // explain --ai via Claude
  embeddingProvider: "openai", // requires OPENAI_API_KEY
  models: {
    generate: "claude-haiku-4-5-20251001",
    embed: "text-embedding-3-small",
  },

  /* Context assembly */
  context: {
    maxTokens: 16_000,
    format: "xml", // Claude-friendly tagged output
    maxFileTokens: 2_500,
    maxSymbolTokens: 1_000,
  },

  /* Git signals over a shorter, busier window */
  git: { enabled: true, windowDays: 90, maxCommits: 5000 },

  /* Local-only telemetry for latency tracking */
  telemetry: { enabled: true, file: true },

  /* Plugins */
  plugins: ["../custom-plugin/hot-files-plugin.mjs"],
});
