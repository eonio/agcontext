import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectGitStats } from "../../src/indexing/git.js";
import { makeTempDir, removeDir } from "../helpers/testkit.js";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();
let repo: string;

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeAll(async () => {
  repo = await makeTempDir("git");
  if (!hasGit) return;
  git(["init", "--initial-branch=main"], repo);
  git(["config", "user.email", "tester@example.com"], repo);
  git(["config", "user.name", "Test Author"], repo);
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "hot.ts"), "export const a = 1;\n", "utf8");
  await writeFile(path.join(repo, "src", "cold.ts"), "export const b = 1;\n", "utf8");
  git(["add", "."], repo);
  git(["commit", "-m", "initial"], repo);
  await writeFile(path.join(repo, "src", "hot.ts"), "export const a = 2;\n", "utf8");
  git(["add", "."], repo);
  git(["commit", "-m", "update hot"], repo);
});

afterAll(async () => {
  await removeDir(repo);
});

describe.skipIf(!hasGit)("collectGitStats", () => {
  it("aggregates per-file commit counts, recency, and authors", async () => {
    const stats = await collectGitStats(repo, { windowDays: 365, maxCommits: 100 });
    expect(stats.available).toBe(true);
    const hot = stats.files.get("src/hot.ts");
    const cold = stats.files.get("src/cold.ts");
    expect(hot?.commitCount).toBe(2);
    expect(cold?.commitCount).toBe(1);
    expect(hot?.lastCommitAt ?? 0).toBeGreaterThan(0);
    expect(hot?.authors["Test Author"]).toBe(2);
  });
});

describe("collectGitStats outside a repository", () => {
  it("fails soft", async () => {
    const dir = await makeTempDir("no-git");
    try {
      const stats = await collectGitStats(dir, { windowDays: 30, maxCommits: 10 });
      expect(stats.available).toBe(false);
      expect(stats.files.size).toBe(0);
    } finally {
      await removeDir(dir);
    }
  });
});
