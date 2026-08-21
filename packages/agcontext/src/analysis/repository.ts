import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  NodeKind,
  type DirectoryProfile,
  type HotspotFile,
  type OwnershipRecord,
  type PackageEntrypoint,
  type RepositoryAnalysis,
} from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";
import type { FileAnalysis } from "../indexing/analyzer.js";
import type { GitStats } from "../indexing/git.js";

export interface RepositoryAnalyzerInput {
  root: string;
  graph: CodeGraph;
  analyses: readonly FileAnalysis[];
  gitStats?: GitStats;
  now: number;
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  type?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Known dependency → framework/stack label, in deterministic display order. */
const FRAMEWORK_SIGNALS: Array<[dep: string, label: string]> = [
  ["react", "React"],
  ["next", "Next.js"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["solid-js", "SolidJS"],
  ["astro", "Astro"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"],
  ["electron", "Electron"],
  ["commander", "Commander (CLI)"],
  ["yargs", "Yargs (CLI)"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["typeorm", "TypeORM"],
  ["mongoose", "Mongoose"],
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["vite", "Vite"],
  ["webpack", "Webpack"],
  ["esbuild", "esbuild"],
  ["typescript", "TypeScript"],
];

const DIR_ROLES: Array<[pattern: RegExp, role: string]> = [
  [/^(src|lib|source)$/, "source"],
  [/^(tests?|__tests__|test-utils|spec)$/, "tests"],
  [/^(docs?|documentation)$/, "documentation"],
  [/^examples?$/, "examples"],
  [/^(scripts?|tools?|bin)$/, "tooling"],
  [/^(packages|apps|services)$/, "workspace packages"],
  [/^(config|configs?)$/, "configuration"],
  [/^(public|assets|static)$/, "assets"],
  [/^(e2e|integration)$/, "tests"],
];

/**
 * Repository intelligence (phase 6): package identity, language mix,
 * frameworks, architecture patterns, layout roles, dependency structure,
 * hotspots, and ownership — everything the architecture summary and the
 * ranking heuristics feed on. All derivations are deterministic.
 */
export async function analyzeRepository(
  input: RepositoryAnalyzerInput,
): Promise<RepositoryAnalysis> {
  const pkg = await readPackageJson(input.root);
  const analyses = input.analyses;

  /* Languages. */
  const languages: Record<string, { files: number; loc: number }> = {};
  let locTotal = 0;
  for (const analysis of analyses) {
    const label = analysis.language === "ts" ? "TypeScript" : "JavaScript";
    const entry = (languages[label] ??= { files: 0, loc: 0 });
    entry.files++;
    entry.loc += analysis.loc;
    locTotal += analysis.loc;
  }

  /* Layout: top-level directories with roles. */
  const dirAgg = new Map<string, { files: number; loc: number }>();
  for (const analysis of analyses) {
    const top = analysis.path.includes("/") ? (analysis.path.split("/")[0] as string) : ".";
    const entry = dirAgg.get(top) ?? { files: 0, loc: 0 };
    entry.files++;
    entry.loc += analysis.loc;
    dirAgg.set(top, entry);
  }
  const layout: DirectoryProfile[] = [...dirAgg.entries()]
    .sort((a, b) => b[1].files - a[1].files || (a[0] < b[0] ? -1 : 1))
    .map(([dir, agg]) => ({
      path: dir,
      role: dir === "." ? "root files" : roleFor(dir),
      files: agg.files,
      loc: agg.loc,
    }));

  /* Entrypoints. */
  const entrypoints = collectEntrypoints(pkg);

  /* Frameworks. */
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const frameworks = FRAMEWORK_SIGNALS.filter(([dep]) => allDeps[dep] !== undefined).map(
    ([, label]) => label,
  );

  /* Patterns. */
  const patterns = detectPatterns(input.root, pkg, analyses);

  /* Module graph summaries. */
  const fileNodes = [...input.graph.allNodes()].filter((node) => node.kind === NodeKind.File);
  const topImported = fileNodes
    .filter((node) => (node.metrics.fanIn ?? 0) > 0)
    .sort((a, b) => (b.metrics.fanIn ?? 0) - (a.metrics.fanIn ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
    .map((node) => ({ path: node.path ?? "", fanIn: node.metrics.fanIn ?? 0 }));
  const topCentral = fileNodes
    .filter((node) => node.metrics.centrality !== undefined)
    .sort(
      (a, b) => (b.metrics.centrality ?? 0) - (a.metrics.centrality ?? 0) || (a.id < b.id ? -1 : 1),
    )
    .slice(0, 8)
    .map((node) => ({ path: node.path ?? "", centrality: round3(node.metrics.centrality ?? 0) }));
  const externalDependencies = [...input.graph.allNodes()]
    .filter((node) => node.kind === NodeKind.Module)
    .map((node) => ({ name: node.name, usedBy: input.graph.inEdges(node.id).length }))
    .sort((a, b) => b.usedBy - a.usedBy || (a.name < b.name ? -1 : 1))
    .slice(0, 12);

  /* Hotspots: churn + structural hubs. */
  const hotspots: HotspotFile[] = [];
  const seenHotspots = new Set<string>();
  const gitAvailable = input.gitStats?.available === true;
  if (gitAvailable && input.gitStats) {
    const churn = [...input.gitStats.files.entries()]
      .filter(([filePath]) => input.graph.fileNode(filePath) !== undefined)
      .sort((a, b) => b[1].commitCount - a[1].commitCount || (a[0] < b[0] ? -1 : 1))
      .slice(0, 6);
    for (const [filePath, stats] of churn) {
      hotspots.push({
        path: filePath,
        commitCount: stats.commitCount,
        reason: `high churn (${stats.commitCount} commits)`,
      });
      seenHotspots.add(filePath);
    }
  }
  for (const central of topCentral.slice(0, 6)) {
    if (seenHotspots.has(central.path)) continue;
    hotspots.push({
      path: central.path,
      centrality: central.centrality,
      reason: "structural hub (high centrality)",
    });
    seenHotspots.add(central.path);
    if (hotspots.length >= 10) break;
  }

  /* Ownership per top-level directory. */
  const ownership: OwnershipRecord[] = [];
  if (gitAvailable && input.gitStats) {
    const byDir = new Map<string, Map<string, number>>();
    for (const [filePath, stats] of input.gitStats.files) {
      const top = filePath.includes("/") ? (filePath.split("/")[0] as string) : ".";
      const authors = byDir.get(top) ?? new Map<string, number>();
      for (const [author, count] of Object.entries(stats.authors)) {
        authors.set(author, (authors.get(author) ?? 0) + count);
      }
      byDir.set(top, authors);
    }
    const rows = [...byDir.entries()]
      .map(([dir, authors]) => {
        const total = [...authors.values()].reduce((sum, count) => sum + count, 0);
        const [topAuthor, topCount] = [...authors.entries()].sort(
          (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
        )[0] ?? ["", 0];
        return {
          path: dir,
          topAuthor,
          share: total > 0 ? round3(topCount / total) : 0,
          authors: authors.size,
          total,
        };
      })
      .sort((a, b) => b.total - a.total || (a.path < b.path ? -1 : 1))
      .slice(0, 8);
    for (const row of rows) {
      ownership.push({
        path: row.path,
        topAuthor: row.topAuthor,
        share: row.share,
        authors: row.authors,
      });
    }
  }

  return {
    name: pkg.name ?? path.basename(input.root),
    ...(pkg.version !== undefined ? { version: pkg.version } : {}),
    ...(pkg.description !== undefined ? { description: pkg.description } : {}),
    root: input.root,
    filesTotal: analyses.length,
    locTotal,
    languages,
    entrypoints,
    frameworks,
    patterns,
    layout,
    topImported,
    topCentral,
    externalDependencies,
    hotspots,
    ownership,
    generatedAt: new Date(input.now).toISOString(),
  };
}

/** Repo-relative entrypoint paths from package.json (used by ranking metrics). */
export async function packageEntrypointPaths(root: string): Promise<Set<string>> {
  const pkg = await readPackageJson(root);
  return new Set(collectEntrypoints(pkg).map((entry) => entry.path));
}

async function readPackageJson(root: string): Promise<PackageJson> {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

function roleFor(dir: string): string {
  for (const [pattern, role] of DIR_ROLES) {
    if (pattern.test(dir)) return role;
  }
  return "source";
}

function collectEntrypoints(pkg: PackageJson): PackageEntrypoint[] {
  const out: PackageEntrypoint[] = [];
  const push = (kind: PackageEntrypoint["kind"], value: unknown): void => {
    if (typeof value !== "string" || value.length === 0) return;
    const normalized = value.replace(/^\.\//, "");
    if (!out.some((e) => e.path === normalized && e.kind === kind)) {
      out.push({ kind, path: normalized });
    }
  };
  push("main", pkg.main);
  push("module", pkg.module);
  push("types", pkg.types);
  if (typeof pkg.bin === "string") push("bin", pkg.bin);
  else if (pkg.bin) for (const value of Object.values(pkg.bin)) push("bin", value);
  collectExportStrings(pkg.exports, (value) => push("exports", value));
  return out;
}

function collectExportStrings(value: unknown, sink: (path: string) => void, depth = 0): void {
  if (depth > 4) return;
  if (typeof value === "string") {
    sink(value);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectExportStrings(entry, sink, depth + 1);
    }
  }
}

function detectPatterns(
  root: string,
  pkg: PackageJson,
  analyses: readonly FileAnalysis[],
): string[] {
  const patterns: string[] = [];

  if (
    pkg.workspaces !== undefined ||
    existsSync(path.join(root, "pnpm-workspace.yaml")) ||
    existsSync(path.join(root, "lerna.json"))
  ) {
    patterns.push("monorepo (workspaces)");
  }
  if (pkg.type === "module") patterns.push("ESM package");
  if (pkg.bin !== undefined) patterns.push("ships a CLI (bin entries)");

  /* Barrel usage: directories whose index file re-exports. */
  const dirsWithFiles = new Set<string>();
  let barrels = 0;
  for (const analysis of analyses) {
    const dir = analysis.path.includes("/")
      ? analysis.path.slice(0, analysis.path.lastIndexOf("/"))
      : ".";
    dirsWithFiles.add(dir);
    if (/(^|\/)index\.[cm]?[jt]sx?$/.test(analysis.path) && analysis.reexports.length > 0) {
      barrels++;
    }
  }
  if (dirsWithFiles.size > 0 && barrels / dirsWithFiles.size >= 0.3) {
    patterns.push("barrel exports (index.* re-export modules)");
  }

  /* Layered backend structure. */
  const dirNames = new Set<string>();
  for (const analysis of analyses) {
    for (const segment of analysis.path.split("/").slice(0, -1)) dirNames.add(segment);
  }
  const hasEntryLayer = ["controllers", "routes", "handlers", "http", "api"].some((d) =>
    dirNames.has(d),
  );
  const hasServiceLayer = ["services", "usecases", "domain", "core"].some((d) => dirNames.has(d));
  const hasDataLayer = ["repositories", "models", "db", "dao", "entities", "data"].some((d) =>
    dirNames.has(d),
  );
  if (hasEntryLayer && hasServiceLayer && hasDataLayer) {
    patterns.push("layered architecture (entry/service/data layers)");
  }
  if (["components", "pages", "hooks"].filter((d) => dirNames.has(d)).length >= 2) {
    patterns.push("component-based UI structure");
  }

  /* Test placement. */
  const colocated = analyses.some((a) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(a.path));
  const testDir = analyses.some((a) => /(^|\/)(tests?|__tests__)\//.test(a.path));
  if (colocated && !testDir) patterns.push("co-located tests");
  else if (testDir) patterns.push("dedicated test directories");

  return patterns;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
