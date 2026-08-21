import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { DEFAULT_IGNORES } from "../config/defaults.js";
import { extensionOf } from "../core/paths.js";

export interface ScannedFile {
  /** Repo-relative POSIX path. */
  path: string;
  absPath: string;
  size: number;
  mtimeMs: number;
}

export interface ScanOptions {
  root: string;
  /** Lowercased extensions including the dot. */
  extensions: string[];
  /** Extra gitignore-style patterns. */
  exclude: string[];
  maxFileSizeBytes: number;
}

/**
 * Walks the repository and returns indexable source files, honoring built-in
 * ignores, the root `.gitignore`, and configured excludes. Output is sorted
 * by path so every downstream artifact is deterministic. Symlinks are skipped
 * to avoid cycles and out-of-tree traversal.
 */
export async function scanRepository(options: ScanOptions): Promise<ScannedFile[]> {
  const matcher = ignore();
  matcher.add([...DEFAULT_IGNORES]);
  try {
    const gitignore = await readFile(path.join(options.root, ".gitignore"), "utf8");
    matcher.add(gitignore.split(/\r?\n/).filter((line) => line.length > 0));
  } catch {
    // no .gitignore — fine
  }
  if (options.exclude.length > 0) matcher.add(options.exclude);

  const extensions = new Set(options.extensions);
  const results: ScannedFile[] = [];

  const walk = async (rel: string): Promise<void> => {
    const absDir = rel === "" ? options.root : path.join(options.root, ...rel.split("/"));
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (matcher.ignores(`${childRel}/`)) continue;
        await walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.has(extensionOf(childRel))) continue;
      if (matcher.ignores(childRel)) continue;
      const absPath = path.join(absDir, entry.name);
      let stats;
      try {
        stats = await stat(absPath);
      } catch {
        continue;
      }
      if (stats.size > options.maxFileSizeBytes) continue;
      results.push({ path: childRel, absPath, size: stats.size, mtimeMs: stats.mtimeMs });
    }
  };

  await walk("");
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}
