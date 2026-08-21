import path from "node:path";

/**
 * All repo-relative paths inside AGContext are POSIX-style regardless of
 * platform, so graph ids, caches, and rendered context are identical on
 * Windows and Linux.
 */

export function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

/** Repo-relative POSIX path of `absPath` under `root`. */
export function relFromRoot(root: string, absPath: string): string {
  return toPosix(path.relative(root, absPath));
}

/** Absolute platform path for a repo-relative POSIX path. */
export function absFromRoot(root: string, relPosix: string): string {
  return path.resolve(root, relPosix.split("/").join(path.sep));
}

/** POSIX dirname; returns "" for top-level entries. */
export function posixDirname(relPosix: string): string {
  const idx = relPosix.lastIndexOf("/");
  return idx === -1 ? "" : relPosix.slice(0, idx);
}

/** All ancestor directories of a repo-relative path, outermost first. */
export function ancestorDirs(relPosix: string): string[] {
  const dirs: string[] = [];
  const parts = relPosix.split("/");
  for (let i = 1; i < parts.length; i++) {
    dirs.push(parts.slice(0, i).join("/"));
  }
  return dirs;
}

/** Basename without extension. */
export function stem(relPosix: string): string {
  const base = relPosix.slice(relPosix.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

export function extensionOf(relPosix: string): string {
  const base = relPosix.slice(relPosix.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}
