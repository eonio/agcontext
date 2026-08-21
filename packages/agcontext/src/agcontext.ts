import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeRepository } from "./analysis/repository.js";
import { Workspace } from "./cache/workspace.js";
import { discoverConfig } from "./config/load.js";
import { resolveConfig, validateUserConfig, type ResolvedConfig } from "./config/resolve.js";
import type { AGContextUserConfig } from "./config/schema.js";
import { fileSummary } from "./compression/summaries.js";
import { renderContext } from "./context/render.js";
import { ContextBuilder } from "./context/builder.js";
import {
  AmbiguousTargetError,
  ConfigError,
  NodeNotFoundError,
  NotIndexedError,
} from "./core/errors.js";
import {
  systemClock,
  type Clock,
  type Logger,
  type LogLevel,
  type TokenCounter,
} from "./core/interfaces.js";
import { ConsoleLogger } from "./core/logger.js";
import { clamp01 } from "./core/math.js";
import { absFromRoot, toPosix } from "./core/paths.js";
import { defaultTokenCounter } from "./core/tokens.js";
import {
  EdgeKind,
  NodeKind,
  type Candidate,
  type ContextOptions,
  type ContextPackage,
  type DoctorCheck,
  type ExplainRelation,
  type GraphNode,
  type IndexStats,
  type RepositoryAnalysis,
  type RetrievalResult,
  type RetrieveOptions,
  type RetrievedItem,
  type SymbolExplanation,
} from "./core/types.js";
import type { GraphStats } from "./graph/graph.js";
import type { CodeGraph } from "./graph/graph.js";
import { TypeScriptAnalyzer } from "./indexing/analyzer.js";
import {
  Indexer,
  loadIndexSnapshot,
  snapshotFromOutcome,
  type IndexMeta,
  type IndexSnapshot,
} from "./indexing/indexer.js";
import { scanRepository } from "./indexing/scanner.js";
import { PluginManager } from "./plugins/manager.js";
import type { AGContextPlugin } from "./plugins/types.js";
import { ProviderRegistry, type DetectedProvider } from "./providers/registry.js";
import type { LLMProvider, ProviderEnv } from "./providers/types.js";
import { Ranker } from "./ranking/ranker.js";
import { HybridRetriever } from "./retrieval/retriever.js";
import { JsonlFileSink, Telemetry, type TelemetrySummaryEntry } from "./telemetry/telemetry.js";
import { packageInfo } from "./version.js";

/**
 * Constructor options: every user-config field (flat, ergonomic) plus harness
 * injection points for embedding AGContext into other tools and tests.
 */
export interface AGContextOptions extends AGContextUserConfig {
  /** Anchor directory for config discovery and relative roots. Default: process.cwd(). */
  cwd?: string;
  /** Explicit config file path, or `false` to skip discovery entirely. */
  configFile?: string | false;
  logger?: Logger;
  /** Log level for the default logger. Default: "warn" (library), "info" (CLI). */
  logLevel?: LogLevel;
  /** Provider instance injection — overrides name-based resolution. */
  providers?: { generate?: LLMProvider; embed?: LLMProvider };
  tokenCounter?: TokenCounter;
  clock?: Clock;
  /** Environment source for provider keys (testable). Default: process.env. */
  env?: ProviderEnv;
}

export interface AGCStats {
  indexed: boolean;
  meta?: IndexMeta;
  graph?: GraphStats;
  cacheSizes: Record<string, number>;
  telemetry: Record<string, TelemetrySummaryEntry>;
  root: string;
  strategy: string;
  generateProvider?: string;
  embedProvider?: string;
  plugins: string[];
  version: string;
}

interface RuntimeState {
  config: ResolvedConfig;
  workspace: Workspace;
  logger: Logger;
  telemetry: Telemetry;
  plugins: PluginManager;
  registry: ProviderRegistry;
  generateProvider?: LLMProvider;
  embedProvider: LLMProvider;
  ranker: Ranker;
  tokenCounter: TokenCounter;
  clock: Clock;
}

/**
 * AGContext — the context engineering harness (phase 4 public API).
 *
 * ```ts
 * import { AGContext } from "@eonio/agcontext";
 *
 * const agc = new AGContext();
 * await agc.index();
 * const context = await agc.retrieve({ query: "How does authentication work?" });
 * ```
 *
 * Construction is cheap and synchronous; configuration discovery, plugin
 * loading, and provider resolution happen lazily on the first operation.
 */
