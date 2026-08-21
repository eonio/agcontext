import { describe, expect, it } from "vitest";
import { DEFAULT_EDGE_WEIGHTS } from "../../src/config/defaults.js";
import { EdgeKind, NodeKind } from "../../src/core/types.js";
import { CodeGraph } from "../../src/graph/graph.js";
import { expandFromSeeds, type ExpansionOptions } from "../../src/graph/traversal.js";

function chainGraph(length: number): CodeGraph {
  const graph = new CodeGraph();
  for (let i = 0; i < length; i++) {
    graph.addNode({ id: `n${i}`, kind: NodeKind.Function, name: `n${i}`, metrics: {} });
  }
  for (let i = 0; i < length - 1; i++) {
    graph.addEdge({ from: `n${i}`, to: `n${i + 1}`, kind: EdgeKind.Calls });
  }
  return graph;
}

function options(overrides: Partial<ExpansionOptions> = {}): ExpansionOptions {
  return {
    maxDepth: 3,
    maxNodes: 100,
    traversalBudget: 1000,
    minScore: 0.01,
    decay: 0.6,
    edgeWeights: DEFAULT_EDGE_WEIGHTS,
    hubDegreeLimit: 64,
    ...overrides,
  };
}

describe("expandFromSeeds", () => {
  it("propagates decayed scores outward from seeds", () => {
    const graph = chainGraph(6);
    const result = expandFromSeeds(graph, [{ id: "n0", score: 1 }], options());
    expect(result.nodes.get("n0")?.score).toBe(1);
    expect(result.nodes.get("n0")?.depth).toBe(0);
    const first = result.nodes.get("n1");
    expect(first?.depth).toBe(1);
    expect(first?.score).toBeCloseTo(0.6 * DEFAULT_EDGE_WEIGHTS[EdgeKind.Calls], 5);
    const second = result.nodes.get("n2");
    expect(second?.score ?? 0).toBeLessThan(first?.score ?? 0);
    expect(second?.via).toBe("n1");
  });

  it("enforces the depth limit", () => {
    const graph = chainGraph(10);
    const result = expandFromSeeds(graph, [{ id: "n0", score: 1 }], options({ maxDepth: 2 }));
    expect(result.nodes.has("n2")).toBe(true);
    expect(result.nodes.has("n3")).toBe(false);
  });

  it("enforces the traversal budget", () => {
    const graph = chainGraph(50);
    const result = expandFromSeeds(
      graph,
      [{ id: "n0", score: 1 }],
      options({ maxDepth: 6, traversalBudget: 3 }),
    );
    expect(result.visited).toBeLessThanOrEqual(3);
    expect(result.nodes.size).toBeLessThanOrEqual(3);
  });

  it("stops expanding below the score threshold but keeps the node", () => {
    const graph = chainGraph(10);
    const result = expandFromSeeds(
      graph,
      [{ id: "n0", score: 1 }],
      options({ maxDepth: 9, minScore: 0.3, decay: 0.5 }),
    );
    // n1 score = 0.5 => expanded; n2 score = 0.25 < 0.3 => recorded, not expanded.
    expect(result.nodes.has("n2")).toBe(true);
    expect(result.nodes.has("n3")).toBe(false);
  });

  it("includes hubs but does not expand through them", () => {
    const graph = new CodeGraph();
    graph.addNode({ id: "seed", kind: NodeKind.Function, name: "seed", metrics: {} });
    graph.addNode({ id: "hub", kind: NodeKind.File, name: "hub", metrics: {} });
    for (let i = 0; i < 10; i++) {
      graph.addNode({ id: `leaf${i}`, kind: NodeKind.Function, name: `leaf${i}`, metrics: {} });
      graph.addEdge({ from: "hub", to: `leaf${i}`, kind: EdgeKind.Imports });
    }
    graph.addEdge({ from: "seed", to: "hub", kind: EdgeKind.Imports });
    const result = expandFromSeeds(
      graph,
      [{ id: "seed", score: 1 }],
      options({ hubDegreeLimit: 5 }),
    );
    expect(result.nodes.has("hub")).toBe(true);
    expect([...result.nodes.keys()].some((id) => id.startsWith("leaf"))).toBe(false);

    const permissive = expandFromSeeds(
      graph,
      [{ id: "seed", score: 1 }],
      options({ hubDegreeLimit: 100 }),
    );
    expect([...permissive.nodes.keys()].some((id) => id.startsWith("leaf"))).toBe(true);
  });

  it("trims to maxNodes keeping the highest scores", () => {
    const graph = chainGraph(30);
    const result = expandFromSeeds(
      graph,
      [{ id: "n0", score: 1 }],
      options({ maxDepth: 29, maxNodes: 5, minScore: 0 }),
    );
    expect(result.nodes.size).toBe(5);
    expect(result.nodes.has("n0")).toBe(true);
    expect(result.nodes.has("n4")).toBe(true);
    expect(result.nodes.has("n5")).toBe(false);
  });

  it("merges duplicate seeds and ignores unknown seeds", () => {
    const graph = chainGraph(3);
    const result = expandFromSeeds(
      graph,
      [
        { id: "n0", score: 0.4 },
        { id: "n0", score: 0.9 },
        { id: "missing", score: 1 },
      ],
      options(),
    );
    expect(result.nodes.get("n0")?.score).toBe(0.9);
    expect(result.nodes.has("missing")).toBe(false);
  });

  it("is deterministic", () => {
    const graph = chainGraph(20);
    const run = () =>
      JSON.stringify([
        ...expandFromSeeds(graph, [{ id: "n0", score: 1 }], options()).nodes.entries(),
      ]);
    expect(run()).toBe(run());
  });
});
