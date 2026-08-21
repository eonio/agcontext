import { describe, expect, it } from "vitest";
import { EmbeddingIndex } from "../../src/retrieval/embedding-index.js";

function vec(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe("EmbeddingIndex", () => {
  it("ranks by cosine similarity", () => {
    const index = new EmbeddingIndex("local", "test", 3);
    index.set("a", "h1", vec(1, 0, 0));
    index.set("b", "h2", vec(0, 1, 0));
    index.set("c", "h3", vec(0.9, 0.1, 0));
    const hits = index.search(vec(1, 0, 0), 2);
    expect(hits.map((hit) => hit.id)).toEqual(["a", "c"]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
  });

  it("tracks content hashes for incremental re-embedding", () => {
    const index = new EmbeddingIndex("local", "test", 2);
    index.set("a", "hash-1", vec(1, 0));
    expect(index.has("a", "hash-1")).toBe(true);
    expect(index.has("a", "hash-2")).toBe(false);
    index.set("a", "hash-2", vec(0, 1));
    expect(index.size).toBe(1);
    expect(index.has("a", "hash-2")).toBe(true);
  });

  it("round-trips through JSON", () => {
    const index = new EmbeddingIndex("openai", "text-embedding-3-small", 4);
    index.set("x", "hx", vec(0.1, 0.2, 0.3, 0.4));
    index.set("y", "hy", vec(0.4, 0.3, 0.2, 0.1));
    const restored = EmbeddingIndex.fromJSON(index.toJSON());
    expect(restored.provider).toBe("openai");
    expect(restored.dim).toBe(4);
    expect(restored.size).toBe(2);
    expect(restored.has("x", "hx")).toBe(true);
    const original = index.search(vec(1, 1, 1, 1), 2);
    const roundTripped = restored.search(vec(1, 1, 1, 1), 2);
    expect(roundTripped.map((hit) => hit.id)).toEqual(original.map((hit) => hit.id));
    expect(roundTripped[0]?.score).toBeCloseTo(original[0]?.score ?? 0, 6);
  });

  it("prunes vectors for removed chunks and compacts", () => {
    const index = new EmbeddingIndex("local", "test", 2);
    index.set("keep", "h1", vec(1, 0));
    index.set("drop", "h2", vec(0, 1));
    index.prune(new Set(["keep"]));
    expect(index.size).toBe(1);
    expect(index.search(vec(0, 1), 5).map((hit) => hit.id)).toEqual(["keep"]);
  });

  it("rejects wrong dimensions", () => {
    const index = new EmbeddingIndex("local", "test", 3);
    expect(() => index.set("a", "h", vec(1, 2))).toThrow(RangeError);
    expect(index.search(vec(1, 2), 5)).toEqual([]);
  });

  it("grows capacity beyond the initial allocation", () => {
    const index = new EmbeddingIndex("local", "test", 8);
    for (let i = 0; i < 200; i++) {
      const v = new Float32Array(8);
      v[i % 8] = 1;
      index.set(`id-${i}`, `h-${i}`, v);
    }
    expect(index.size).toBe(200);
    const probe = new Float32Array(8);
    probe[3] = 1;
    expect(index.search(probe, 1)[0]?.score).toBeCloseTo(1, 5);
  });
});
