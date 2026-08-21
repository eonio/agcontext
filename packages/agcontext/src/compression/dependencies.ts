import { EdgeKind, NodeKind } from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";

/**
 * Dependency summary (phase 9) for a selected set of files: the import edges
 * *among* the selection (how the pieces the agent is looking at connect) and
 * the external packages the selection leans on.
 */
export function dependencySummary(
  selectedFiles: readonly string[],
  graph: CodeGraph,
  maxLines = 14,
): string[] {
  const selection = new Set(selectedFiles);
  const lines: string[] = [];

  const internal: Array<{ from: string; to: string; weight: number }> = [];
  for (const path of [...selection].sort()) {
    const node = graph.fileNode(path);
    if (!node) continue;
    for (const edge of graph.outEdges(node.id, [EdgeKind.Imports])) {
      const target = graph.node(edge.to);
      if (!target || target.kind !== NodeKind.File) continue;
      if (target.path !== undefined && selection.has(target.path)) {
        internal.push({ from: path, to: target.path, weight: edge.weight });
      }
    }
  }
  internal.sort((a, b) => b.weight - a.weight || (a.from < b.from ? -1 : 1));
  for (const link of internal.slice(0, maxLines)) {
    lines.push(
      `${link.from} imports ${link.to}${link.weight > 1 ? ` (${link.weight} bindings)` : ""}`,
    );
  }

  const external = new Map<string, number>();
  for (const path of selection) {
    const node = graph.fileNode(path);
    if (!node) continue;
    for (const edge of graph.outEdges(node.id, [EdgeKind.Imports])) {
      const target = graph.node(edge.to);
      if (target?.kind === NodeKind.Module) {
        external.set(target.name, (external.get(target.name) ?? 0) + 1);
      }
    }
  }
  const topExternal = [...external.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8);
  if (topExternal.length > 0) {
    lines.push(
      `External packages in play: ${topExternal
        .map(([name, count]) => (count > 1 ? `${name} (x${count})` : name))
        .join(", ")}`,
    );
  }
  return lines;
}
