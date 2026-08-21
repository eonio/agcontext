import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeRepository, packageEntrypointPaths } from "../analysis/repository.js";
import { readJsonStore, writeJsonStore } from "../cache/json-store.js";
import type { Workspace } from "../cache/workspace.js";
import { CACHE_SCHEMA_VERSION } from "../config/defaults.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { mapWithConcurrency } from "../core/async.js";
import { sha1Hex } from "../core/hash.js";
import type { Clock, Logger } from "../core/interfaces.js";
import type { Chunk, IndexStats, RepositoryAnalysis } from "../core/types.js";
import { buildGraph } from "../graph/builder.js";
import { CodeGraph, type GraphJSON } from "../graph/graph.js";
import { applyGraphMetrics } from "../graph/metrics.js";
import type { LLMProvider } from "../providers/types.js";
import { BM25Index } from "../retrieval/bm25.js";
import { EmbeddingIndex, type EmbeddingIndexJSON } from "../retrieval/embedding-index.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import { ANALYZER_VERSION, type FileAnalysis, type SourceAnalyzer } from "./analyzer.js";
import { buildFileChunks } from "./chunker.js";
import { collectGitStats, type GitStats } from "./git.js";
import { scanRepository, type ScannedFile } from "./scanner.js";

const EMBED_BATCH_SIZE = 64;
const EMBED_CONCURRENCY = 4;
const IO_CONCURRENCY = 16;

export interface IndexerDeps {
  config: ResolvedConfig;
  workspace: Workspace;
  logger: Logger;
  telemetry: Telemetry;
  /** Ordered by priority; the first analyzer claiming an extension wins. */
  analyzers: SourceAnalyzer[];
  embedProvider?: LLMProvider;
  clock: Clock;
}

export interface IndexOutcome {
  stats: IndexStats;
  graph: CodeGraph;
  chunks: Chunk[];
  analyses: FileAnalysis[];
  embeddings?: EmbeddingIndex;
  report: RepositoryAnalysis;
}

export interface IndexMeta {
  indexedAt: string;
  durationMs: number;
  stats: IndexStats;
  configFingerprint: string;
}

interface StoredFileEntry {
  size: number;
  mtimeMs: number;
  hash: string;
  analysis: FileAnalysis;
}

interface AnalysesStore {
  analyzerVersion: number;
  files: Record<string, StoredFileEntry>;
}

interface ChunksStore {
  files: Record<string, { hash: string; chunks: Chunk[] }>;
}

/** Everything retrieval needs, loaded from the persisted index. */
export interface IndexSnapshot {
  meta: IndexMeta;
  graph: CodeGraph;
  chunks: Chunk[];
  chunkMap: Map<string, Chunk>;
  analyses: Map<string, FileAnalysis>;
  bm25: BM25Index;
  embeddings?: EmbeddingIndex;
  report?: RepositoryAnalysis;
}

/**
 * Index orchestrator (phases 5, 6, 15). Incrementality is layered:
 *
 * - files unchanged by (size, mtime) skip hashing entirely;
 * - files unchanged by content hash reuse their cached AST analysis and
 *   chunks (parsing is the expensive step);
 * - the graph is fully relinked from the (mostly cached) analyses, because
 *   cross-file edges can change when any file changes and linking is cheap;
 * - embeddings are re-computed only for chunks whose content hash changed.
 */
export class Indexer {
  constructor(private readonly deps: IndexerDeps) {}

