import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { discoverConfig, loadConfigFile } from "../../src/config/load.js";
import { mergeUserConfigs, resolveConfig, validateUserConfig } from "../../src/config/resolve.js";
import { ConfigError } from "../../src/core/errors.js";
import { EdgeKind } from "../../src/core/types.js";
import { makeTempDir, removeDir } from "../helpers/testkit.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => removeDir(dir)));
});

describe("resolveConfig", () => {
  it("produces production defaults", () => {
    const config = resolveConfig({ cwd: process.cwd() });
    expect(config.graphDepth).toBe(2);
    expect(config.maxNodes).toBe(50);
    expect(config.strategy).toBe("hybrid");
    expect(config.rankingMode).toBe("weighted");
    expect(config.provider).toBe("auto");
    expect(config.context.maxTokens).toBe(12_000);
    expect(config.telemetry.enabled).toBe(false);
    expect(config.cacheDir).toBe(path.join(config.root, ".agcontext"));
    const weightSum = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
    expect(weightSum).toBeCloseTo(1, 5);
  });

  it("applies flat ergonomic overrides", () => {
    const config = resolveConfig({
      cwd: process.cwd(),
      overrides: { graphDepth: 3, maxNodes: 80, strategy: "graph", ranking: "rrf" },
    });
    expect(config.graphDepth).toBe(3);
    expect(config.maxNodes).toBe(80);
    expect(config.strategy).toBe("graph");
    expect(config.rankingMode).toBe("rrf");
  });

  it('maps ranking "hybrid" to the weighted engine', () => {
    expect(resolveConfig({ cwd: ".", overrides: { ranking: "hybrid" } }).rankingMode).toBe(
      "weighted",
    );
  });

  it("merges weights and edge weights over defaults", () => {
    const config = resolveConfig({
      cwd: ".",
      overrides: {
        weights: { semantic: 0.5 },
        expansion: { edgeWeights: { calls: 0.4 } },
      },
    });
    expect(config.weights.semantic).toBe(0.5);
    expect(config.weights.lexical).toBeGreaterThan(0);
    expect(config.expansion.edgeWeights[EdgeKind.Calls]).toBe(0.4);
    expect(config.expansion.edgeWeights[EdgeKind.Imports]).toBe(0.7);
  });

  it("rejects unknown edge kinds", () => {
    expect(() =>
      resolveConfig({ cwd: ".", overrides: { expansion: { edgeWeights: { telepathy: 1 } } } }),
    ).toThrow(ConfigError);
  });

  it("file config loses to programmatic overrides", () => {
    const config = resolveConfig({
      cwd: ".",
      fileConfig: { graphDepth: 4, maxNodes: 10 },
      overrides: { graphDepth: 1 },
    });
    expect(config.graphDepth).toBe(1);
    expect(config.maxNodes).toBe(10);
  });
});

describe("validateUserConfig", () => {
  it("reports the failing path", () => {
    expect(() => validateUserConfig({ graphDepth: "three" }, "test")).toThrow(/graphDepth/);
    expect(() => validateUserConfig({ retrieval: { limit: 0 } }, "test")).toThrow(
      /retrieval.limit/,
    );
  });

  it("accepts a valid config", () => {
    expect(
      validateUserConfig({ strategy: "hybrid", plugins: [{ name: "p" }] }, "test"),
    ).toBeTruthy();
  });
});

describe("mergeUserConfigs", () => {
  it("unions excludes and concatenates plugins", () => {
    const merged = mergeUserConfigs(
      { exclude: ["a/"], plugins: ["one"], graphDepth: 2 },
      { exclude: ["b/"], plugins: [{ name: "two" }], graphDepth: 5 },
    );
    expect(merged.exclude).toEqual(["a/", "b/"]);
    expect(merged.plugins).toHaveLength(2);
    expect(merged.graphDepth).toBe(5);
  });
});

describe("config file loading", () => {
  it("loads a TypeScript config via jiti", async () => {
    const dir = await makeTempDir("config-ts");
    tempDirs.push(dir);
    const file = path.join(dir, "agcontext.config.ts");
    await writeFile(
      file,
      'const config = { graphDepth: 3, strategy: "hybrid" as const };\nexport default config;\n',
      "utf8",
    );
    const loaded = await loadConfigFile(file);
    expect(loaded.graphDepth).toBe(3);
  });

  it("loads JSON configs and validates them", async () => {
    const dir = await makeTempDir("config-json");
    tempDirs.push(dir);
    const file = path.join(dir, "agcontext.config.json");
    await writeFile(file, JSON.stringify({ maxNodes: 12 }), "utf8");
    expect((await loadConfigFile(file)).maxNodes).toBe(12);

    await writeFile(file, JSON.stringify({ maxNodes: "many" }), "utf8");
    await expect(loadConfigFile(file)).rejects.toThrow(ConfigError);
  });

  it("discovers configs walking up from nested directories", async () => {
    const dir = await makeTempDir("config-walk");
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "agcontext.config.json"),
      JSON.stringify({ graphDepth: 4 }),
      "utf8",
    );
    const nested = path.join(dir, "src", "deep");
    await mkdir(nested, { recursive: true });
    const discovered = await discoverConfig(nested);
    expect(discovered?.config.graphDepth).toBe(4);
    expect(discovered?.filePath).toBe(path.join(dir, "agcontext.config.json"));
  });

  it("skips discovery when explicitly disabled", async () => {
    expect(await discoverConfig(process.cwd(), false)).toBeUndefined();
  });

  it("errors on missing explicit config files", async () => {
    await expect(loadConfigFile(path.join("does", "not", "exist.ts"))).rejects.toThrow(ConfigError);
  });
});
