import type { GraphNode } from "../core/types.js";
import type { FileAnalysis, SymbolInfo } from "../indexing/analyzer.js";

/**
 * Repomix-inspired compression (phase 9): keep the shape, drop the bodies.
 * A compressed file preserves imports, exported surface, signatures, and doc
 * lines — typically 5-15x fewer tokens than the source while keeping what an
 * agent needs to navigate.
 */
export function fileSummary(analysis: FileAnalysis): string {
  const lines: string[] = [`// ${analysis.path} — compressed view (${analysis.loc} lines)`];

  for (const fileImport of analysis.imports) {
    const names = fileImport.bindings.map((binding) =>
      binding.imported === binding.local
        ? binding.local
        : `${binding.imported} as ${binding.local}`,
    );
    const clause =
      names.length > 0 ? `${fileImport.typeOnly ? "type " : ""}{ ${names.join(", ")} } ` : "";
    lines.push(`import ${clause}from "${fileImport.specifier}";`);
  }
  for (const reexport of analysis.reexports) {
    const clause =
      reexport.names === "*"
        ? "*"
        : `{ ${reexport.names
            .map((n) => (n.imported === n.exported ? n.exported : `${n.imported} as ${n.exported}`))
            .join(", ")} }`;
    lines.push(`export ${clause} from "${reexport.specifier}";`);
  }
  if (lines.length > 1) lines.push("");

  const children = new Map<string, SymbolInfo[]>();
  for (const symbol of analysis.symbols) {
    if (symbol.parent === undefined) continue;
    const bucket = children.get(symbol.parent);
    if (bucket) bucket.push(symbol);
    else children.set(symbol.parent, [symbol]);
  }

  for (const symbol of analysis.symbols) {
    if (symbol.parent !== undefined) continue;
    if (symbol.doc) lines.push(`/** ${symbol.doc} */`);
    const members = children.get(symbol.symbolPath) ?? [];
    if (members.length > 0) {
      lines.push(`${symbol.signature} {`);
      for (const member of members) {
        if (member.doc) lines.push(`  /** ${member.doc} */`);
        lines.push(`  ${member.signature};`);
      }
      lines.push("}");
    } else {
      lines.push(`${symbol.signature};`);
    }
  }

  const exported = analysis.exports.map((binding) => binding.exported);
  if (exported.length > 0) {
    lines.push("", `// exports: ${exported.join(", ")}`);
  }
  return lines.join("\n");
}

/** One-symbol card: identity, signature, doc, and relation notes (phase 9). */
export function symbolSummary(node: GraphNode, relations: readonly string[] = []): string {
  const lines: string[] = [];
  const location =
    node.file !== undefined
      ? `${node.file}${node.startLine !== undefined ? `:${node.startLine}-${node.endLine ?? node.startLine}` : ""}`
      : (node.path ?? "");
  lines.push(`${node.kind} ${node.name} — ${location}`);
  if (node.signature) lines.push(node.signature);
  if (node.doc) lines.push(`/** ${node.doc} */`);
  for (const relation of relations) lines.push(`- ${relation}`);
  return lines.join("\n");
}
