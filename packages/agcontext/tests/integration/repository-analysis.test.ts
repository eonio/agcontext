import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { copyFixtureRepo, removeDir, testAppOptions } from "../helpers/testkit.js";

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

describe("repository analysis (phase 6)", () => {
  it("captures package identity, languages, and entrypoints", async () => {
    const report = await app.repositoryAnalysis();
    expect(report.name).toBe("sample-app");
    expect(report.version).toBe("1.0.0");
    expect(report.languages["TypeScript"]?.files).toBe(11);
    expect(report.locTotal).toBeGreaterThan(100);
    expect(report.entrypoints).toEqual(
      expect.arrayContaining([{ kind: "main", path: "src/index.ts" }]),
    );
  });

  it("detects frameworks and structural patterns", async () => {
    const report = await app.repositoryAnalysis();
    expect(report.frameworks).toContain("Express");
    expect(report.patterns).toContain("ESM package");
    expect(report.patterns).toContain("dedicated test directories");
  });

  it("profiles the layout with roles", async () => {
    const report = await app.repositoryAnalysis();
    const src = report.layout.find((dir) => dir.path === "src");
    expect(src?.role).toBe("source");
    expect(src?.files).toBe(10);
    const tests = report.layout.find((dir) => dir.path === "tests");
    expect(tests?.role).toBe("tests");
  });

  it("surfaces dependency structure and hotspots", async () => {
    const report = await app.repositoryAnalysis();
    expect(report.topImported.map((entry) => entry.path)).toContain("src/auth/auth-service.ts");
    expect(report.externalDependencies.map((entry) => entry.name)).toContain("express");
    expect(report.topCentral.length).toBeGreaterThan(0);
    expect(report.hotspots.length).toBeGreaterThan(0);
    // No git in the temp fixture — hotspots come from centrality.
    expect(report.hotspots.every((hotspot) => hotspot.reason.includes("centrality"))).toBe(true);
    expect(report.ownership).toEqual([]);
  });
});