export class AGContext {
  private readonly options: AGContextOptions;
  private readonly earlyPlugins: AGContextPlugin[] = [];
  private runtimePromise: Promise<RuntimeState> | undefined;
  private snapshot: IndexSnapshot | undefined;

  constructor(options: AGContextOptions = {}) {
    this.options = options;
  }

  /** Registers a plugin programmatically. Must be called before the first operation. */
  use(plugin: AGContextPlugin): this {
    if (this.runtimePromise) {
      throw new ConfigError("Register plugins before the first AGContext operation.");
    }
    this.earlyPlugins.push(plugin);
    return this;
  }

  /** The fully-resolved configuration (defaults ← file ← constructor options). */
  async resolvedConfig(): Promise<ResolvedConfig> {
    return (await this.runtime()).config;
  }

  /** Builds or updates the index (phase 5/15; incremental unless `force`). */
  async index(options: { force?: boolean } = {}): Promise<IndexStats> {
    const rt = await this.runtime();
    const indexer = new Indexer({
      config: rt.config,
      workspace: rt.workspace,
      logger: rt.logger,
      telemetry: rt.telemetry,
      analyzers: [...rt.plugins.analyzers(), new TypeScriptAnalyzer()],
      ...(rt.embedProvider.capabilities.embed ? { embedProvider: rt.embedProvider } : {}),
      clock: rt.clock,
    });
    const outcome = await indexer.run(options);
    await rt.plugins.emit("extendGraph", outcome.graph);
    await rt.plugins.emit("afterIndex", { stats: outcome.stats, graph: outcome.graph });
    this.snapshot = snapshotFromOutcome(outcome);
    await rt.telemetry.flush();
    return outcome.stats;
  }

