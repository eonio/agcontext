import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/resolve.js";
import { ContextBuilder } from "../../src/context/builder.js";
import { renderJson, renderMarkdown, renderXml } from "../../src/context/render.js";
import { defaultTokenCounter } from "../../src/core/tokens.js";
import {
  NodeKind,
  type Chunk,
  type ContextPackage,
  type RetrievedItem,
} from "../../src/core/types.js";
import { buildGraph, fileNodeId, symbolNodeId } from "../../src/graph/builder.js";
import type { CodeGraph } from "../../src/graph/graph.js";
import { TypeScriptAnalyzer, type FileAnalysis } from "../../src/indexing/analyzer.js";
import { buildFileChunks } from "../../src/indexing/chunker.js";
import { scanRepository } from "../../src/indexing/scanner.js";
import { FIXTURE_REPO } from "../helpers/testkit.js";

let graph: CodeGraph;
const analyses = new Map<string, FileAnalysis>();
const chunkMap = new Map<string, Chunk>();
const contents = new Map<string, string>();

beforeAll(async () => {
  const analyzer = new TypeScriptAnalyzer();
  const files = await scanRepository({
    root: FIXTURE_REPO,
    extensions: [".ts"],
    exclude: [],
    maxFileSizeBytes: 1_000_000,
  });
  const list: FileAnalysis[] = [];
  for (const file of files) {
    const content = await readFile(file.absPath, "utf8");
    const analysis = analyzer.analyze(file.path, content);
    if (!analysis) continue;
    list.push(analysis);
    analyses.set(file.path, analysis);
    contents.set(file.path, content);
    for (const chunk of buildFileChunks(analysis, content)) {
      chunkMap.set(chunk.id, chunk);
    }
  }
  graph = buildGraph({ rootName: "sample-app", analyses: list });
});

function makeBuilder(maxTokens?: number): ContextBuilder {
  const config = resolveConfig({
    cwd: FIXTURE_REPO,
    overrides: maxTokens !== undefined ? { context: { maxTokens } } : {},
  });
  return new ContextBuilder({
    graph,
    chunkMap,
    analyses,
    config,
    tokenCounter: defaultTokenCounter,
    readFile: (rel) =>
      readFile(path.join(FIXTURE_REPO, ...rel.split("/")), "utf8").catch(() => undefined),
  });
}

