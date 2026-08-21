import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeRepository, packageEntrypointPaths } from "../../src/analysis/repository.js";
import { buildGraph } from "../../src/graph/builder.js";
import { TypeScriptAnalyzer, type FileAnalysis } from "../../src/indexing/analyzer.js";
import type { FileGitStats } from "../../src/indexing/git.js";
import { makeTempDir, removeDir } from "../helpers/testkit.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => removeDir(dir)));
});

async function workspaceRoot(): Promise<string> {
  const dir = await makeTempDir("analysis");
  tempDirs.push(dir);
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "workspace-app",
      version: "2.0.0",
      description: "monorepo demo",
      type: "module",
      workspaces: ["packages/*"],
      main: "./src/index.ts",
      bin: { wapp: "./src/cli.ts", wapp2: "./src/cli2.ts" },
      exports: { ".": { import: "./src/index.ts", types: "./src/index.d.ts" } },
      dependencies: { react: "^19.0.0", vitest: "^3.0.0" },
    }),
    "utf8",
  );
  await mkdir(path.join(dir, "src"), { recursive: true });
  return dir;
}

function analyzeSource(pathRel: string, source: string): FileAnalysis {
  return new TypeScriptAnalyzer().analyze(pathRel, source) as FileAnalysis;
}

describe("packageEntrypointPaths", () => {
  it("collects main, bin (object), and nested exports strings", async () => {
    const root = await workspaceRoot();
    const entrypoints = await packageEntrypointPaths(root);
    expect(entrypoints).toContain("src/index.ts");
    expect(entrypoints).toContain("src/cli.ts");
    expect(entrypoints).toContain("src/cli2.ts");
    expect(entrypoints).toContain("src/index.d.ts");
  });

  it("returns empty for directories without package.json", async () => {
    const dir = await makeTempDir("no-pkg");
    tempDirs.push(dir);
    expect((await packageEntrypointPaths(dir)).size).toBe(0);
  });
});

describe("analyzeRepository", () => {
  it("detects workspaces, frameworks, component structure, and ownership", async () => {
    const root = await workspaceRoot();
    const analyses = [
      analyzeSource(
        "src/components/button.tsx",
        'import { helper } from "../hooks/use-helper.js";\nexport function Button(): string { return helper(); }\n',
      ),
      analyzeSource(
        "src/hooks/use-helper.ts",
        "export function helper(): string { return 'x'; }\n",
      ),
      analyzeSource("src/pages/home.tsx", "export const Home = 1;\n"),
      analyzeSource("src/index.ts", 'export * from "./components/button.js";\n'),
    ];
    const graph = buildGraph({ rootName: "workspace-app", analyses });
    const now = 1_800_000_000_000;
    const gitFiles = new Map<string, FileGitStats>([
      [
        "src/components/button.tsx",
        { commitCount: 9, lastCommitAt: now - 1000, authors: { alice: 6, bob: 3 } },
      ],
      [
        "src/hooks/use-helper.ts",
        { commitCount: 2, lastCommitAt: now - 5000, authors: { bob: 2 } },
      ],
    ]);
    const report = await analyzeRepository({
      root,
      graph,
      analyses,
      gitStats: { available: true, files: gitFiles },
      now,
    });

    expect(report.name).toBe("workspace-app");
    expect(report.version).toBe("2.0.0");
    expect(report.patterns).toContain("monorepo (workspaces)");
    expect(report.patterns).toContain("ESM package");
    expect(report.patterns).toContain("ships a CLI (bin entries)");
    expect(report.patterns).toContain("component-based UI structure");
    expect(report.frameworks).toEqual(expect.arrayContaining(["React", "Vitest"]));
    expect(report.languages["TypeScript"]?.files).toBe(4);

    // Git-driven intelligence.
    const churn = report.hotspots.find((h) => h.path === "src/components/button.tsx");
    expect(churn?.reason).toContain("high churn (9 commits)");
    const ownership = report.ownership.find((o) => o.path === "src");
    expect(ownership?.topAuthor).toBe("alice");
    expect(ownership?.share).toBeCloseTo(6 / 11, 2);
    expect(ownership?.authors).toBe(2);
  });

  it("degrades gracefully without git or package metadata", async () => {
    const dir = await makeTempDir("bare");
    tempDirs.push(dir);
    const analyses = [analyzeSource("main.js", "exports.run = function run() { return 1; };\n")];
    const graph = buildGraph({ rootName: "bare", analyses });
    const report = await analyzeRepository({ root: dir, graph, analyses, now: 0 });
    expect(report.name).toBe(path.basename(dir));
    expect(report.languages["JavaScript"]?.files).toBe(1);
    expect(report.ownership).toEqual([]);
    expect(report.entrypoints).toEqual([]);
  });
});
