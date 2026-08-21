import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "../../src/config/defaults.js";
import type { Candidate } from "../../src/core/types.js";
import { Ranker } from "../../src/ranking/ranker.js";

function candidate(nodeId: string, raw: Record<string, number>): Candidate {
  return { nodeId, sources: [], raw: { ...raw }, signals: {}, score: 0 };
}

describe("Ranker (weighted)", () => {
  const ranker = new Ranker({ mode: "weighted", weights: DEFAULT_WEIGHTS });

  it("orders by fused multi-signal score", () => {
    const ranked = ranker.rank(
      [
        candidate("low", { lexical: 1, centrality: 0.1 }),
        candidate("high", { lexical: 10, semantic: 0.9, graph: 0.8, centrality: 0.9 }),
        candidate("mid", { lexical: 5, graph: 0.4, centrality: 0.5 }),
      ],
      10,
    );
    expect(ranked.map((c) => c.nodeId)).toEqual(["high", "mid", "low"]);
    expect(ranked[0]?.score).toBeGreaterThan(0);
    expect(ranked[0]?.signals["lexical"]).toBe(1);
    expect(ranked[2]?.signals["lexical"]).toBe(0);
  });

  it("renormalizes weights over available signals", () => {
    // Without semantic/graph signals, lexical + corpus carry the full weight.
    const ranked = ranker.rank(
      [candidate("a", { lexical: 2 }), candidate("b", { lexical: 1 })],
      10,
    );
    expect(ranked[0]?.nodeId).toBe("a");
    // lexical weight renormalized to 1 => top score equals normalized lexical (1).
    expect(ranked[0]?.score).toBeCloseTo(1, 5);
  });

  it("treats a degenerate query-signal distribution as full relevance", () => {
    const ranked = ranker.rank([candidate("only", { lexical: 3.7 })], 10);
    expect(ranked[0]?.signals["lexical"]).toBe(1);
  });

  it("passes corpus signals through clamped", () => {
    const ranked = ranker.rank([candidate("x", { centrality: 1.7, importance: -0.5 })], 10);
    expect(ranked[0]?.signals["centrality"]).toBe(1);
    expect(ranked[0]?.signals["importance"]).toBe(0);
  });

  it("supports custom plugin signals via open weights", () => {
    const custom = new Ranker({
      mode: "weighted",
      weights: { ...DEFAULT_WEIGHTS, freshness: 5 },
    });
    const ranked = custom.rank(
      [candidate("stale", { lexical: 5 }), candidate("fresh", { lexical: 5, freshness: 1 })],
      10,
    );
    expect(ranked[0]?.nodeId).toBe("fresh");
  });

  it("breaks ties deterministically by node id", () => {
    const ranked = ranker.rank(
      [candidate("beta", { lexical: 1 }), candidate("alpha", { lexical: 1 })],
      10,
    );
    expect(ranked.map((c) => c.nodeId)).toEqual(["alpha", "beta"]);
  });

  it("applies the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate(`n${i}`, { lexical: i }));
    expect(ranker.rank(many, 5)).toHaveLength(5);
    expect(ranker.rank([], 5)).toEqual([]);
  });
});

describe("Ranker (rrf)", () => {
  it("fuses by reciprocal rank deterministically", () => {
    const ranker = new Ranker({ mode: "rrf", weights: { lexical: 1, semantic: 1 } });
    const input = () => [
      candidate("a", { lexical: 10, semantic: 0.9 }),
      candidate("b", { lexical: 8, semantic: 0.7 }),
      candidate("c", { lexical: 9 }),
    ];
    const ranked = ranker.rank(input(), 10);
    // Rank 1 in both lists wins outright.
    expect(ranked[0]?.nodeId).toBe("a");
    expect(ranked.every((c) => c.score > 0)).toBe(true);
    const again = ranker.rank(input(), 10);
    expect(again.map((c) => c.nodeId)).toEqual(ranked.map((c) => c.nodeId));
  });

  it("ranks candidates missing a signal below the weakest present value", () => {
    const ranker = new Ranker({ mode: "rrf", weights: { semantic: 1 } });
    const ranked = ranker.rank(
      [candidate("absent", {}), candidate("weak", { semantic: 0.01 })],
      10,
    );
    expect(ranked[0]?.nodeId).toBe("weak");
  });
});
