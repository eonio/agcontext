import type { ResolvedConfig } from "../config/resolve.js";
import type { Logger } from "../core/interfaces.js";
import type {
  Candidate,
  ContextPackage,
  IndexStats,
  PluginLike,
  RetrievalResult,
  RetrieveOptions,
} from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";
import type { FileAnalysis, SourceAnalyzer } from "../indexing/analyzer.js";
import type { LLMProvider } from "../providers/types.js";
import type { Telemetry } from "../telemetry/telemetry.js";

/**
 * Plugin system contracts (phase 17). A plugin declares capabilities
 * declaratively (`graph`, `ranking`, `compression`, `providers`, `hooks`)
 * and/or registers them imperatively in `setup()`. The named plugin types
 * below are refinements of {@link AGContextPlugin} that require their
 * capability block — use them for precise typing of focused plugins.
 */

export interface SignalContext {
  query: string;
  graph: CodeGraph;
}

/** A custom ranking signal; values must land in [0, 1]. */
export interface SignalProvider {
  name: string;
  /** Relative weight merged into the ranking weights. Default: 0.05. */
  weight?: number;
  compute(nodeId: string, context: SignalContext): number | undefined;
}

/** Overrides the compressed file view used by the context builder. */
export interface FileSummarizer {
  summarize(analysis: FileAnalysis, defaultSummary: string): string;
}

export interface PluginHooks {
  /** After an index run completes (graph is final, metrics applied). */
  afterIndex: (payload: { stats: IndexStats; graph: CodeGraph }) => void | Promise<void>;
  /** After graph load/build — add custom nodes/edges here. */
  extendGraph: (graph: CodeGraph) => void | Promise<void>;
  /** Before retrieval; `options` is mutable (adjust strategy, depth, limits). */
  beforeRetrieve: (payload: { options: RetrieveOptions }) => void | Promise<void>;
  /** After ranking; result items are mutable. */
  afterRetrieve: (result: RetrievalResult) => void | Promise<void>;
  /** Before the context package is returned; package is mutable. */
  beforeContext: (pkg: ContextPackage) => void | Promise<void>;
}

export interface PluginContext {
  readonly config: ResolvedConfig;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
  registerAnalyzer(analyzer: SourceAnalyzer): void;
  registerSignal(signal: SignalProvider): void;
  registerProvider(provider: LLMProvider): void;
  registerFileSummarizer(summarizer: FileSummarizer): void;
  on<K extends keyof PluginHooks>(hook: K, handler: PluginHooks[K]): void;
}

export interface AGContextPlugin extends PluginLike {
  name: string;
  version?: string;
  /** Imperative setup with full registration access. */
  setup?(context: PluginContext): void | Promise<void>;
  /** Declarative graph capabilities: extra language analyzers, graph extension. */
  graph?: {
    analyzers?: SourceAnalyzer[];
    extend?: (graph: CodeGraph) => void | Promise<void>;
  };
  /** Declarative ranking capabilities: signals, weight overrides, reranking. */
  ranking?: {
    signals?: SignalProvider[];
    weights?: Record<string, number>;
    rerank?: (candidates: Candidate[], query: string) => Candidate[];
  };
  /** Declarative compression capability: custom file summarizer. */
  compression?: {
    fileSummarizer?: FileSummarizer;
  };
  /** Custom LLM providers, addressable via config `provider: "<name>"`. */
  providers?: LLMProvider[];
  hooks?: Partial<PluginHooks>;
}

export type GraphPlugin = AGContextPlugin & { graph: NonNullable<AGContextPlugin["graph"]> };
export type RankingPlugin = AGContextPlugin & {
  ranking: NonNullable<AGContextPlugin["ranking"]>;
};
export type CompressionPlugin = AGContextPlugin & {
  compression: NonNullable<AGContextPlugin["compression"]>;
};
export type ProviderPlugin = AGContextPlugin & { providers: LLMProvider[] };

/** Type-safe plugin author helper (mirrors defineConfig). */
export function definePlugin<T extends AGContextPlugin>(plugin: T): T {
  return plugin;
}