  async run(options: { force?: boolean } = {}): Promise<IndexOutcome> {
    const { config, workspace, logger, telemetry, clock } = this.deps;
    const started = performance.now();
    const now = clock.now();
    await workspace.ensure();

    const [scanned, gitStats, entrypoints] = await Promise.all([
      scanRepository({
        root: config.root,
        extensions: config.extensions,
        exclude: config.exclude,
        maxFileSizeBytes: config.maxFileSizeBytes,
      }),
      config.git.enabled
        ? collectGitStats(config.root, config.git)
        : Promise.resolve<GitStats>({ available: false, files: new Map() }),
      packageEntrypointPaths(config.root),
    ]);
    logger.debug(`scanned ${scanned.length} files`);

    const configFingerprint = sha1Hex(
      JSON.stringify({
        extensions: config.extensions,
        exclude: config.exclude,
        maxFileSizeBytes: config.maxFileSizeBytes,
        analyzerVersion: ANALYZER_VERSION,
      }),
    );
    const prevMeta = options.force
      ? undefined
      : await readJsonStore<IndexMeta>(workspace.metaFile, CACHE_SCHEMA_VERSION);
    const incrementalBase =
      prevMeta !== undefined && prevMeta.configFingerprint === configFingerprint;

    const prevAnalysesStore = incrementalBase
      ? await readJsonStore<AnalysesStore>(workspace.analysesFile, CACHE_SCHEMA_VERSION)
      : undefined;
    const prevFiles =
      prevAnalysesStore?.analyzerVersion === ANALYZER_VERSION ? prevAnalysesStore.files : {};
    const prevChunks = incrementalBase
      ? ((await readJsonStore<ChunksStore>(workspace.chunksFile, CACHE_SCHEMA_VERSION))?.files ??
        {})
      : {};

    /* Per-file analysis with layered change detection. */
    const warnings: string[] = [];
    let added = 0;
    let changed = 0;
    const processed = await mapWithConcurrency(scanned, IO_CONCURRENCY, (file) =>
      this.processFile(file, prevFiles[file.path], prevChunks[file.path], warnings),
    );

    const nextFiles: Record<string, StoredFileEntry> = {};
    const nextChunks: Record<string, { hash: string; chunks: Chunk[] }> = {};
    for (const result of processed) {
      if (!result) continue;
      nextFiles[result.path] = result.entry;
      nextChunks[result.path] = result.chunkEntry;
      if (result.change === "added") added++;
      else if (result.change === "changed") changed++;
    }
    const scannedPaths = new Set(scanned.map((file) => file.path));
    const removed = Object.keys(prevFiles).filter((p) => !scannedPaths.has(p)).length;

    const orderedPaths = Object.keys(nextFiles).sort();
    const analyses = orderedPaths.map((p) => (nextFiles[p] as StoredFileEntry).analysis);

    /* Graph build + metrics. */
    const graph = buildGraph({ rootName: path.basename(config.root), analyses });
    applyGraphMetrics(graph, {
      ...(gitStats.available ? { gitStats } : {}),
      fileMtimes: new Map(scanned.map((file) => [file.path, file.mtimeMs])),
      entrypoints,
      now,
    });

    /* Chunks (deterministic order: by path, then id). */
    const chunks: Chunk[] = [];
    for (const p of orderedPaths) {
      chunks.push(...(nextChunks[p] as { chunks: Chunk[] }).chunks);
    }

    /* Embeddings. */
    const embeddings = await this.buildEmbeddings(chunks, incrementalBase, warnings);

    /* Repository intelligence. */
    const report = await analyzeRepository({
      root: config.root,
      graph,
      analyses,
      ...(gitStats.available ? { gitStats } : {}),
      now,
    });

    const durationMs = performance.now() - started;
    const stats: IndexStats = {
      files: analyses.length,
      symbols: analyses.reduce((sum, analysis) => sum + analysis.symbols.length, 0),
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
      chunks: chunks.length,
      embeddedChunks: embeddings?.size ?? 0,
      addedFiles: added,
      changedFiles: changed,
      removedFiles: removed,
      incremental: incrementalBase,
      durationMs: Math.round(durationMs),
      indexedAt: new Date(now).toISOString(),
      warnings,
    };

    /* Persist every store atomically. */
    const meta: IndexMeta = {
      indexedAt: stats.indexedAt,
      durationMs: stats.durationMs,
      stats,
      configFingerprint,
    };
    await Promise.all([
      writeJsonStore(workspace.analysesFile, CACHE_SCHEMA_VERSION, {
        analyzerVersion: ANALYZER_VERSION,
        files: nextFiles,
      } satisfies AnalysesStore),
      writeJsonStore(workspace.chunksFile, CACHE_SCHEMA_VERSION, {
        files: nextChunks,
      } satisfies ChunksStore),
      writeJsonStore(workspace.graphFile, CACHE_SCHEMA_VERSION, graph.toJSON()),
      writeJsonStore(workspace.analysisFile, CACHE_SCHEMA_VERSION, report),
      embeddings
        ? writeJsonStore(workspace.embeddingsFile, CACHE_SCHEMA_VERSION, embeddings.toJSON())
        : Promise.resolve(),
    ]);
    await writeJsonStore(workspace.metaFile, CACHE_SCHEMA_VERSION, meta);

    telemetry.record("index.run", {
      durationMs: stats.durationMs,
      files: stats.files,
      nodes: stats.nodes,
      edges: stats.edges,
      chunks: stats.chunks,
      embedded: stats.embeddedChunks,
      incremental: stats.incremental,
    });
    logger.info(
      `indexed ${stats.files} files → ${stats.nodes} nodes, ${stats.edges} edges in ${stats.durationMs}ms` +
        (stats.incremental ? ` (incremental: +${added} ~${changed} -${removed})` : ""),
    );

    return {
      stats,
      graph,
      chunks,
      analyses,
      ...(embeddings ? { embeddings } : {}),
      report,
    };
  }

