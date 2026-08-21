/**
 * @eonio/agcontext — Augmented Context.
 *
 * A context engineering harness for AI coding agents: code graphs, hybrid
 * retrieval, repository compression, multi-signal ranking, and token-aware
 * context assembly.
 *
 * ```ts
 * import { AGContext } from "@eonio/agcontext";
 *
 * const agc = new AGContext();
 * await agc.index();
 * const context = await agc.retrieve({ query: "How does authentication work?" });
 * ```
 */

/* Facade */
export { AGContext, type AGContextOptions, type AGCStats } from "./agcontext.js";
export { packageInfo } from "./version.js";

/* Configuration */
export { defineConfig } from "./config/define-config.js";
export type { AGContextUserConfig, ProviderName, RankingMode } from "./config/schema.js";
export { userConfigSchema } from "./config/schema.js";
export {
  resolveConfig,
  validateUserConfig,
  mergeUserConfigs,
  type ResolvedConfig,
} from "./config/resolve.js";
export { discoverConfig, findConfigFile, loadConfigFile, CONFIG_FILENAMES } from "./config/load.js";
export {
  DEFAULT_WEIGHTS,
  DEFAULT_EDGE_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORES,
  CACHE_SCHEMA_VERSION,
} from "./config/defaults.js";

/* Core domain model */
export * from "./core/types.js";
export * from "./core/errors.js";
export type { Logger, LogLevel, TokenCounter, Clock } from "./core/interfaces.js";
export { systemClock } from "./core/interfaces.js";
export { ConsoleLogger, silentLogger } from "./core/logger.js";
export {
  HeuristicTokenCounter,
  defaultTokenCounter,
  estimateTokens,
  CHARS_PER_TOKEN,
} from "./core/tokens.js";
export { tokenize, splitIdentifier, CODE_STOPWORDS } from "./core/text.js";
export { minMaxScaler, logMinMaxScaler, halfLifeDecay, clamp01 } from "./core/math.js";

/* Code graph */
export { CodeGraph, type GraphJSON, type GraphStats, type AddEdgeInput } from "./graph/graph.js";
export {
  buildGraph,
  fileNodeId,
  symbolNodeId,
  dirNodeId,
  moduleNodeId,
  REPO_NODE_ID,
  SYMBOL_KIND_MAP,
  type BuildGraphInput,
} from "./graph/builder.js";
export {
  expandFromSeeds,
  type ExpansionOptions,
  type ExpansionSeed,
  type ExpandedNode,
  type ExpansionResult,
} from "./graph/traversal.js";
export {
  computePageRank,
  applyGraphMetrics,
  pathHeuristicScore,
  type MetricsInput,
  type PageRankOptions,
} from "./graph/metrics.js";

/* Indexing */
export {
  TypeScriptAnalyzer,
  ANALYZER_VERSION,
  type FileAnalysis,
  type SymbolInfo,
  type SourceAnalyzer,
  type FileImport,
  type ImportBinding,
  type ReexportInfo,
  type ReexportedName,
  type ExportBinding,
  type CallRef,
  type SymbolKindName,
} from "./indexing/analyzer.js";
export { scanRepository, type ScannedFile, type ScanOptions } from "./indexing/scanner.js";
export { buildFileChunks, type ChunkOptions } from "./indexing/chunker.js";
export {
  collectGitStats,
  type GitStats,
  type FileGitStats,
  type GitOptions,
} from "./indexing/git.js";
export {
  Indexer,
  loadIndexSnapshot,
  snapshotFromOutcome,
  type IndexerDeps,
  type IndexOutcome,
  type IndexMeta,
  type IndexSnapshot,
} from "./indexing/indexer.js";

/* Repository analysis */
export {
  analyzeRepository,
  packageEntrypointPaths,
  type RepositoryAnalyzerInput,
} from "./analysis/repository.js";

/* Retrieval */
export { BM25Index, type Bm25Hit, type Bm25Options } from "./retrieval/bm25.js";
export {
  EmbeddingIndex,
  type EmbeddingHit,
  type EmbeddingIndexJSON,
} from "./retrieval/embedding-index.js";
export { parseQuery, type ParsedQuery } from "./retrieval/query.js";
export {
  HybridRetriever,
  type RetrieverDeps,
  type RetrieveStageOptions,
  type RawRetrieval,
} from "./retrieval/retriever.js";

/* Ranking */
export { Ranker, type RankerOptions } from "./ranking/ranker.js";

/* Compression */
export { fileSummary, symbolSummary } from "./compression/summaries.js";
export { architectureSummary } from "./compression/architecture.js";
export { dependencySummary } from "./compression/dependencies.js";

/* Context assembly */
export {
  ContextBuilder,
  type ContextBuilderDeps,
  type BuildContextOptions,
} from "./context/builder.js";
export { renderContext, renderMarkdown, renderXml, renderJson } from "./context/render.js";
export { buildRecommendations, type RecommendationInput } from "./context/recommendations.js";

/* Providers */
export type {
  LLMProvider,
  GenerateRequest,
  GenerateResult,
  EmbedRequest,
  EmbedResult,
  ProviderCapabilities,
  ProviderInit,
  ProviderEnv,
  TokenUsage,
} from "./providers/types.js";
export { processEnv } from "./providers/types.js";
export { LocalProvider, LOCAL_EMBED_DIM, LOCAL_EMBED_MODEL } from "./providers/local.js";
export {
  OpenAIProvider,
  OPENAI_DEFAULT_GENERATE_MODEL,
  OPENAI_DEFAULT_EMBED_MODEL,
} from "./providers/openai.js";
export { AnthropicProvider, ANTHROPIC_DEFAULT_GENERATE_MODEL } from "./providers/anthropic.js";
export { AzureOpenAIProvider, type AzureProviderInit } from "./providers/azure-openai.js";
export {
  GoogleProvider,
  GOOGLE_DEFAULT_GENERATE_MODEL,
  GOOGLE_DEFAULT_EMBED_MODEL,
} from "./providers/google.js";
export { OpenRouterProvider, OPENROUTER_DEFAULT_GENERATE_MODEL } from "./providers/openrouter.js";
export { ProviderRegistry, type DetectedProvider } from "./providers/registry.js";

/* Plugins */
export * from "./plugins/types.js";
export { PluginManager, type PluginManagerBase } from "./plugins/manager.js";

/* Telemetry */
export {
  Telemetry,
  MemorySink,
  JsonlFileSink,
  type TelemetryEvent,
  type TelemetrySink,
  type TelemetrySummaryEntry,
  type TelemetryFieldValue,
} from "./telemetry/telemetry.js";

/* Cache workspace */
export { Workspace } from "./cache/workspace.js";
export { readJsonStore, writeJsonStore } from "./cache/json-store.js";

/* CLI (programmatic use) */
export {
  runCli,
  buildProgram,
  defaultCreateApp,
  type CliContext,
  type GlobalCliOptions,
} from "./cli/program.js";
export { processIO, CliFailure, type CliIO } from "./cli/io.js";
