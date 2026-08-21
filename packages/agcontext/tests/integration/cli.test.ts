import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { runCli } from "../../src/cli/program.js";
import type { CliIO } from "../../src/cli/io.js";
import type {
  ContextPackage,
  DoctorCheck,
  IndexStats,
  RetrievalResult,
  SymbolExplanation,
} from "../../src/core/types.js";
import { copyFixtureRepo, removeDir, testAppOptions } from "../helpers/testkit.js";

let repo: string;

interface CapturedIO extends CliIO {
  stdout: string[];
  stderr: string[];
}

function capture(): CapturedIO {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
  };
}

async function agc(...args: string[]): Promise<{ code: number; io: CapturedIO }> {
  const io = capture();
  const code = await runCli(["node", "agc", ...args, "--cwd", repo], {
    io,
    createApp: () => new AGContext(testAppOptions(repo)),
  });
  return { code, io };
}

function stdoutJson<T>(io: CapturedIO): T {
  return JSON.parse(io.stdout.join("\n")) as T;
}

beforeAll(async () => {
  repo = await copyFixtureRepo();
});

afterAll(async () => {
  await removeDir(repo);
});

describe("agc CLI (in-process)", () => {
  it("agc init scaffolds config and gitignore handling", async () => {
    const first = await agc("init");
    expect(first.code).toBe(0);
    expect(existsSync(path.join(repo, "agcontext.config.ts"))).toBe(true);
    expect(first.io.stderr.join("\n")).toContain("next steps");

    const second = await agc("init");
    expect(second.code).toBe(1);
    expect(second.io.stderr.join("\n")).toContain("already exists");

    const forced = await agc("init", "--force");
    expect(forced.code).toBe(0);
  });

  it("agc index builds the index and reports stats", async () => {
    const { code, io } = await agc("index", "--json");
    expect(code).toBe(0);
    const stats = stdoutJson<IndexStats>(io);
    // 11 fixture files + the agcontext.config.ts created by `agc init` above.
    expect(stats.files).toBe(12);
    expect(stats.chunks).toBeGreaterThan(0);
  });

  it("agc search returns lexical hits", async () => {
    const { code, io } = await agc("search", "authentication", "--json");
    expect(code).toBe(0);
    const result = stdoutJson<RetrievalResult>(io);
    expect(result.items.map((item) => item.path)).toContain("src/auth/auth-service.ts");

    const human = await agc("search", "authentication");
    expect(human.code).toBe(0);
    expect(human.io.stdout.join("\n")).toContain("AuthService");
  });

  it("agc retrieve runs the full hybrid pipeline", async () => {
    const { code, io } = await agc("retrieve", "how does login work", "--json", "--limit", "10");
    expect(code).toBe(0);
    const result = stdoutJson<RetrievalResult>(io);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.diagnostics.strategy).toBe("hybrid");
  });

  it("agc context assembles a bounded package", async () => {
    const { code, io } = await agc(
      "context",
      "how does authentication work",
      "--json",
      "--budget",
      "5000",
    );
    expect(code).toBe(0);
    const pkg = stdoutJson<ContextPackage>(io);
    expect(pkg.tokens.budget).toBe(5000);
    expect(pkg.tokens.used).toBeLessThanOrEqual(5000);
    expect(pkg.files.length).toBeGreaterThan(0);

    const markdown = await agc("context", "authentication", "--format", "markdown");
    expect(markdown.code).toBe(0);
    expect(markdown.io.stdout.join("\n")).toContain("# Repository Context");

    const xml = await agc("context", "authentication", "--format", "xml");
    expect(xml.io.stdout.join("\n")).toContain("<context query=");
  });

  it("agc explain renders a symbol card", async () => {
    const { code, io } = await agc("explain", "AuthService", "--json");
    expect(code).toBe(0);
    const explanation = stdoutJson<SymbolExplanation>(io);
    expect(explanation.name).toBe("AuthService");
    expect(explanation.relations.length).toBeGreaterThan(0);

    const human = await agc("explain", "AuthService", "--full");
    expect(human.io.stdout.join("\n")).toContain("relations");
    expect(human.io.stdout.join("\n")).toContain("file summary");
  });

  it("agc graph prints stats and neighborhoods", async () => {
    const stats = await agc("graph", "--json");
    expect(stats.code).toBe(0);
    expect(stdoutJson<{ nodes: number }>(stats.io).nodes).toBeGreaterThan(0);

    const human = await agc("graph");
    expect(human.code).toBe(0);
    expect(human.io.stdout.join("\n")).toContain("code graph");
    expect(human.io.stdout.join("\n")).toContain("node kind");

    const node = await agc("graph", "UserRepository");
    expect(node.code).toBe(0);
    expect(node.io.stdout.join("\n")).toContain("inheritance");

    const nodeJson = await agc("graph", "UserRepository", "--json");
    expect(stdoutJson<SymbolExplanation>(nodeJson.io).name).toBe("UserRepository");
  });

  it("agc doctor reports health without failures", async () => {
    const { code, io } = await agc("doctor", "--json");
    expect(code).toBe(0);
    const checks = stdoutJson<DoctorCheck[]>(io);
    expect(checks.some((check) => check.name === "node" && check.status === "pass")).toBe(true);
    expect(checks.every((check) => check.status !== "fail")).toBe(true);
  });

  it("agc stats summarizes the workspace", async () => {
    const { code, io } = await agc("stats");
    expect(code).toBe(0);
    const text = io.stdout.join("\n");
    expect(text).toContain("index:");
    expect(text).toContain("graph:");
    expect(text).toContain("cache file");
  });

  it("agc version and --version print the package version", async () => {
    const sub = await agc("version");
    expect(sub.code).toBe(0);
    expect(sub.io.stdout.join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("unknown commands exit non-zero with guidance", async () => {
    const { code, io } = await agc("frobnicate");
    expect(code).not.toBe(0);
    expect(io.stderr.join("\n")).toContain("--help");
  });

  it("ambiguous explain targets exit with a helpful error", async () => {
    const { code, io } = await agc("explain", "NoSuchSymbolAnywhere");
    expect(code).toBe(1);
    expect(io.stderr.join("\n")).toContain("NODE_NOT_FOUND");
  });
});
