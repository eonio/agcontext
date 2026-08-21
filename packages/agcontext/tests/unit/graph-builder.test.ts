import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { EdgeKind, NodeKind } from "../../src/core/types.js";
import { buildGraph, fileNodeId, symbolNodeId } from "../../src/graph/builder.js";
import type { CodeGraph } from "../../src/graph/graph.js";
import { TypeScriptAnalyzer, type FileAnalysis } from "../../src/indexing/analyzer.js";
import { scanRepository } from "../../src/indexing/scanner.js";
import { FIXTURE_REPO } from "../helpers/testkit.js";

let graph: CodeGraph;

beforeAll(async () => {
  const analyzer = new TypeScriptAnalyzer();
  const files = await scanRepository({
    root: FIXTURE_REPO,
    extensions: [".ts"],
    exclude: [],
    maxFileSizeBytes: 1_000_000,
  });
  const analyses: FileAnalysis[] = [];
  for (const file of files) {
    const content = await readFile(file.absPath, "utf8");
    const analysis = analyzer.analyze(file.path, content);
    if (analysis) analyses.push(analysis);
  }
  graph = buildGraph({ rootName: "sample-app", analyses });
});

function edgeBetween(from: string, to: string, kind: EdgeKind) {
  return graph.outEdges(from, [kind]).find((edge) => edge.to === to);
}

describe("graph structure", () => {
  it("creates repository, directory, file, and symbol nodes", () => {
    expect(graph.node("repo:.")?.kind).toBe(NodeKind.Repository);
    expect(graph.node("dir:src")?.kind).toBe(NodeKind.Directory);
    expect(graph.node("dir:src/auth")?.kind).toBe(NodeKind.Directory);
    expect(graph.fileNode("src/auth/auth-service.ts")?.kind).toBe(NodeKind.File);
    const service = graph.node(symbolNodeId("src/auth/auth-service.ts", "AuthService"));
    expect(service?.kind).toBe(NodeKind.Class);
    expect(service?.exported).toBe(true);
    expect(service?.doc).toContain("authentication");
  });

  it("wires structural containment", () => {
    expect(
      edgeBetween("dir:src/auth", fileNodeId("src/auth/auth-service.ts"), EdgeKind.Contains),
    ).toBeDefined();
    expect(
      edgeBetween(
        symbolNodeId("src/auth/auth-service.ts", "AuthService"),
        symbolNodeId("src/auth/auth-service.ts", "AuthService.login"),
        EdgeKind.Contains,
      ),
    ).toBeDefined();
  });

  it("creates external module nodes for package imports", () => {
    expect(graph.node("mod:express")?.external).toBe(true);
    expect(edgeBetween(fileNodeId("src/server.ts"), "mod:express", EdgeKind.Imports)).toBeDefined();
  });
});

describe("import/export edges", () => {
  it("resolves NodeNext .js specifiers onto .ts files", () => {
    expect(
      edgeBetween(
        fileNodeId("src/auth/auth-service.ts"),
        fileNodeId("src/utils/crypto.ts"),
        EdgeKind.Imports,
      ),
    ).toBeDefined();
  });

  it("links barrel re-exports to the underlying symbols", () => {
    const reexport = edgeBetween(
      fileNodeId("src/index.ts"),
      symbolNodeId("src/auth/auth-service.ts", "AuthService"),
      EdgeKind.Exports,
    );
    expect(reexport?.meta?.variant).toBe("reexport");
    // Star re-export points at the target file.
    expect(
      edgeBetween(
        fileNodeId("src/index.ts"),
        fileNodeId("src/users/user-repository.ts"),
        EdgeKind.Exports,
      ),
    ).toBeDefined();
  });

  it("exports own symbols from their file", () => {
    expect(
      edgeBetween(
        fileNodeId("src/utils/crypto.ts"),
        symbolNodeId("src/utils/crypto.ts", "hashPassword"),
        EdgeKind.Exports,
      ),
    ).toBeDefined();
  });
});