  private async processFile(
    file: ScannedFile,
    prev: StoredFileEntry | undefined,
    prevChunk: { hash: string; chunks: Chunk[] } | undefined,
    warnings: string[],
  ): Promise<
    | {
        path: string;
        entry: StoredFileEntry;
        chunkEntry: { hash: string; chunks: Chunk[] };
        change: "added" | "changed" | "unchanged";
      }
    | undefined
  > {
    /* Fast path: size+mtime unchanged and chunks cached → no read at all. */
    if (
      prev &&
      prev.size === file.size &&
      prev.mtimeMs === file.mtimeMs &&
      prevChunk &&
      prevChunk.hash === prev.hash
    ) {
      return { path: file.path, entry: prev, chunkEntry: prevChunk, change: "unchanged" };
    }

    let content: string;
    try {
      content = await readFile(file.absPath, "utf8");
    } catch {
      warnings.push(`could not read ${file.path}`);
      return undefined;
    }
    const hash = sha1Hex(content);

    let entry: StoredFileEntry;
    let change: "added" | "changed" | "unchanged";
    if (prev && prev.hash === hash) {
      entry = { size: file.size, mtimeMs: file.mtimeMs, hash, analysis: prev.analysis };
      change = "unchanged";
    } else {
      const analyzer = this.analyzerFor(file.path);
      if (!analyzer) return undefined;
      const analysis = analyzer.analyze(file.path, content);
      if (!analysis) {
        warnings.push(`failed to analyze ${file.path}`);
        return undefined;
      }
      entry = { size: file.size, mtimeMs: file.mtimeMs, hash, analysis };
      change = prev ? "changed" : "added";
    }

    const chunkEntry =
      prevChunk && prevChunk.hash === hash
        ? prevChunk
        : { hash, chunks: buildFileChunks(entry.analysis, content) };
    return { path: file.path, entry, chunkEntry, change };
  }

  private analyzerFor(filePath: string): SourceAnalyzer | undefined {
    const dot = filePath.lastIndexOf(".");
    const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
    for (const analyzer of this.deps.analyzers) {
      if (analyzer.extensions.includes(ext)) return analyzer;
    }
    return undefined;
  }

