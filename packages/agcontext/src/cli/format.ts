import pc from "picocolors";
import type { DoctorCheck, RetrievedItem, SignalMap } from "../core/types.js";

/** Plain-text table with padded columns. Colors are added by callers per-cell-free. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const renderRow = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ");
  const lines = [
    pc.bold(renderRow(headers)),
    pc.dim(widths.map((width) => "-".repeat(width)).join("  ")),
    ...rows.map((row) => renderRow(row)),
  ];
  return lines.join("\n");
}

export function heading(text: string): string {
  return pc.bold(pc.cyan(text));
}

export function formatScore(score: number): string {
  return score.toFixed(3);
}

export function statusBadge(status: DoctorCheck["status"]): string {
  switch (status) {
    case "pass":
      return pc.green("pass");
    case "warn":
      return pc.yellow("warn");
    case "fail":
      return pc.red("FAIL");
  }
}

const SIGNAL_ABBREVIATIONS: Record<string, string> = {
  semantic: "sem",
  lexical: "lex",
  graph: "gph",
  centrality: "ctr",
  importance: "imp",
  activity: "act",
  recency: "rec",
  dependency: "dep",
  usage: "use",
};

/** Compact top-3 signal readout, e.g. `lex .91 gph .55 imp .40`. */
export function formatSignals(signals: SignalMap): string {
  return Object.entries(signals)
    .filter(([, value]) => value >= 0.005)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name, value]) => `${SIGNAL_ABBREVIATIONS[name] ?? name} ${value.toFixed(2).slice(1)}`)
    .join(" ");
}

export function itemLocation(item: RetrievedItem): string {
  return item.startLine !== undefined ? `${item.path}:${item.startLine}` : item.path;
}

export function resultTable(items: readonly RetrievedItem[]): string {
  return table(
    ["#", "score", "kind", "name", "location", "signals", "via"],
    items.map((item, i) => [
      String(i + 1),
      formatScore(item.score),
      item.kind,
      item.name,
      itemLocation(item),
      formatSignals(item.signals),
      item.sources.join("+") + (item.depth !== undefined && item.depth > 0 ? `@${item.depth}` : ""),
    ]),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}
