import { describe, expect, it } from "vitest";
import { EdgeKind, NodeKind } from "../../src/core/types.js";
import type { FileGitStats } from "../../src/indexing/git.js";
import { CodeGraph } from "../../src/graph/graph.js";
import { applyGraphMetrics, computePageRank, pathHeuristicScore } from "../../src/graph/metrics.js";

function starGraph(): CodeGraph {
  const graph = new CodeGraph();
  graph.addNode({
    id: "file:src/core.ts",
    kind: NodeKind.File,
    name: "core.ts",
    path: "src/core.ts",
    metrics: {},
  });
  for (let i = 0; i < 5; i++) {
    graph.addNode({
      id: `file:src/user${i}.ts`,
      kind: NodeKind.File,
      name: `user${i}.ts`,
      path: `src/user${i}.ts`,
      metrics: {},
    });
    graph.addEdge({ from: `file:src/user${i}.ts`, to: "file:src/core.ts", kind: EdgeKind.Imports });
  }
  graph.addNode({
    id: "sym:src/core.ts#run",
    kind: NodeKind.Function,
    name: "run",
    file: "src/core.ts",
    metrics: {},
  });
  graph.addNode({
    id: "sym:src/user0.ts#main",
    kind: NodeKind.Function,
    name: "main",
    file: "src/user0.ts",
    metrics: {},
  });
  graph.addEdge({ from: "sym:src/user0.ts#main", to: "sym:src/core.ts#run", kind: EdgeKind.Calls });
  return graph;
}

describe("computePageRank", () => {
  it("gives heavily-imported nodes more mass", () => {
    const graph = starGraph();
    const ranks = computePageRank(graph);
    const core = ranks.get("file:src/core.ts") ?? 0;
    const leaf = ranks.get("file:src/user1.ts") ?? 0;
    expect(core).toBeGreaterThan(leaf);
    const total = [...ranks.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("handles empty graphs", () => {
    expect(computePageRank(new CodeGraph()).size).toBe(0);
  });
});

describe("applyGraphMetrics", () => {
  const now = 1_800_000_000_000;

  it("normalizes centrality, importance, dependency, usage, and recency", () => {
    const graph = starGraph();
    applyGraphMetrics(graph, {
      fileMtimes: new Map([
        ["src/core.ts", now - 86_400_000],
        ["src/user0.ts", now - 90 * 86_400_000],
      ]),
      entrypoints: new Set(["src/core.ts"]),
      now,
    });
    const core = graph.node("file:src/core.ts");
    const leaf = graph.node("file:src/user1.ts");
    expect(core?.metrics.centrality).toBeGreaterThan(leaf?.metrics.centrality ?? 1);
    expect(core?.metrics.importance).toBeGreaterThan(leaf?.metrics.importance ?? 1);
    expect(core?.metrics.fanIn).toBe(5);
    expect(core?.metrics.dependency).toBe(1);
    // recency: 1 day old ≈ 0.977 with 30-day half-life; 90 days ≈ 0.125
    expect(core?.metrics.recency).toBeGreaterThan(0.9);
    const user0 = graph.node("file:src/user0.ts");
    expect(user0?.metrics.recency ?? 1).toBeLessThan(0.2);

    const run = graph.node("sym:src/core.ts#run");
    const main = graph.node("sym:src/user0.ts#main");
    expect(run?.metrics.usage).toBeGreaterThan(main?.metrics.usage ?? 1);
    // symbols inherit their file's corpus signals
    expect(run?.metrics.importance).toBe(core?.metrics.importance);
  });

  it("adds git activity when stats are available", () => {
    const graph = starGraph();
    applyGraphMetrics(graph, {
      gitStats: {
        available: true,
        files: new Map<string, FileGitStats>([
          ["src/core.ts", { commitCount: 20, lastCommitAt: now - 1000, authors: { alice: 20 } }],
          ["src/user0.ts", { commitCount: 1, lastCommitAt: now - 5000, authors: { bob: 1 } }],
        ]),
      },
      now,
    });
    const core = graph.node("file:src/core.ts");
    expect(core?.metrics.commitCount).toBe(20);
    expect(core?.metrics.activity).toBe(1);
    expect(core?.metrics.lastModifiedAt).toBe(now - 1000);
    expect(graph.node("file:src/user1.ts")?.metrics.activity).toBe(0);
  });
});

describe("pathHeuristicScore", () => {
  it("rewards entry files and penalizes test scaffolding", () => {
    expect(pathHeuristicScore("src/index.ts")).toBeGreaterThan(
      pathHeuristicScore("src/deep/a/b/c.ts"),
    );
    expect(pathHeuristicScore("src/auth/service.ts")).toBeGreaterThan(
      pathHeuristicScore("tests/auth/service.test.ts"),
    );
    expect(pathHeuristicScore("src/auth/__mocks__/db.ts")).toBeLessThan(0.3);
  });
});