  /** Full hybrid retrieval + multi-signal ranking (phases 7-10). */
  async retrieve(input: string | RetrieveOptions): Promise<RetrievalResult> {
    const rt = await this.runtime();
    const snapshot = await this.ensureSnapshot(rt);
    const options: RetrieveOptions = typeof input === "string" ? { query: input } : { ...input };
    await rt.plugins.emit("beforeRetrieve", { options });

    const started = performance.now();
    const retriever = new HybridRetriever({
      graph: snapshot.graph,
      chunks: snapshot.chunkMap,
      bm25: snapshot.bm25,
      ...(snapshot.embeddings ? { embeddings: snapshot.embeddings } : {}),
      ...(rt.embedProvider.capabilities.embed ? { embedProvider: rt.embedProvider } : {}),
      config: rt.config,
      logger: rt.logger,
      telemetry: rt.telemetry,
    });
    const raw = await retriever.retrieve(options.query, {
      ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
      ...(options.graphDepth !== undefined ? { graphDepth: options.graphDepth } : {}),
      ...(options.maxNodes !== undefined ? { maxNodes: options.maxNodes } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });

    /* Plugin-contributed signals. */
    const signalProviders = rt.plugins.signals();
    if (signalProviders.length > 0) {
      const signalContext = { query: options.query, graph: snapshot.graph };
      for (const candidate of raw.candidates) {
        for (const provider of signalProviders) {
          const value = provider.compute(candidate.nodeId, signalContext);
          if (typeof value === "number" && Number.isFinite(value)) {
            candidate.raw[provider.name] = clamp01(value);
          }
        }
      }
    }

    const rankStart = performance.now();
    const limit = options.limit ?? rt.config.retrieval.limit;
    let ranked = rt.ranker.rank(raw.candidates, limit);
    ranked = rt.plugins.applyReranks(ranked, options.query);
    const rankMs = performance.now() - rankStart;

    const items = ranked
      .map((candidate) => this.toRetrievedItem(candidate, snapshot, rt.config))
      .filter((item): item is RetrievedItem => item !== undefined);

    const totalMs = performance.now() - started;
    const result: RetrievalResult = {
      query: options.query,
      items,
      diagnostics: {
        ...raw.diagnostics,
        timings: { ...raw.diagnostics.timings, ranking: rankMs },
        totalMs,
      },
    };
    rt.telemetry.record("retrieval.total", {
      durationMs: totalMs,
      results: items.length,
      strategy: result.diagnostics.strategy,
    });
    await rt.plugins.emit("afterRetrieve", result);
    return result;
  }

  /**
   * Fast lexical-first lookup (no embedding call, no graph expansion).
   * Use retrieve() for full hybrid quality.
   */
  async search(input: string | RetrieveOptions): Promise<RetrievalResult> {
    const options: RetrieveOptions = typeof input === "string" ? { query: input } : { ...input };
    return this.retrieve({ ...options, strategy: "lexical" });
  }

  /** Retrieval + token-aware context assembly (phase 11). */
  async context(input: string | ContextOptions): Promise<ContextPackage> {
    const rt = await this.runtime();
    const snapshot = await this.ensureSnapshot(rt);
    const options: ContextOptions = typeof input === "string" ? { query: input } : { ...input };

    const retrieval = await this.retrieve({
      query: options.query,
      limit: options.maxNodes ?? rt.config.maxNodes,
      ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
      ...(options.graphDepth !== undefined ? { graphDepth: options.graphDepth } : {}),
      ...(options.maxNodes !== undefined ? { maxNodes: options.maxNodes } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });

    const summarizers = rt.plugins.fileSummarizers();
    const builder = new ContextBuilder({
      graph: snapshot.graph,
      chunkMap: snapshot.chunkMap,
      analyses: snapshot.analyses,
      ...(snapshot.report ? { report: snapshot.report } : {}),
      config: rt.config,
      tokenCounter: rt.tokenCounter,
      readFile: (rel) => readFile(absFromRoot(rt.config.root, rel), "utf8").catch(() => undefined),
      summarizeFile: (analysis) => {
        let summary = fileSummary(analysis);
        for (const summarizer of summarizers) {
          summary = summarizer.summarize(analysis, summary);
        }
        return summary;
      },
    });
    const pkg = await builder.build(options.query, retrieval.items, {
      strategy: retrieval.diagnostics.strategy,
      indexedAt: snapshot.meta.indexedAt,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.includeArchitecture !== undefined
        ? { includeArchitecture: options.includeArchitecture }
        : {}),
      ...(options.includeRecommendations !== undefined
        ? { includeRecommendations: options.includeRecommendations }
        : {}),
    });
    await rt.plugins.emit("beforeContext", pkg);
    rt.telemetry.record("context.build", {
      tokens: pkg.tokens.used,
      budget: pkg.tokens.budget,
      files: pkg.files.length,
      symbols: pkg.symbols.length,
    });
    return pkg;
  }

  /** context() rendered to text in the configured (or given) format. */
  async contextText(input: string | ContextOptions): Promise<string> {
    const rt = await this.runtime();
    const options: ContextOptions = typeof input === "string" ? { query: input } : { ...input };
    const pkg = await this.context(options);
    return renderContext(pkg, options.format ?? rt.config.context.format);
  }

  /** Symbol/file card: identity, relations, file summary, optional AI explanation. */
  async explain(target: string, options: { ai?: boolean } = {}): Promise<SymbolExplanation> {
    const rt = await this.runtime();
    const snapshot = await this.ensureSnapshot(rt);
    const node = this.resolveTarget(snapshot.graph, target);

    const relations: ExplainRelation[] = [];
    const collect = (direction: "in" | "out"): void => {
      const edges =
        direction === "out" ? snapshot.graph.outEdges(node.id) : snapshot.graph.inEdges(node.id);
      for (const edge of edges) {
        if (edge.kind === EdgeKind.Contains) continue;
        const otherId = direction === "out" ? edge.to : edge.from;
        const other = snapshot.graph.node(otherId);
        if (!other) continue;
        relations.push({
          kind: edge.kind,
          direction,
          nodeId: otherId,
          name: other.name,
          ...(other.file !== undefined
            ? { path: other.file }
            : other.path !== undefined
              ? { path: other.path }
              : {}),
          ...(typeof edge.meta?.variant === "string" ? { variant: edge.meta.variant } : {}),
        });
      }
    };
    collect("out");
    collect("in");
    relations.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.direction.localeCompare(b.direction) ||
        a.nodeId.localeCompare(b.nodeId),
    );

    const filePath = node.kind === NodeKind.File ? node.path : node.file;
    const analysis = filePath !== undefined ? snapshot.analyses.get(filePath) : undefined;
    const explanation: SymbolExplanation = {
      id: node.id,
      kind: node.kind,
      name: node.name,
      ...(filePath !== undefined ? { file: filePath } : {}),
      ...(node.startLine !== undefined ? { startLine: node.startLine } : {}),
      ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
      ...(node.signature !== undefined ? { signature: node.signature } : {}),
      ...(node.doc !== undefined ? { doc: node.doc } : {}),
      ...(node.exported !== undefined ? { exported: node.exported } : {}),
      metrics: node.metrics,
      relations: relations.slice(0, 24),
      ...(analysis ? { fileSummary: fileSummary(analysis) } : {}),
    };

    if (options.ai) {
      if (!rt.generateProvider) {
        throw new ConfigError(
          "No generation provider configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY (or another supported key), or pass providers.generate.",
        );
      }
      const chunk = snapshot.chunkMap.get(node.id);
      const relationText = explanation.relations
        .slice(0, 12)
        .map((r) => `- ${r.direction === "out" ? "" : "incoming "}${r.kind}: ${r.name}`)
        .join("\n");
      const prompt = [
        `Explain the ${node.kind} "${node.name}" from ${filePath ?? "this repository"} to a senior engineer new to the codebase.`,
        "Cover: purpose, key collaborators, and anything surprising. Be concise (under 200 words).",
        "",
        "Relations:",
        relationText || "- (none recorded)",
        "",
        "Source:",
        chunk?.text ?? node.signature ?? node.name,
      ].join("\n");
      const generated = await rt.generateProvider.generate({
        prompt,
        system: "You are a precise senior software engineer explaining code.",
        maxTokens: 512,
      });
      explanation.aiExplanation = generated.text;
      rt.telemetry.record("explain.generate", {
        provider: rt.generateProvider.name,
        inputTokens: generated.usage?.inputTokens ?? 0,
        outputTokens: generated.usage?.outputTokens ?? 0,
      });
    }
    return explanation;
  }

