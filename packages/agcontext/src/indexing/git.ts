import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileGitStats {
  commitCount: number;
  /** Epoch milliseconds of the newest commit touching the file. */
  lastCommitAt: number;
  /** Author name → commits by that author touching the file. */
  authors: Record<string, number>;
}

export interface GitStats {
  available: boolean;
  files: Map<string, FileGitStats>;
}

export interface GitOptions {
  windowDays: number;
  maxCommits: number;
}

/**
 * Collects per-file git activity in a single `git log` pass. Fails soft: a
 * missing git binary or a non-repository yields `{available: false}` and the
 * ranking engine simply drops the activity/recency/ownership signals.
 */
export async function collectGitStats(root: string, options: GitOptions): Promise<GitStats> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "log",
        `--since=${options.windowDays}.days`,
        `--max-count=${options.maxCommits}`,
        // \x01-prefixed header lines are unambiguous against file paths.
        "--pretty=format:%x01%an%x01%at",
        "--name-only",
        "--relative",
        "--no-renames",
      ],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    stdout = result.stdout;
  } catch {
    return { available: false, files: new Map() };
  }
  return { available: true, files: parseLog(stdout) };
}

function parseLog(stdout: string): Map<string, FileGitStats> {
  const files = new Map<string, FileGitStats>();
  let author = "";
  let timestampMs = 0;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (line.startsWith("\x01")) {
      const parts = line.slice(1).split("\x01");
      author = parts[0] ?? "";
      timestampMs = Number(parts[1] ?? "0") * 1000;
      continue;
    }
    const filePath = unquoteGitPath(line);
    if (filePath.length === 0) continue;
    let entry = files.get(filePath);
    if (!entry) {
      entry = { commitCount: 0, lastCommitAt: 0, authors: {} };
      files.set(filePath, entry);
    }
    entry.commitCount++;
    entry.lastCommitAt = Math.max(entry.lastCommitAt, timestampMs);
    if (author.length > 0) {
      entry.authors[author] = (entry.authors[author] ?? 0) + 1;
    }
  }
  return files;
}

/** Git quotes paths containing non-ASCII or special characters. */
function unquoteGitPath(line: string): string {
  if (!line.startsWith('"') || !line.endsWith('"')) return line;
  return line.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}