describe("semantic edges", () => {
  it("links inheritance across files", () => {
    const edge = edgeBetween(
      symbolNodeId("src/users/user-repository.ts", "UserRepository"),
      symbolNodeId("src/db/base-repository.ts", "BaseRepository"),
      EdgeKind.Inheritance,
    );
    expect(edge?.meta?.variant).toBe("extends");
  });

  it("links composition from constructor parameter properties", () => {
    expect(
      edgeBetween(
        symbolNodeId("src/auth/auth-service.ts", "AuthService"),
        symbolNodeId("src/users/user-repository.ts", "UserRepository"),
        EdgeKind.Composition,
      ),
    ).toBeDefined();
    expect(
      edgeBetween(
        symbolNodeId("src/db/base-repository.ts", "BaseRepository"),
        symbolNodeId("src/db/database.ts", "Database"),
        EdgeKind.Composition,
      ),
    ).toBeDefined();
  });

  it("links calls through imports, this, and unique global names", () => {
    const login = symbolNodeId("src/auth/auth-service.ts", "AuthService.login");
    // import binding
    expect(
      edgeBetween(login, symbolNodeId("src/utils/crypto.ts", "verifyPassword"), EdgeKind.Calls),
    ).toBeDefined();
    // this.issueToken sibling
    expect(
      edgeBetween(
        login,
        symbolNodeId("src/auth/auth-service.ts", "AuthService.issueToken"),
        EdgeKind.Calls,
      ),
    ).toBeDefined();
    // this.users.findByEmail via unique exported method name
    const findByEmail = edgeBetween(
      login,
      symbolNodeId("src/users/user-repository.ts", "UserRepository.findByEmail"),
      EdgeKind.Calls,
    );
    expect(findByEmail?.meta?.resolution).toBe("global-unique");
    // issueToken calls the imported signToken
    expect(
      edgeBetween(
        symbolNodeId("src/auth/auth-service.ts", "AuthService.issueToken"),
        symbolNodeId("src/auth/token.ts", "signToken"),
        EdgeKind.Calls,
      ),
    ).toBeDefined();
  });

  it("marks instantiations from new expressions", () => {
    const start = symbolNodeId("src/server.ts", "startServer");
    const edge = edgeBetween(start, symbolNodeId("src/db/database.ts", "Database"), EdgeKind.Calls);
    expect(edge?.meta?.variant).toBe("instantiates");
  });

  it("links top-level bootstrap calls from the file node", () => {
    expect(
      edgeBetween(
        fileNodeId("src/index.ts"),
        symbolNodeId("src/server.ts", "startServer"),
        EdgeKind.Calls,
      ),
    ).toBeDefined();
  });

  it("records references for type usage", () => {
    const controller = symbolNodeId("src/http/login-controller.ts", "LoginController.handle");
    expect(
      graph
        .outEdges(controller, [EdgeKind.References])
        .some((edge) => edge.to === symbolNodeId("src/http/login-controller.ts", "LoginRequest")),
    ).toBe(true);
  });
});

describe("graph queries and serialization", () => {
  it("finds nodes by name case-insensitively", () => {
    const matches = graph.findByName("authservice");
    expect(matches.map((node) => node.id)).toContain(
      symbolNodeId("src/auth/auth-service.ts", "AuthService"),
    );
  });

  it("reports stats by kind", () => {
    const stats = graph.stats();
    expect(stats.nodesByKind[NodeKind.File]).toBeGreaterThanOrEqual(11);
    expect(stats.edgesByKind[EdgeKind.Calls]).toBeGreaterThan(0);
    expect(stats.edgesByKind[EdgeKind.Inheritance]).toBeGreaterThan(0);
  });

  it("round-trips deterministically through JSON", async () => {
    const { CodeGraph } = await import("../../src/graph/graph.js");
    const json = graph.toJSON();
    const restored = CodeGraph.fromJSON(json);
    expect(restored.nodeCount).toBe(graph.nodeCount);
    expect(restored.edgeCount).toBe(graph.edgeCount);
    expect(JSON.stringify(restored.toJSON())).toBe(JSON.stringify(json));
  });

  it("rejects self-loops and dangling edges", () => {
    const before = graph.edgeCount;
    expect(graph.addEdge({ from: "repo:.", to: "repo:.", kind: EdgeKind.References })).toBe(false);
    expect(graph.addEdge({ from: "repo:.", to: "ghost:node", kind: EdgeKind.References })).toBe(
      false,
    );
    expect(graph.edgeCount).toBe(before);
  });
});