  /** Repository intelligence report (phase 6). */
  async repositoryAnalysis(): Promise<RepositoryAnalysis> {
    const rt = await this.runtime();
    const snapshot = await this.ensureSnapshot(rt);
    if (snapshot.report) return snapshot.report;
    return analyzeRepository({
      root: rt.config.root,
      graph: snapshot.graph,
      analyses: [...snapshot.analyses.values()],
      now: rt.clock.now(),
    });
  }

  /** Read access to the loaded code graph. */
  async graph(): Promise<CodeGraph> {
    const rt = await this.runtime();
    return (await this.ensureSnapshot(rt)).graph;
  }

  /** Index/cache/telemetry statistics; works without an index. */
  async stats(): Promise<AGCStats> {
    const rt = await this.runtime();
    const meta = await this.tryLoadMeta(rt);
    let graphStats: GraphStats | undefined;
    if (meta) {
      try {
        graphStats = (await this.ensureSnapshot(rt)).graph.stats();
      } catch {
        graphStats = undefined;
      }
    }
    return {
      indexed: meta !== undefined,
      ...(meta ? { meta } : {}),
      ...(graphStats ? { graph: graphStats } : {}),
      cacheSizes: await rt.workspace.sizes(),
      telemetry: rt.telemetry.summary(),
      root: rt.config.root,
      strategy: rt.config.strategy,
      ...(rt.generateProvider ? { generateProvider: rt.generateProvider.name } : {}),
      embedProvider: rt.embedProvider.name,
      plugins: rt.plugins.names,
      version: packageInfo().version,
    };
  }

