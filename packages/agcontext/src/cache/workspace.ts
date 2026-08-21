import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The on-disk cache layout under `.agcontext/`. One place knows every file
 * name, so persistence stays consistent across the indexer, retriever, CLI,
 * and doctor.
 */
export class Workspace {
  readonly root: string;
  readonly cacheDir: string;

  constructor(root: string, cacheDir: string) {
    this.root = root;
    this.cacheDir = cacheDir;
  }

  /** index metadata: stats, fingerprint, timestamps */
  get metaFile(): string {
    return path.join(this.cacheDir, "index-meta.json");
  }

  /** per-file AST analyses keyed by content hash */
  get analysesFile(): string {
    return path.join(this.cacheDir, "analyses.json");
  }

  /** serialized code graph */
  get graphFile(): string {
    return path.join(this.cacheDir, "graph.json");
  }

  /** retrievable chunks (symbol/file texts) */
  get chunksFile(): string {
    return path.join(this.cacheDir, "chunks.json");
  }

  /** embedding matrix + per-chunk hashes */
  get embeddingsFile(): string {
    return path.join(this.cacheDir, "embeddings.json");
  }

  /** repository intelligence report */
  get analysisFile(): string {
    return path.join(this.cacheDir, "repository.json");
  }

  get telemetryDir(): string {
    return path.join(this.cacheDir, "telemetry");
  }

  get telemetryFile(): string {
    return path.join(this.telemetryDir, "events.jsonl");
  }

  async ensure(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  /** Byte sizes of the cache files that exist (for `agc stats`). */
  async sizes(): Promise<Record<string, number>> {
    const files = {
      "index-meta.json": this.metaFile,
      "analyses.json": this.analysesFile,
      "graph.json": this.graphFile,
      "chunks.json": this.chunksFile,
      "embeddings.json": this.embeddingsFile,
      "repository.json": this.analysisFile,
    };
    const sizes: Record<string, number> = {};
    for (const [name, file] of Object.entries(files)) {
      try {
        sizes[name] = (await stat(file)).size;
      } catch {
        // absent files are simply omitted
      }
    }
    return sizes;
  }
}
