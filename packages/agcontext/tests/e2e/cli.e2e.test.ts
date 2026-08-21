import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFixtureRepo, removeDir } from "../helpers/testkit.js";

/**
 * True end-to-end: spawns the BUILT CLI (dist/cli/main.js) as a child
 * process, exactly as an npm consumer would run `agc`. Requires `npm run
 * build` first — the test:e2e script does that.
 */
const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
  "cli",
  "main.js",
);

let repo: string;

function agc(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args, "--cwd", repo], {
    encoding: "utf8",
    env: {
      ...process.env,
      // Hermetic: no provider keys leak into the e2e run.
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      AZURE_OPENAI_API_KEY: "",
      GOOGLE_API_KEY: "",
      OPENROUTER_API_KEY: "",
      NO_COLOR: "1",
    },
    timeout: 90_000,
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(async () => {
  expect(existsSync(CLI), `built CLI missing at ${CLI} — run npm run build`).toBe(true);
  repo = await copyFixtureRepo();
});

afterAll(async () => {
  await removeDir(repo);
});

describe("agc end-to-end (built binary)", () => {
  it("prints the version", () => {
    const { code, stdout } = agc("--version");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("indexes, searches, and assembles context", () => {
    const indexRun = agc("index", "--json", "--quiet");
    expect(indexRun.code).toBe(0);
    const stats = JSON.parse(indexRun.stdout) as { files: number };
    expect(stats.files).toBe(11);

    const search = agc("search", "authentication", "--json", "--quiet");
    expect(search.code).toBe(0);
    const result = JSON.parse(search.stdout) as { items: Array<{ path: string }> };
    expect(result.items.map((item) => item.path)).toContain("src/auth/auth-service.ts");

    const context = agc("context", "how does login work", "--format", "json", "--quiet");
    expect(context.code).toBe(0);
    const pkg = JSON.parse(context.stdout) as {
      tokens: { used: number; budget: number };
      files: unknown[];
    };
    expect(pkg.tokens.used).toBeLessThanOrEqual(pkg.tokens.budget);
    expect(pkg.files.length).toBeGreaterThan(0);
  });

  it("explains symbols and reports health", () => {
    const explain = agc("explain", "AuthService", "--json", "--quiet");
    expect(explain.code).toBe(0);
    const card = JSON.parse(explain.stdout) as { name: string };
    expect(card.name).toBe("AuthService");

    const doctor = agc("doctor", "--quiet");
    expect(doctor.code).toBe(0);
  });

  it("fails cleanly on an unindexed directory", () => {
    const result = spawnSync(
      process.execPath,
      [CLI, "search", "x", "--cwd", path.parse(repo).root + "nonexistent-agc-dir"],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status).not.toBe(0);
  });
});
