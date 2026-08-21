import { tokenize } from "../core/text.js";
import type { Chunk } from "../core/types.js";

export interface Bm25Hit {
  id: string;
  score: number;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

/**
 * Okapi BM25 over code-aware tokens (phase 7, lexical retrieval). Documents
 * are chunks; each document's terms come from its text plus its file path and
 * symbol name, so `"auth service"` matches `src/auth/auth-service.ts` even
 * when the body never spells it out. Deterministic: ties break on chunk id.
 */
export class BM25Index {
  private readonly ids: string[];
  private readonly docLengths: Float64Array;
  private readonly postings: Map<string, Array<[docIndex: number, tf: number]>>;
  private readonly avgdl: number;
  private readonly k1: number;
  private readonly b: number;

  private constructor(
    ids: string[],
    docLengths: Float64Array,
    postings: Map<string, Array<[number, number]>>,
    avgdl: number,
    options: Bm25Options,
  ) {
    this.ids = ids;
    this.docLengths = docLengths;
    this.postings = postings;
    this.avgdl = avgdl;
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  static fromChunks(chunks: readonly Chunk[], options: Bm25Options = {}): BM25Index {
    const ids: string[] = [];
    const docLengths: number[] = [];
    const postings = new Map<string, Array<[number, number]>>();

    for (const chunk of chunks) {
      const docIndex = ids.length;
      ids.push(chunk.id);
      const terms = tokenize(`${chunk.text}\n${chunk.file}\n${chunk.name}`);
      docLengths.push(terms.length);
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, tf] of counts) {
        const bucket = postings.get(term);
        if (bucket) bucket.push([docIndex, tf]);
        else postings.set(term, [[docIndex, tf]]);
      }
    }

    const total = docLengths.reduce((sum, len) => sum + len, 0);
    const avgdl = docLengths.length > 0 ? total / docLengths.length : 0;
    return new BM25Index(ids, Float64Array.from(docLengths), postings, avgdl, options);
  }

  get size(): number {
    return this.ids.length;
  }

  search(terms: readonly string[], limit: number): Bm25Hit[] {
    const n = this.ids.length;
    if (n === 0 || terms.length === 0 || limit <= 0) return [];
    const scores = new Float64Array(n);
    const unique = [...new Set(terms)];

    for (const term of unique) {
      const bucket = this.postings.get(term);
      if (!bucket) continue;
      const df = bucket.length;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (const [docIndex, tf] of bucket) {
        const docLength = this.docLengths[docIndex] as number;
        const norm = tf + this.k1 * (1 - this.b + (this.b * docLength) / (this.avgdl || 1));
        scores[docIndex] = (scores[docIndex] as number) + (idf * (tf * (this.k1 + 1))) / norm;
      }
    }

    const hits: Bm25Hit[] = [];
    for (let i = 0; i < n; i++) {
      const score = scores[i] as number;
      if (score > 0) hits.push({ id: this.ids[i] as string, score });
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return hits.slice(0, limit);
  }
}