  /** Environment/config/index health checks (CLI `agc doctor`). */
  async doctor(options: { network?: boolean } = {}): Promise<DoctorCheck[]> {
    const rt = await this.runtime();
    const checks: DoctorCheck[] = [];

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    checks.push({
      name: "node",
      status: nodeMajor >= 22 ? "pass" : "fail",
      detail: `Node ${process.versions.node} (>= 22 required)`,
    });

    checks.push({
      name: "config",
      status: "pass",
      detail: rt.config.configFile
        ? `loaded ${toPosix(path.relative(rt.config.root, rt.config.configFile)) || rt.config.configFile}`
        : "no config file — using defaults",
    });

    try {
      await rt.workspace.ensure();
      checks.push({ name: "cache", status: "pass", detail: rt.config.cacheDir });
    } catch (error) {
      checks.push({
        name: "cache",
        status: "fail",
        detail: `cannot create ${rt.config.cacheDir}: ${describeError(error)}`,
      });
    }

    const meta = await this.tryLoadMeta(rt);
    if (!meta) {
      checks.push({
        name: "index",
        status: "warn",
        detail: 'no index found — run "agc index"',
      });
    } else {
      const stale = await this.countStaleFiles(rt);
      checks.push({
        name: "index",
        status: stale === 0 ? "pass" : "warn",
        detail:
          `${meta.stats.files} files indexed at ${meta.indexedAt}` +
          (stale > 0 ? ` — ${stale} file(s) changed since; run "agc index"` : ""),
      });
    }

    const detected = rt.registry.detect();
    const configured = detected.filter(
      (row: DetectedProvider) => row.configured && row.name !== "local",
    );
    checks.push({
      name: "providers",
      status: "pass",
      detail:
        configured.length > 0
          ? `configured: ${configured.map((row) => row.name).join(", ")}`
          : "no API keys detected — offline mode (local embeddings, no generation)",
    });
    checks.push({
      name: "generate",
      status: rt.generateProvider ? "pass" : "warn",
      detail: rt.generateProvider
        ? `using ${rt.generateProvider.name}`
        : "no generation provider (explain --ai unavailable)",
    });
    checks.push({
      name: "embeddings",
      status: "pass",
      detail: `using ${rt.embedProvider.name}${rt.embedProvider.name === "local" ? " (offline hash embeddings)" : ""}`,
    });
    if (this.snapshot?.embeddings && this.snapshot.embeddings.provider !== rt.embedProvider.name) {
      checks.push({
        name: "embedding-index",
        status: "warn",
        detail: `index embedded with "${this.snapshot.embeddings.provider}" but "${rt.embedProvider.name}" is active — run "agc index" to rebuild`,
      });
    }

    if (rt.plugins.names.length > 0) {
      checks.push({
        name: "plugins",
        status: "pass",
        detail: rt.plugins.names.join(", "),
      });
    }

    if (options.network && rt.embedProvider.name !== "local") {
      try {
        await rt.embedProvider.embed({ texts: ["agcontext doctor ping"] });
        checks.push({
          name: "network",
          status: "pass",
          detail: `${rt.embedProvider.name} embeddings reachable`,
        });
      } catch (error) {
        checks.push({
          name: "network",
          status: "fail",
          detail: `${rt.embedProvider.name} unreachable: ${describeError(error)}`,
        });
      }
    }
    return checks;
  }

