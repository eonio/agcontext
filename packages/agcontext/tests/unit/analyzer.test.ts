import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TypeScriptAnalyzer } from "../../src/indexing/analyzer.js";
import { FIXTURE_REPO } from "../helpers/testkit.js";

const analyzer = new TypeScriptAnalyzer();

async function analyzeFixture(rel: string) {
  const content = await readFile(path.join(FIXTURE_REPO, ...rel.split("/")), "utf8");
  const analysis = analyzer.analyze(rel, content);
  expect(analysis).toBeDefined();
  return analysis as NonNullable<typeof analysis>;
}

describe("TypeScriptAnalyzer on the fixture", () => {
  it("extracts classes, methods, and docs from auth-service", async () => {
    const analysis = await analyzeFixture("src/auth/auth-service.ts");
    const byPath = new Map(analysis.symbols.map((symbol) => [symbol.symbolPath, symbol]));

    const service = byPath.get("AuthService");
    expect(service?.kind).toBe("class");
    expect(service?.exported).toBe(true);
    expect(service?.doc).toContain("authentication");
    expect(service?.compositionNames).toContain("UserRepository");

    const login = byPath.get("AuthService.login");
    expect(login?.kind).toBe("method");
    expect(login?.parent).toBe("AuthService");
    expect(login?.doc).toContain("Authenticates");
    const callNames = login?.calls.map((call) => call.name) ?? [];
    expect(callNames).toContain("findByEmail");
    expect(callNames).toContain("verifyPassword");
    expect(callNames).toContain("issueToken");
    const issueCall = login?.calls.find((call) => call.name === "issueToken");
    expect(issueCall?.receiver).toBe("this");

    const issueToken = byPath.get("AuthService.issueToken");
    expect(issueToken?.calls.map((call) => call.name)).toContain("signToken");
    expect(issueToken?.typeRefs).toContain("TokenPayload");

    const authResult = byPath.get("AuthResult");
    expect(authResult?.kind).toBe("interface");
    expect(analysis.exports.map((binding) => binding.exported)).toEqual(
      expect.arrayContaining(["AuthService", "AuthResult"]),
    );
  });

  it("captures import bindings including type-only names", async () => {
    const analysis = await analyzeFixture("src/auth/auth-service.ts");
    const specifiers = analysis.imports.map((entry) => entry.specifier);
    expect(specifiers).toEqual(
      expect.arrayContaining(["../users/user-repository.js", "../utils/crypto.js", "./token.js"]),
    );
    const tokenImport = analysis.imports.find((entry) => entry.specifier === "./token.js");
    expect(tokenImport?.bindings).toEqual(
      expect.arrayContaining([
        { local: "signToken", imported: "signToken" },
        { local: "TokenPayload", imported: "TokenPayload" },
      ]),
    );
  });

  it("records inheritance and overrides in user-repository", async () => {
    const analysis = await analyzeFixture("src/users/user-repository.ts");
    const repo = analysis.symbols.find((symbol) => symbol.symbolPath === "UserRepository");
    expect(repo?.extendsNames).toEqual(["BaseRepository"]);
    const iface = analysis.symbols.find((symbol) => symbol.symbolPath === "User");
    expect(iface?.kind).toBe("interface");
  });

  it("records re-exports, star exports, and top-level calls in the barrel", async () => {
    const analysis = await analyzeFixture("src/index.ts");
    expect(analysis.reexports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "./users/user-repository.js", names: "*" }),
      ]),
    );
    const authReexport = analysis.reexports.find(
      (entry) => entry.specifier === "./auth/auth-service.js",
    );
    expect(authReexport?.names).toEqual(
      expect.arrayContaining([{ imported: "AuthService", exported: "AuthService" }]),
    );
    expect(analysis.fileCalls.map((call) => call.name)).toContain("startServer");
  });

  it("captures instantiations and external receivers in server.ts", async () => {
    const analysis = await analyzeFixture("src/server.ts");
    const start = analysis.symbols.find((symbol) => symbol.symbolPath === "startServer");
    const news = start?.calls.filter((call) => call.isNew).map((call) => call.name) ?? [];
    expect(news).toEqual(
      expect.arrayContaining(["Database", "UserRepository", "AuthService", "LoginController"]),
    );
    expect(start?.calls.map((call) => call.name)).toContain("express");
  });
});

describe("TypeScriptAnalyzer edge cases", () => {
  it("handles aliased exports, defaults, variables, enums, and types", () => {
    const source = [
      "/** Internal helper. */",
      "function helperImpl(a: number): number { return a * 2; }",
      "export { helperImpl as helper };",
      "",
      "export default class Widget { render(): string { return draw(); } }",
      "",
      "function draw(): string { return 'x'; }",
      "",
      "/** Feature flags. */",
      "export const flags = { dark: true };",
      "",
      "export enum Mode { On, Off }",
      "",
      "export type WidgetProps = { mode: Mode };",
    ].join("\n");
    const analysis = analyzer.analyze("src/widget.ts", source);
    expect(analysis).toBeDefined();
    const exports = new Map(analysis?.exports.map((b) => [b.exported, b.symbolPath]));
    expect(exports.get("helper")).toBe("helperImpl");
    // `export default class Widget` keeps its own name; the export is "default".
    expect(exports.get("default")).toBe("Widget");
    expect(exports.get("flags")).toBe("flags");
    const byPath = new Map(analysis?.symbols.map((symbol) => [symbol.symbolPath, symbol]));
    expect(byPath.get("helperImpl")?.exported).toBe(true);
    expect(byPath.get("Widget")?.defaultExport).toBe(true);
    expect(byPath.get("flags")?.kind).toBe("variable");
    expect(byPath.get("Mode")?.kind).toBe("enum");
    expect(byPath.get("WidgetProps")?.kind).toBe("type");
    expect(byPath.get("Widget.render")?.calls.map((call) => call.name)).toContain("draw");
  });

  it("treats require() as an import and namespaces as prefixes", () => {
    const source = [
      'const fs = require("node:fs");',
      "export namespace Outer {",
      "  export function inner(): void { fs.readFileSync('x'); }",
      "}",
    ].join("\n");
    const analysis = analyzer.analyze("src/legacy.ts", source);
    expect(analysis?.imports[0]).toEqual({
      specifier: "node:fs",
      bindings: [{ local: "fs", imported: "*" }],
      typeOnly: false,
    });
    const inner = analysis?.symbols.find((symbol) => symbol.symbolPath === "Outer.inner");
    expect(inner?.exported).toBe(true);
    expect(inner?.calls.map((call) => `${call.receiver}.${call.name}`)).toContain(
      "fs.readFileSync",
    );
  });

  it("merges overload declarations into one symbol", () => {
    const source = [
      "export function pick(value: string): string;",
      "export function pick(value: number): number;",
      "export function pick(value: unknown): unknown { return value; }",
    ].join("\n");
    const analysis = analyzer.analyze("src/pick.ts", source);
    const picks = analysis?.symbols.filter((symbol) => symbol.name === "pick");
    expect(picks).toHaveLength(1);
    expect(picks?.[0]?.endLine).toBe(3);
  });

  it("survives malformed input without throwing", () => {
    expect(analyzer.analyze("src/broken.ts", "class {{{ ??? }")).toBeDefined();
  });
});
