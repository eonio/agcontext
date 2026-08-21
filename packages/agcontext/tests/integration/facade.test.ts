import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { AmbiguousTargetError, ConfigError, NodeNotFoundError } from "../../src/core/errors.js";
import type { LLMProvider } from "../../src/providers/types.js";
import { copyFixtureRepo, removeDir, testAppOptions } from "../helpers/testkit.js";

let repo: string;
let app: AGContext;

const fakeGenerator: LLMProvider = {
  name: "fake-llm",
  capabilities: { generate: true, embed: false },
  generate: (request) =>
    Promise.resolve({
      text: `EXPLAINED: ${request.prompt.slice(0, 40)}`,
      model: "fake-1",
      usage: { inputTokens: 12, outputTokens: 8 },
    }),
  embed: () => Promise.reject(new Error("no embed")),
};

beforeAll(async () => {
  repo = await copyFixtureRepo();
  app = new AGContext({ ...testAppOptions(repo), providers: { generate: fakeGenerator } });
  await app.index();
});

afterAll(async () => {
  await removeDir(repo);
});

describe("AGContext facade behaviors", () => {
  it("resolves explain targets by id, name, and path suffix", async () => {
    const byId = await app.explain("sym:src/auth/auth-service.ts#AuthService.login");
    expect(byId.name).toBe("login");

    const bySuffix = await app.explain("auth-service.ts");
    expect(bySuffix.file).toBe("src/auth/auth-service.ts");

    // Three classes declare a constructor — ambiguous by design.
    await expect(app.explain("constructor")).rejects.toBeInstanceOf(AmbiguousTargetError);
    await expect(app.explain("DoesNotExistAnywhere")).rejects.toBeInstanceOf(NodeNotFoundError);
  });

  it("produces an AI explanation through the injected generation provider", async () => {
    const explanation = await app.explain("AuthService", { ai: true });
    expect(explanation.aiExplanation).toContain("EXPLAINED:");
  });

  it("fails clearly when AI explanation is requested without a provider", async () => {
    const bare = new AGContext(testAppOptions(repo));
    await expect(bare.explain("AuthService", { ai: true })).rejects.toBeInstanceOf(ConfigError);
  });

  it("reports doctor checks for a healthy indexed workspace", async () => {
    const checks = await app.doctor();
    const byName = new Map(checks.map((check) => [check.name, check]));
    expect(byName.get("node")?.status).toBe("pass");
    expect(byName.get("config")?.detail).toContain("defaults");
    expect(byName.get("index")?.status).toBe("pass");
    expect(byName.get("embeddings")?.detail).toContain("local");
    expect(byName.get("generate")?.status).toBe("pass");
  });

  it("warns in doctor when no generation provider exists", async () => {
    const bare = new AGContext(testAppOptions(repo));
    const checks = await bare.doctor();
    const generate = checks.find((check) => check.name === "generate");
    expect(generate?.status).toBe("warn");
  });

  it("rejects plugin registration after initialization", async () => {
    const late = new AGContext(testAppOptions(repo));
    await late.stats();
    expect(() => late.use({ name: "too-late" })).toThrow(ConfigError);
  });

  it("keeps indexing functional when the embedding provider fails", async () => {
    const failingEmbedder: LLMProvider = {
      name: "flaky",
      capabilities: { generate: false, embed: true },
      generate: () => Promise.reject(new Error("no")),
      embed: () => Promise.reject(new Error("embedding service down")),
    };
    const flakyRepo = await copyFixtureRepo();
    try {
      const flaky = new AGContext({
        ...testAppOptions(flakyRepo),
        providers: { embed: failingEmbedder },
      });
      const stats = await flaky.index();
      expect(stats.embeddedChunks).toBe(0);
      expect(stats.warnings.join(" ")).toContain("embeddings incomplete");
      // Lexical + graph retrieval still deliver.
      const result = await flaky.retrieve({ query: "authentication login" });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.diagnostics.embeddingUsed).toBe(false);
    } finally {
      await removeDir(flakyRepo);
    }
  });

  it("exposes stats before any index exists", async () => {
    const empty = await copyFixtureRepo();
    try {
      const fresh = new AGContext(testAppOptions(empty));
      const stats = await fresh.stats();
      expect(stats.indexed).toBe(false);
      expect(stats.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(stats.plugins).toEqual([]);
    } finally {
      await removeDir(empty);
    }
  });

  it("honors plugin hooks and custom signals end to end", async () => {
    const hookLog: string[] = [];
    const pluginRepo = await copyFixtureRepo();
    try {
      const withPlugin = new AGContext(testAppOptions(pluginRepo)).use({
        name: "observer",
        ranking: {
          signals: [
            {
              name: "authBoost",
              weight: 2,
              compute: (nodeId) => (nodeId.includes("auth") ? 1 : 0),
            },
          ],
        },
        hooks: {
          afterIndex: () => {
            hookLog.push("afterIndex");
          },
          beforeRetrieve: ({ options }) => {
            hookLog.push(`beforeRetrieve:${options.query}`);
          },
          afterRetrieve: (result) => {
            hookLog.push(`afterRetrieve:${result.items.length}`);
          },
          beforeContext: (pkg) => {
            pkg.recommendations.push("plugin note");
          },
        },
      });
      await withPlugin.index();
      const pkg = await withPlugin.context({ query: "login flow" });
      expect(hookLog[0]).toBe("afterIndex");
      expect(hookLog).toContain("beforeRetrieve:login flow");
      expect(pkg.recommendations).toContain("plugin note");
      const retrieval = await withPlugin.retrieve({ query: "login flow" });
      const top = retrieval.items[0];
      expect(top?.path.includes("auth")).toBe(true);
      expect(top?.signals["authBoost"]).toBe(1);
    } finally {
      await removeDir(pluginRepo);
    }
  });
});