  /** Flushes telemetry sinks. Call when embedding AGContext long-term. */
  async dispose(): Promise<void> {
    if (!this.runtimePromise) return;
    const rt = await this.runtimePromise;
    await rt.telemetry.flush();
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private runtime(): Promise<RuntimeState> {
    this.runtimePromise ??= this.initialize();
    return this.runtimePromise;
  }

  private async initialize(): Promise<RuntimeState> {
    const {
      cwd: cwdOption,
      configFile,
      logger: loggerOption,
      logLevel,
      providers: providerOverrides,
      tokenCounter,
      clock: clockOption,
      env,
      ...userOverrides
    } = this.options;
    const cwd = cwdOption ?? process.cwd();
    const clock = clockOption ?? systemClock;
    const overrides = validateUserConfig(userOverrides, "constructor options");
    const discovered = await discoverConfig(cwd, configFile);
    const config = resolveConfig({
      cwd,
      ...(discovered
        ? {
            fileConfig: discovered.config,
            fileDir: path.dirname(discovered.filePath),
            configFile: discovered.filePath,
          }
        : {}),
      overrides,
    });

    const logger = loggerOption ?? new ConsoleLogger(logLevel ?? "warn");
    const workspace = new Workspace(config.root, config.cacheDir);
    const telemetry = config.telemetry.enabled
      ? new Telemetry({
          enabled: true,
          sinks: config.telemetry.file ? [new JsonlFileSink(workspace.telemetryFile)] : [],
          clock,
        })
      : Telemetry.disabled();

    const plugins = await PluginManager.load([...config.plugins, ...this.earlyPlugins], {
      config,
      logger,
      telemetry,
    });

    const registry = new ProviderRegistry(env);
    for (const provider of plugins.providers()) registry.register(provider);
    const generateProvider = providerOverrides?.generate ?? registry.resolveGenerate(config);
    const embedProvider = providerOverrides?.embed ?? registry.resolveEmbed(config);

    const ranker = new Ranker({
      mode: config.rankingMode,
      weights: { ...config.weights, ...plugins.weights() },
    });

    return {
      config,
      workspace,
      logger,
      telemetry,
      plugins,
      registry,
      ...(generateProvider ? { generateProvider } : {}),
      embedProvider,
      ranker,
      tokenCounter: tokenCounter ?? defaultTokenCounter,
      clock,
    };
  }

  private async ensureSnapshot(rt: RuntimeState): Promise<IndexSnapshot> {
    if (this.snapshot) return this.snapshot;
    const loaded = await loadIndexSnapshot(rt.workspace);
    if (!loaded) throw new NotIndexedError(rt.config.root);
    await rt.plugins.emit("extendGraph", loaded.graph);
    this.snapshot = loaded;
    return loaded;
  }

  private async tryLoadMeta(rt: RuntimeState): Promise<IndexMeta | undefined> {
    if (this.snapshot) return this.snapshot.meta;
    const loaded = await loadIndexSnapshot(rt.workspace);
    if (loaded) {
      await rt.plugins.emit("extendGraph", loaded.graph);
      this.snapshot = loaded;
    }
    return this.snapshot?.meta;
  }

  private async countStaleFiles(rt: RuntimeState): Promise<number> {
    if (!this.snapshot) return 0;
    const scanned = await scanRepository({
      root: rt.config.root,
      extensions: rt.config.extensions,
      exclude: rt.config.exclude,
      maxFileSizeBytes: rt.config.maxFileSizeBytes,
    });
    const known = this.snapshot.analyses;
    let stale = 0;
    for (const file of scanned) {
      if (!known.has(file.path)) stale++;
    }
    for (const path_ of known.keys()) {
      if (!scanned.some((file) => file.path === path_)) stale++;
    }
    return stale;
  }

  private toRetrievedItem(
    candidate: Candidate,
    snapshot: IndexSnapshot,
    config: ResolvedConfig,
  ): RetrievedItem | undefined {
    const node = snapshot.graph.node(candidate.nodeId);
    if (!node) return undefined;
    const itemPath = node.kind === NodeKind.File ? node.path : node.file;
    if (itemPath === undefined) return undefined;
    const chunk = snapshot.chunkMap.get(node.id);
    const snippetLength = config.retrieval.snippetLength;
    const snippet =
      chunk && snippetLength > 0
        ? chunk.text.length > snippetLength
          ? `${chunk.text.slice(0, snippetLength)}…`
          : chunk.text
        : undefined;
    return {
      nodeId: node.id,
      kind: node.kind,
      name: node.name,
      path: itemPath,
      ...(node.startLine !== undefined ? { startLine: node.startLine } : {}),
      ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
      ...(node.signature !== undefined ? { signature: node.signature } : {}),
      ...(node.doc !== undefined ? { doc: node.doc } : {}),
      score: Math.round(candidate.score * 10_000) / 10_000,
      signals: candidate.signals,
      sources: candidate.sources,
      ...(candidate.depth !== undefined ? { depth: candidate.depth } : {}),
      ...(snippet !== undefined ? { snippet } : {}),
    };
  }

  private resolveTarget(graph: CodeGraph, target: string): GraphNode {
    const direct = graph.node(target);
    if (direct) return direct;

    const named = graph
      .findByName(target)
      .filter((node) => node.kind === NodeKind.File || node.file !== undefined);
    if (named.length === 1) return named[0] as GraphNode;
    if (named.length > 1) {
      throw new AmbiguousTargetError(target, named.map((node) => node.id).sort());
    }

    const normalized = toPosix(target).replace(/^\.\//, "");
    const fileNode = graph.fileNode(normalized);
    if (fileNode) return fileNode;
    const suffixMatches: GraphNode[] = [];
    for (const node of graph.allNodes()) {
      if (node.kind !== NodeKind.File || node.path === undefined) continue;
      if (node.path === normalized || node.path.endsWith(`/${normalized}`)) {
        suffixMatches.push(node);
      }
    }
    if (suffixMatches.length === 1) return suffixMatches[0] as GraphNode;
    if (suffixMatches.length > 1) {
      throw new AmbiguousTargetError(target, suffixMatches.map((node) => node.id).sort());
    }
    throw new NodeNotFoundError(target);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