  private async buildEmbeddings(
    chunks: readonly Chunk[],
    incrementalBase: boolean,
    warnings: string[],
  ): Promise<EmbeddingIndex | undefined> {
    const { workspace, logger, config, telemetry } = this.deps;
    const provider = this.deps.embedProvider;
    if (!provider || !provider.capabilities.embed) return undefined;

    const modelId = provider.embedModel ?? config.models.embed ?? "default";
    const prevJson = incrementalBase
      ? await readJsonStore<EmbeddingIndexJSON>(workspace.embeddingsFile, CACHE_SCHEMA_VERSION)
      : undefined;
    let index: EmbeddingIndex | undefined =
      prevJson && prevJson.provider === provider.name && prevJson.model === modelId
        ? EmbeddingIndex.fromJSON(prevJson)
        : undefined;

    const pending = chunks.filter((chunk) => !index?.has(chunk.id, chunk.hash));
    if (pending.length > 0) {
      const batches: Chunk[][] = [];
      for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
        batches.push(pending.slice(i, i + EMBED_BATCH_SIZE));
      }
      const embedBatch = async (batch: Chunk[]): Promise<void> => {
        const result = await provider.embed({
          texts: batch.map((chunk) => `// ${chunk.file} ${chunk.name}\n${chunk.text}`),
        });
        index ??= new EmbeddingIndex(provider.name, modelId, result.dim);
        batch.forEach((chunk, i) => {
          const vector = result.vectors[i];
          if (vector) (index as EmbeddingIndex).set(chunk.id, chunk.hash, vector);
        });
        if (result.usage?.inputTokens !== undefined) {
          telemetry.record("index.embed.batch", {
            chunks: batch.length,
            inputTokens: result.usage.inputTokens,
          });
        }
      };
      try {
        // First batch alone (it may create the index and fix the dimension),
        // remaining batches with bounded concurrency.
        await embedBatch(batches[0] as Chunk[]);
        await mapWithConcurrency(batches.slice(1), EMBED_CONCURRENCY, embedBatch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`embeddings incomplete: ${message}`);
        logger.warn(
          `Embedding pass failed after ${index?.size ?? 0} chunks (${message}). ` +
            "Lexical and graph retrieval remain fully functional.",
        );
      }
    }

    index?.prune(new Set(chunks.map((chunk) => chunk.id)));
    return index;
  }
}

/** Loads the persisted index for retrieval; undefined means "not indexed". */
export async function loadIndexSnapshot(workspace: Workspace): Promise<IndexSnapshot | undefined> {
  const meta = await readJsonStore<IndexMeta>(workspace.metaFile, CACHE_SCHEMA_VERSION);
  if (!meta) return undefined;
  const [graphJson, chunksStore, analysesStore, embeddingsJson, report] = await Promise.all([
    readJsonStore<GraphJSON>(workspace.graphFile, CACHE_SCHEMA_VERSION),
    readJsonStore<ChunksStore>(workspace.chunksFile, CACHE_SCHEMA_VERSION),
    readJsonStore<AnalysesStore>(workspace.analysesFile, CACHE_SCHEMA_VERSION),
    readJsonStore<EmbeddingIndexJSON>(workspace.embeddingsFile, CACHE_SCHEMA_VERSION),
    readJsonStore<RepositoryAnalysis>(workspace.analysisFile, CACHE_SCHEMA_VERSION),
  ]);
  if (!graphJson || !chunksStore || !analysesStore) return undefined;

  const chunks: Chunk[] = [];
  for (const filePath of Object.keys(chunksStore.files).sort()) {
    chunks.push(...(chunksStore.files[filePath] as { chunks: Chunk[] }).chunks);
  }
  const analyses = new Map<string, FileAnalysis>();
  for (const [filePath, entry] of Object.entries(analysesStore.files)) {
    analyses.set(filePath, entry.analysis);
  }
  return {
    meta,
    graph: CodeGraph.fromJSON(graphJson),
    chunks,
    chunkMap: new Map(chunks.map((chunk) => [chunk.id, chunk])),
    analyses,
    bm25: BM25Index.fromChunks(chunks),
    ...(embeddingsJson ? { embeddings: EmbeddingIndex.fromJSON(embeddingsJson) } : {}),
    ...(report ? { report } : {}),
  };
}

/** Builds an in-memory snapshot straight from a fresh index run (no reload). */
export function snapshotFromOutcome(outcome: IndexOutcome, meta?: IndexMeta): IndexSnapshot {
  const analyses = new Map(outcome.analyses.map((analysis) => [analysis.path, analysis]));
  return {
    meta: meta ?? {
      indexedAt: outcome.stats.indexedAt,
      durationMs: outcome.stats.durationMs,
      stats: outcome.stats,
      configFingerprint: "",
    },
    graph: outcome.graph,
    chunks: outcome.chunks,
    chunkMap: new Map(outcome.chunks.map((chunk) => [chunk.id, chunk])),
    analyses,
    bm25: BM25Index.fromChunks(outcome.chunks),
    ...(outcome.embeddings ? { embeddings: outcome.embeddings } : {}),
    report: outcome.report,
  };
}
