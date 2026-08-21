import { NodeKind, type RepositoryAnalysis } from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";

/**
 * Architecture summary (phase 9): a compact, deterministic bullet list an
 * agent can absorb in a few hundred tokens — what the repository is, how it
 * is laid out, and which files carry the structure.
 */
export function architectureSummary(
  report: RepositoryAnalysis | undefined,
  graph: CodeGraph,
): string[] {
  const lines: string[] = [];

  if (report) {
    const identity = [report.name, report.version ? `v${report.version}` : undefined]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `${identity}${report.description ? ` — ${report.description}` : ""} (${report.filesTotal} source files, ${formatLoc(report.locTotal)} LOC)`,
    );
    const languages = Object.entries(report.languages)
      .sort((a, b) => b[1].loc - a[1].loc)
      .map(([language, info]) => `${language} (${info.files} files)`)
      .join(", ");
    if (languages) lines.push(`Languages: ${languages}`);
    if (report.frameworks.length > 0) lines.push(`Stack: ${report.frameworks.join(", ")}`);
    for (const pattern of report.patterns) lines.push(`Pattern: ${pattern}`);
    for (const dir of report.layout.slice(0, 10)) {
      lines.push(`${dir.path}/ — ${dir.role} (${dir.files} files, ${formatLoc(dir.loc)} LOC)`);
    }
    if (report.entrypoints.length > 0) {
      lines.push(
        `Entrypoints: ${report.entrypoints.map((e) => `${e.path} (${e.kind})`).join(", ")}`,
      );
    }
    if (report.topCentral.length > 0) {
      lines.push(
        `Most central files: ${report.topCentral
          .slice(0, 5)
          .map((f) => f.path)
          .join(", ")}`,
      );
    }
    return lines;
  }

  /* Fallback when no repository analysis is cached: derive from the graph. */
  const stats = graph.stats();
  lines.push(
    `${stats.nodesByKind[NodeKind.File] ?? 0} source files, ${stats.nodes} graph nodes, ${stats.edges} edges`,
  );
  const central = [...graph.allNodes()]
    .filter((node) => node.kind === NodeKind.File && node.metrics.centrality !== undefined)
    .sort(
      (a, b) => (b.metrics.centrality ?? 0) - (a.metrics.centrality ?? 0) || (a.id < b.id ? -1 : 1),
    )
    .slice(0, 5)
    .map((node) => node.path ?? node.name);
  if (central.length > 0) lines.push(`Most central files: ${central.join(", ")}`);
  return lines;
}

function formatLoc(loc: number): string {
  return loc >= 1000 ? `${(loc / 1000).toFixed(1)}k` : String(loc);
}