function item(nodeId: string, score: number, depth = 0): RetrievedItem {
  const node = graph.node(nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return {
    nodeId,
    kind: node.kind,
    name: node.name,
    path: node.kind === NodeKind.File ? (node.path as string) : (node.file as string),
    ...(node.startLine !== undefined ? { startLine: node.startLine } : {}),
    ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
    ...(node.signature !== undefined ? { signature: node.signature } : {}),
    ...(node.doc !== undefined ? { doc: node.doc } : {}),
    score,
    signals: { lexical: score },
    sources: depth === 0 ? ["lexical"] : ["graph"],
    depth,
  };
}

const AUTH_FILE = fileNodeId("src/auth/auth-service.ts");
const AUTH_CLASS = symbolNodeId("src/auth/auth-service.ts", "AuthService");
const LOGIN_METHOD = symbolNodeId("src/auth/auth-service.ts", "AuthService.login");
const CRYPTO_FILE = fileNodeId("src/utils/crypto.ts");

describe("ContextBuilder", () => {
  it("includes full files when the budget allows and stays within budget", async () => {
    const pkg = await makeBuilder().build(
      "how does authentication work",
      [item(AUTH_FILE, 0.9), item(CRYPTO_FILE, 0.5, 1)],
      { strategy: "hybrid" },
    );
    expect(pkg.files.length).toBeGreaterThanOrEqual(2);
    const authFile = pkg.files.find((file) => file.path === "src/auth/auth-service.ts");
    expect(authFile?.representation).toBe("full");
    expect(authFile?.content).toBe(contents.get("src/auth/auth-service.ts"));
    expect(authFile?.reason).toContain("direct match");
    const related = pkg.files.find((file) => file.path === "src/utils/crypto.ts");
    expect(related?.reason).toContain("code graph");
    expect(pkg.tokens.used).toBeLessThanOrEqual(pkg.tokens.budget);
    expect(pkg.summary).toContain('"how does authentication work"');
    expect(pkg.meta.nodeCount).toBe(2);
  });

  it("removes redundancy: symbols of fully-included files are skipped", async () => {
    const pkg = await makeBuilder().build(
      "auth",
      [item(AUTH_FILE, 0.9), item(AUTH_CLASS, 0.8), item(LOGIN_METHOD, 0.7)],
      { strategy: "hybrid" },
    );
    expect(pkg.files.some((file) => file.path === "src/auth/auth-service.ts")).toBe(true);
    expect(pkg.symbols).toHaveLength(0);
  });

  it("carries symbol code and relations when the file is not included", async () => {
    const pkg = await makeBuilder().build("login", [item(AUTH_CLASS, 0.9)], {
      strategy: "hybrid",
    });
    const symbol = pkg.symbols.find((entry) => entry.id === AUTH_CLASS);
    expect(symbol?.code).toContain("async login(");
    expect(symbol?.relations.length).toBeGreaterThan(0);
    // The class is instantiated by startServer (and the fixture test).
    expect(symbol?.relations.join(" ")).toContain("startServer");

    const methodPkg = await makeBuilder().build("login", [item(LOGIN_METHOD, 0.9)], {
      strategy: "hybrid",
    });
    const method = methodPkg.symbols.find((entry) => entry.id === LOGIN_METHOD);
    expect(method?.relations.join(" ")).toContain("handle");
  });

  it("skips methods whose class card is already included", async () => {
    const pkg = await makeBuilder().build(
      "login",
      [item(AUTH_CLASS, 0.9), item(LOGIN_METHOD, 0.8)],
      { strategy: "hybrid" },
    );
    expect(pkg.symbols.map((entry) => entry.id)).toEqual([AUTH_CLASS]);
  });

  it("degrades to compressed views under a tight budget", async () => {
    const pkg = await makeBuilder(320).build("auth", [item(AUTH_FILE, 0.9)], {
      strategy: "hybrid",
      includeArchitecture: false,
      includeRecommendations: false,
    });
    const file = pkg.files[0];
    expect(file?.representation).toBe("compressed");
    expect(file?.content).toContain("compressed view");
    expect(pkg.tokens.used).toBeLessThanOrEqual(320);
  });

  it("emits deterministic output", async () => {
    const build = () =>
      makeBuilder().build(
        "authentication",
        [item(AUTH_FILE, 0.9), item(AUTH_CLASS, 0.8), item(CRYPTO_FILE, 0.4, 2)],
        { strategy: "hybrid", indexedAt: "2026-01-01T00:00:00.000Z" },
      );
    const [first, second] = await Promise.all([build(), build()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("produces graph-driven recommendations", async () => {
    const pkg = await makeBuilder().build("auth", [item(AUTH_CLASS, 0.9)], {
      strategy: "hybrid",
    });
    expect(pkg.recommendations.length).toBeGreaterThan(0);
    expect(pkg.recommendations[0]).toContain("Start with AuthService");
    expect(pkg.recommendations.join(" ")).toContain("tests/auth-service.test.ts");
  });
});

describe("renderers", () => {
  let pkg: ContextPackage;

  beforeAll(async () => {
    pkg = await makeBuilder().build(
      'auth & tokens <"escaped">',
      [item(AUTH_FILE, 0.9), item(CRYPTO_FILE, 0.5, 1)],
      { strategy: "hybrid" },
    );
  });

  it("renders markdown with sections and fences", () => {
    const markdown = renderMarkdown(pkg);
    expect(markdown).toContain("# Repository Context");
    expect(markdown).toContain("## Files");
    expect(markdown).toContain("### src/auth/auth-service.ts");
    expect(markdown).toContain("```ts");
    expect(markdown).toContain("## Recommendations");
  });

  it("renders well-formed XML with escaping and CDATA", () => {
    const xml = renderXml(pkg);
    expect(xml).toContain('query="auth &amp; tokens &lt;&quot;escaped&quot;&gt;"');
    expect(xml).toContain("<![CDATA[");
    expect(xml).toContain('<file path="src/auth/auth-service.ts"');
    expect(xml.trim().endsWith("</context>")).toBe(true);
  });

  it("renders JSON that parses back to the package", () => {
    const parsed = JSON.parse(renderJson(pkg)) as ContextPackage;
    expect(parsed.files.length).toBe(pkg.files.length);
    expect(parsed.tokens.budget).toBe(pkg.tokens.budget);
  });

  it("escapes CDATA terminators inside content", async () => {
    const evil: ContextPackage = {
      ...pkg,
      files: [
        {
          path: "x.ts",
          reason: "test",
          representation: "full",
          content: 'const s = "]]>";',
          tokens: 5,
          score: 1,
        },
      ],
      symbols: [],
    };
    const xml = renderXml(evil);
    expect(xml).toContain("]]]]><![CDATA[>");
  });
});
