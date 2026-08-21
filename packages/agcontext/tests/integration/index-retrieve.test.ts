import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { NotIndexedError } from "../../src/core/errors.js";
import { NodeKind } from "../../src/core/types.js";
import { copyFixtureRepo, makeTempDir, removeDir, testAppOptions } from "../helpers/testkit.js";

let repo: string;
let app: AGContext;

beforeAll(async () => {
  repo = await copyFixtureRepo();
  app = new AGContext(testAppOptions(repo));
  await app.index();
});

afterAll(async () => {
  await removeDir(repo);
});

describe("end-to-end index + retrieve on the fixture repo", () => {
  it("indexes the repository with full stats", async () => {
    const stats = await app.stats();
    expect(stats.indexed).toBe(true);
    const meta = stats.meta;
    expect(meta?.stats.files).toBe(11);
    expect(meta?.stats.nodes).toBeGreaterThan(40);
    expect(meta?.stats.edges).toBeGreaterThan(40);
    expect(meta?.stats.chunks).toBeGreaterThan(20);
    // Local embeddings cover every chunk.
    expect(meta?.stats.embeddedChunks).toBe(meta?.stats.chunks);
    expect(meta?.stats.incremental).toBe(false);
    expect(stats.embedProvider).toBe("local");
  });

  it("retrieves AuthService for an authentication question", async () => {
    const result = await app.retrieve({ query: "How does user authentication work?" });
    expect(result.items.length).toBeGreaterThan(0);
    const topPaths = result.items.slice(0, 5).map((item) => item.path);
    expect(topPaths).toContain("src/auth/auth-service.ts");
    const topNames = result.items.slice(0, 5).map((item) => item.name);
    expect(topNames).toContain("AuthService");
    expect(result.diagnostics.strategy).toBe("hybrid");
    expect(result.diagnostics.embeddingUsed).toBe(true);
    expect(result.diagnostics.seedCount).toBeGreaterThan(0);
  });

  it("pulls in graph-related nodes that text search alone would miss", async () => {
    const result = await app.retrieve({ query: "AuthService", limit: 30 });
    const graphOnly = result.items.filter(
      (item) => item.sources.length === 1 && item.sources[0] === "graph",
    );
    expect(graphOnly.length).toBeGreaterThan(0);
    const allPaths = result.items.map((item) => item.path);
    // Composition/call neighbors of AuthService.
    expect(allPaths).toContain("src/users/user-repository.ts");
  });

  it("respects strategy overrides", async () => {
    const lexical = await app.retrieve({ query: "authentication login", strategy: "lexical" });
    expect(lexical.diagnostics.strategy).toBe("lexical");
    expect(lexical.diagnostics.expandedCount).toBe(0);
    expect(lexical.items.every((item) => item.sources.includes("lexical"))).toBe(true);

    const graph = await app.retrieve({ query: "AuthService", strategy: "graph" });
    expect(graph.diagnostics.expandedCount).toBeGreaterThan(0);
  });

  it("returns deterministic results", async () => {
    const run = async () =>
      JSON.stringify((await app.retrieve({ query: "token verification" })).items);
    expect(await run()).toBe(await run());
  });

  it("builds a token-bounded context package", async () => {
    const pkg = await app.context({ query: "How does authentication work?", maxTokens: 6000 });
    expect(pkg.tokens.used).toBeLessThanOrEqual(6000);
    expect(pkg.files.length + pkg.symbols.length).toBeGreaterThan(0);
    expect(pkg.summary).toContain("sample-app");
    expect(pkg.architecture.length).toBeGreaterThan(0);
    expect(pkg.meta.indexedAt).toBeTruthy();
    const paths = pkg.files.map((file) => file.path);
    expect(paths).toContain("src/auth/auth-service.ts");
  });

  it("explains symbols with graph relations", async () => {
    const explanation = await app.explain("AuthService");
    expect(explanation.kind).toBe(NodeKind.Class);
    expect(explanation.file).toBe("src/auth/auth-service.ts");
    expect(explanation.relations.some((relation) => relation.name === "UserRepository")).toBe(true);
    expect(explanation.fileSummary).toContain("compressed view");

    const byPath = await app.explain("src/utils/crypto.ts");
    expect(byPath.kind).toBe(NodeKind.File);
  });

  it("persists the index for fresh instances", async () => {
    const fresh = new AGContext(testAppOptions(repo));
    const result = await fresh.retrieve({ query: "database query" });
    expect(result.items.map((item) => item.path)).toContain("src/db/database.ts");
  });

  it("re-indexes incrementally and detects changes", async () => {
    const second = await app.index();
    expect(second.incremental).toBe(true);
    expect(second.addedFiles).toBe(0);
    expect(second.changedFiles).toBe(0);
    expect(second.removedFiles).toBe(0);

    const target = path.join(repo, "src", "config.ts");
    const original = await readFile(target, "utf8");
    await writeFile(target, `${original}\nexport const extraFlag = true;\n`, "utf8");
    const third = await app.index();
    expect(third.changedFiles).toBe(1);
    expect(third.addedFiles).toBe(0);

    const result = await app.retrieve({ query: "extraFlag" });
    expect(result.items[0]?.path).toBe("src/config.ts");
  });

  it("throws NotIndexedError before any index exists", async () => {
    const empty = await makeTempDir("empty");
    try {
      const bare = new AGContext(testAppOptions(empty));
      await expect(bare.retrieve("anything")).rejects.toBeInstanceOf(NotIndexedError);
    } finally {
      await removeDir(empty);
    }
  });
});
