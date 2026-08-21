import { sha1Hex } from "../core/hash.js";
import { truncateLines } from "../core/text.js";
import { NodeKind, type Chunk } from "../core/types.js";
import { SYMBOL_KIND_MAP, fileNodeId, symbolNodeId } from "../graph/builder.js";
import type { FileAnalysis } from "./analyzer.js";

export interface ChunkOptions {
  /** Hard cap on chunk text length. Default: 6000 chars (~1650 tokens). */
  maxChunkChars?: number;
}

/**
 * Builds the retrievable units for one file (phase 7 candidates):
 *
 * - one **file chunk** — a compressed signature view (path, imports, top-level
 *   signatures), cheap to index and great for path/name matching;
 * - one **symbol chunk** per top-level symbol — the verbatim source slice
 *   (with its JSDoc), which is what lexical and semantic retrieval score.
 *
 * Chunk ids equal graph node ids, so retrieval hits map straight onto the
 * graph without a join table.
 */
export function buildFileChunks(
  analysis: FileAnalysis,
  content: string,
  options: ChunkOptions = {},
): Chunk[] {
  const maxChars = options.maxChunkChars ?? 6000;
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  const fileName = analysis.path.slice(analysis.path.lastIndexOf("/") + 1);

  const headerLines: string[] = [`// ${analysis.path}`];
  for (const fileImport of analysis.imports) {
    const names = fileImport.bindings.map((b) => b.local).join(", ");
    headerLines.push(
      `import ${names.length > 0 ? `{ ${names} } ` : ""}from "${fileImport.specifier}"`,
    );
  }
  for (const reexport of analysis.reexports) {
    headerLines.push(`export … from "${reexport.specifier}"`);
  }
  for (const symbol of analysis.symbols) {
    if (symbol.parent !== undefined) continue;
    if (symbol.doc) headerLines.push(`/** ${symbol.doc} */`);
    headerLines.push(symbol.signature);
  }
  const fileText = truncateLines(headerLines.join("\n"), maxChars);
  chunks.push({
    id: fileNodeId(analysis.path),
    file: analysis.path,
    name: fileName,
    kind: NodeKind.File,
    text: fileText,
    hash: sha1Hex(fileText),
    startLine: 1,
    endLine: analysis.loc,
  });

  for (const symbol of analysis.symbols) {
    if (symbol.parent !== undefined) continue;
    const slice = lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
    const text = truncateLines(
      symbol.doc !== undefined ? `/** ${symbol.doc} */\n${slice}` : slice,
      maxChars,
    );
    chunks.push({
      id: symbolNodeId(analysis.path, symbol.symbolPath),
      file: analysis.path,
      name: symbol.name,
      kind: SYMBOL_KIND_MAP[symbol.kind],
      text,
      hash: sha1Hex(text),
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });
  }
  return chunks;
}
