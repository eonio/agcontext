import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { architectureSummary } from "../../src/compression/architecture.js";
import { dependencySummary } from "../../src/compression/dependencies.js";
import { fileSummary, symbolSummary } from "../../src/compression/summaries.js";
import { NodeKind, type RepositoryAnalysis } from "../../src/core/types.js";
import { buildGraph, fileNodeId, symbolNodeId } from "../../src/graph/builder.js";
import { TypeScriptAnalyzer, type FileAnalysis } from "../../src/indexing/analyzer.js";
import { buildFileChunks } from "../../src/indexing/chunker.js";
import { FIXTURE_REPO } from "../helpers/testkit.js";

const analyzer = new TypeScriptAnalyzer();

async function fixtureAnalysis(rel: string): Promise<{ analysis: FileAnalysis; content: string }> {
  const content = await readFile(path.join(FIXTURE_REPO, ...rel.split("/")), "utf8");
  const analysis = analyzer.analyze(rel, content) as FileAnalysis;
  return { analysis, content };
}

describe("buildFileChunks", () => {
  it("creates one file chunk plus one chunk per top-level symbol", async () => {
    const { analysis, content } = await fixtureAnalysis("src/auth/auth-service.ts");
    const chunks = buildFileChunks(analysis, content);
    const ids = chunks.map((chunk) => chunk.id);
    expect(ids).toContain(fileNodeId("src/auth/auth-service.ts"));
    expect(ids).toContain(symbolNodeId("src/auth/auth-service.ts", "AuthService"));
    expect(ids).toContain(symbolNodeId("src/auth/auth-service.ts", "AuthResult"));
    // Methods are covered by their class chunk, not chunked separately.
    expect(ids).not.toContain(symbolNodeId("src/auth/auth-service.ts", "AuthService.login"));

    const classChunk = chunks.find(
      (chunk) => chunk.id === symbolNodeId("src/auth/auth-service.ts", "AuthService"),
    );
    expect(classChunk?.text).toContain("async login(");
    expect(classChunk?.text).toContain("/** Handles user authentication");
    expect(classChunk?.kind).toBe(NodeKind.Class);
    expect(classChunk?.startLine).toBeGreaterThan(1);
  });

  it("hashes chunk text stably and caps chunk size", async () => {
    const { analysis, content } = await fixtureAnalysis("src/db/database.ts");
    const first = buildFileChunks(analysis, content);
    const second = buildFileChunks(analysis, content);
    expect(first.map((chunk) => chunk.hash)).toEqual(second.map((chunk) => chunk.hash));
    const capped = buildFileChunks(analysis, content, { maxChunkChars: 40 });
    expect(capped.every((chunk) => chunk.text.length <= 40 + 40)).toBe(true);
  });
});

describe("fileSummary", () => {
  it("keeps imports, signatures, docs, and exports while dropping bodies", async () => {
    const { analysis, content } = await fixtureAnalysis("src/auth/auth-service.ts");
    const summary = fileSummary(analysis);
    expect(summary).toContain('from "../users/user-repository.js"');
    expect(summary).toContain("export class AuthService");
    expect(summary).toContain("login");
    expect(summary).toContain("// exports:");
    expect(summary).toMatch(/\/\/ exports:.*AuthService/);
    expect(summary).not.toContain("this.users.findByEmail");
    expect(summary.length).toBeLessThan(content.length);
  });
});

describe("symbolSummary", () => {
  it("renders identity, signature, doc, and relations", () => {
    const summary = symbolSummary(
      {
        id: "sym:src/a.ts#AuthService",
        kind: NodeKind.Class,
        name: "AuthService",
        file: "src/a.ts",
        startLine: 10,
        endLine: 30,
        signature: "export class AuthService",
        doc: "Handles authentication.",
        metrics: {},
      },
      ["called by LoginController"],
    );
    expect(summary).toContain("class AuthService — src/a.ts:10-30");
    expect(summary).toContain("Handles authentication.");
    expect(summary).toContain("- called by LoginController");
  });
});

describe("architectureSummary and dependencySummary", () => {
  async function fixtureGraph() {
    const files = [
      "src/index.ts",
      "src/server.ts",
      "src/auth/auth-service.ts",
      "src/auth/token.ts",
      "src/users/user-repository.ts",
      "src/db/base-repository.ts",
      "src/db/database.ts",
      "src/utils/crypto.ts",
      "src/http/login-controller.ts",
      "src/config.ts",
    ];
    const analyses: FileAnalysis[] = [];
    for (const file of files) {
      analyses.push((await fixtureAnalysis(file)).analysis);
    }
    return buildGraph({ rootName: "sample-app", analyses });
  }

  it("summarizes a repository report into bullets", async () => {
    const graph = await fixtureGraph();
    const report: RepositoryAnalysis = {
      name: "sample-app",
      version: "1.0.0",
      description: "demo",
      root: "/tmp/sample",
      filesTotal: 10,
      locTotal: 300,
      languages: { TypeScript: { files: 10, loc: 300 } },
      entrypoints: [{ kind: "main", path: "src/index.ts" }],
      frameworks: ["Express"],
      patterns: ["ESM package"],
      layout: [{ path: "src", role: "source", files: 10, loc: 300 }],
      topImported: [],
      topCentral: [{ path: "src/index.ts", centrality: 1 }],
      externalDependencies: [],
      hotspots: [],
      ownership: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    const lines = architectureSummary(report, graph);
    expect(lines[0]).toContain("sample-app v1.0.0");
    expect(lines.join("\n")).toContain("Stack: Express");
    expect(lines.join("\n")).toContain("src/ — source");
    expect(lines.join("\n")).toContain("Entrypoints: src/index.ts (main)");
  });

  it("falls back to graph-derived bullets without a report", async () => {
    const graph = await fixtureGraph();
    const lines = architectureSummary(undefined, graph);
    expect(lines[0]).toContain("source files");
  });

  it("maps dependencies among the selected files plus externals", async () => {
    const graph = await fixtureGraph();
    const lines = dependencySummary(
      ["src/server.ts", "src/auth/auth-service.ts", "src/utils/crypto.ts"],
      graph,
    );
    expect(lines.join("\n")).toContain("src/auth/auth-service.ts imports src/utils/crypto.ts");
    expect(lines.join("\n")).toContain("express");
  });
});
