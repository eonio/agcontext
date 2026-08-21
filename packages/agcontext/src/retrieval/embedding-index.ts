import { Buffer } from "node:buffer";

export interface EmbeddingHit {
  id: string;
  score: number;
}

export interface EmbeddingIndexJSON {
  provider: string;
  model: string;
  dim: number;
  items: Array<{ id: string; hash: string; v: string }>;
}

/**
 * Dense vector index (phase 7, semantic retrieval). Vectors live in one
 * contiguous Float32 matrix, L2-normalized on insert so similarity is a dot
 * product. Brute-force scan — exact, dependency-free, and comfortably within
 * the latency budget for repository-scale corpora (a 50k x 1536 scan is
 * ~10 ms in Node). Per-chunk content hashes make re-embedding incremental.
 */
export class EmbeddingIndex {
  readonly provider: string;
  readonly model: string;
  readonly dim: number;

  private ids: string[] = [];
  private hashes: string[] = [];
  private readonly position = new Map<string, number>();
  private data: Float32Array;
  private count = 0;

  constructor(provider: string, model: string, dim: number) {
    this.provider = provider;
    this.model = model;
    this.dim = dim;
    this.data = new Float32Array(dim * 64);
  }

  get size(): number {
    return this.count;
  }

  has(id: string, hash: string): boolean {
    const pos = this.position.get(id);
    return pos !== undefined && this.hashes[pos] === hash;
  }

  set(id: string, hash: string, vector: Float32Array): void {
    if (vector.length !== this.dim) {
      throw new RangeError(`Vector length ${vector.length} does not match index dim ${this.dim}`);
    }
    let pos = this.position.get(id);
    if (pos === undefined) {
      pos = this.count;
      if ((pos + 1) * this.dim > this.data.length) {
        const grown = new Float32Array(Math.max(this.data.length * 2, (pos + 1) * this.dim));
        grown.set(this.data);
        this.data = grown;
      }
      this.ids.push(id);
      this.hashes.push(hash);
      this.position.set(id, pos);
      this.count++;
    } else {
      this.hashes[pos] = hash;
    }
    const offset = pos * this.dim;
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += (vector[i] as number) ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) {
      this.data[offset + i] = (vector[i] as number) / norm;
    }
  }

  /** Drops vectors whose chunk no longer exists; compacts storage. */
  prune(keep: ReadonlySet<string>): void {
    if (this.ids.every((id) => keep.has(id))) return;
    const nextIds: string[] = [];
    const nextHashes: string[] = [];
    const nextData = new Float32Array(this.data.length);
    let write = 0;
    for (let read = 0; read < this.count; read++) {
      const id = this.ids[read] as string;
      if (!keep.has(id)) continue;
      nextIds.push(id);
      nextHashes.push(this.hashes[read] as string);
      nextData.set(this.data.subarray(read * this.dim, (read + 1) * this.dim), write * this.dim);
      write++;
    }
    this.ids = nextIds;
    this.hashes = nextHashes;
    this.data = nextData;
    this.count = write;
    this.position.clear();
    this.ids.forEach((id, i) => this.position.set(id, i));
  }

  search(query: Float32Array, limit: number): EmbeddingHit[] {
    if (this.count === 0 || limit <= 0) return [];
    if (query.length !== this.dim) return [];
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += (query[i] as number) ** 2;
    norm = Math.sqrt(norm) || 1;

    const scored: EmbeddingHit[] = [];
    for (let pos = 0; pos < this.count; pos++) {
      const offset = pos * this.dim;
      let dot = 0;
      for (let i = 0; i < this.dim; i++) {
        dot += (this.data[offset + i] as number) * (query[i] as number);
      }
      scored.push({ id: this.ids[pos] as string, score: dot / norm });
    }
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return scored.slice(0, limit);
  }

  toJSON(): EmbeddingIndexJSON {
    const items = this.ids
      .map((id, pos) => ({
        id,
        hash: this.hashes[pos] as string,
        v: encodeVector(this.data.subarray(pos * this.dim, (pos + 1) * this.dim)),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return { provider: this.provider, model: this.model, dim: this.dim, items };
  }

  static fromJSON(json: EmbeddingIndexJSON): EmbeddingIndex {
    const index = new EmbeddingIndex(json.provider, json.model, json.dim);
    for (const item of json.items) {
      index.set(item.id, item.hash, decodeVector(item.v, json.dim));
    }
    return index;
  }
}

function encodeVector(view: Float32Array): string {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64");
}

function decodeVector(base64: string, dim: number): Float32Array {
  const buffer = Buffer.from(base64, "base64");
  // Copy into an aligned buffer; Buffer slices are not guaranteed 4-aligned.
  const aligned = new Uint8Array(buffer.byteLength);
  aligned.set(buffer);
  const vector = new Float32Array(aligned.buffer, 0, Math.min(dim, aligned.byteLength >> 2));
  if (vector.length === dim) return vector;
  const padded = new Float32Array(dim);
  padded.set(vector);
  return padded;
}
