import { EdgeKind, NodeKind, type RetrievedItem } from "../core/types.js";
import type { CodeGraph } from "../graph/graph.js";

export interface RecommendationInput {
  ranked: readonly RetrievedItem[];
  graph: CodeGraph;
  /** File paths whose content (full/compressed) made it into the package. */
  includedPaths: ReadonlySet<string>;
  max?: number;
}

const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$/;

/**
 * Actionable next-step notes derived from the graph (phase 11): where to
 * start, which call sites live outside the included set, and which tests
 * cover the selected area. Pure graph queries — deterministic, no LLM.
 */
export function buildRecommendations(input: RecommendationInput): string[] {
  const { ranked, graph, includedPaths } = input;
  const max = input.max ?? 6;
  const recommendations: string[] = [];
  const seen = new Set<string>();
  const push = (text: string): void => {
    if (recommendations.length >= max) return;
    if (seen.has(text)) return;
    seen.add(text);
    recommendations.push(text);
  };

  const top = ranked[0];
  if (top) {
    push(`Start with ${top.name} (${top.path}) — strongest combined relevance for this query.`);
  }

  /* Call sites and dependencies that did not make the cut. */
  const symbolItems = ranked.filter((item) => item.kind !== NodeKind.File).slice(0, 5);
  for (const item of symbolItems) {
    const callers = graph
      .inEdges(item.nodeId, [EdgeKind.Calls])
      .map((edge) => ({ edge, node: graph.node(edge.from) }))
      .filter(
        ({ node }) =>
          node !== undefined && node.file !== undefined && !includedPaths.has(node.file),
      )
      .sort((a, b) => b.edge.weight - a.edge.weight || (a.edge.from < b.edge.from ? -1 : 1));
    const caller = callers[0];
    if (caller?.node) {
      push(
        `${item.name} is called by ${caller.node.name} (${caller.node.file ?? ""}) — not included here; fetch it if you need the call site.`,
      );
    }
  }
  for (const item of symbolItems.slice(0, 3)) {
    const inheritance = graph.outEdges(item.nodeId, [EdgeKind.Inheritance])[0];
    if (inheritance) {
      const base = graph.node(inheritance.to);
      if (base) {
        const variant = inheritance.meta?.variant === "implements" ? "implements" : "extends";
        push(
          `${item.name} ${variant} ${base.name}${base.file ? ` (${base.file})` : ""} — behavior may live in the base type.`,
        );
      }
    }
  }

  /* Tests importing included files. */
  const testFiles: string[] = [];
  for (const path of [...includedPaths].sort()) {
    const fileNode = graph.fileNode(path);
    if (!fileNode) continue;
    for (const edge of graph.inEdges(fileNode.id, [EdgeKind.Imports])) {
      const importer = graph.node(edge.from);
      const importerPath = importer?.path;
      if (importerPath !== undefined && TEST_PATH_RE.test(importerPath)) {
        if (!testFiles.includes(importerPath)) testFiles.push(importerPath);
      }
    }
  }
  if (testFiles.length > 0) {
    push(`Tests covering this area: ${testFiles.sort().slice(0, 3).join(", ")}.`);
  }

  /* Barrel surface note. */
  for (const path of [...includedPaths].sort()) {
    const fileNode = graph.fileNode(path);
    if (!fileNode) continue;
    const barrel = graph
      .inEdges(fileNode.id, [EdgeKind.Imports])
      .map((edge) => graph.node(edge.from))
      .find((node) => node?.path !== undefined && /(^|\/)index\.[cm]?[jt]sx?$/.test(node.path));
    if (barrel?.path) {
      push(
        `${path} is re-exported through ${barrel.path} — external callers import from the barrel, not the file directly.`,
      );
      break;
    }
  }

  return recommendations;
}
