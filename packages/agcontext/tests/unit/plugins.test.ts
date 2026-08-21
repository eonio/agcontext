import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/resolve.js";
import { PluginError } from "../../src/core/errors.js";
import type { Candidate } from "../../src/core/types.js";
import { PluginManager, type PluginManagerBase } from "../../src/plugins/manager.js";
import { definePlugin } from "../../src/plugins/types.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { makeTempDir, removeDir, silentLogger } from "../helpers/testkit.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => removeDir(dir)));
});

function base(root = process.cwd()): PluginManagerBase {
  return {
    config: resolveConfig({ cwd: root }),
    logger: silentLogger,
    telemetry: Telemetry.disabled(),
  };
}

describe("PluginManager", () => {
  it("collects declarative capabilities", async () => {
    const calls: string[] = [];
    const plugin = definePlugin({
      name: "declarative",
      graph: {
        analyzers: [{ name: "python", extensions: [".py"], analyze: () => undefined }],
        extend: () => {
          calls.push("extendGraph");
        },
      },
      ranking: {
        signals: [{ name: "freshness", weight: 0.2, compute: () => 0.5 }],
        weights: { lexical: 0.9 },
        rerank: (candidates: Candidate[]) => [...candidates].reverse(),
      },
      compression: {
        fileSummarizer: { summarize: (_analysis, fallback) => `${fallback}\n// annotated` },
      },
      providers: [
        {
          name: "custom-llm",
          capabilities: { generate: true, embed: false },
          generate: () => Promise.resolve({ text: "ok", model: "m" }),
          embed: () => Promise.reject(new Error("no")),
        },
      ],
      hooks: {
        afterRetrieve: () => {
          calls.push("afterRetrieve");
        },
      },
    });
    const manager = await PluginManager.load([plugin], base());
    expect(manager.names).toEqual(["declarative"]);
    expect(manager.analyzers().map((analyzer) => analyzer.name)).toEqual(["python"]);
    expect(manager.signals().map((signal) => signal.name)).toEqual(["freshness"]);
    expect(manager.weights()).toEqual({ lexical: 0.9, freshness: 0.2 });
    expect(manager.providers().map((provider) => provider.name)).toEqual(["custom-llm"]);
    expect(manager.fileSummarizers()).toHaveLength(1);

    const reranked = manager.applyReranks(
      [
        { nodeId: "a", sources: [], raw: {}, signals: {}, score: 1 },
        { nodeId: "b", sources: [], raw: {}, signals: {}, score: 0.5 },
      ],
      "query",
    );
    expect(reranked.map((candidate) => candidate.nodeId)).toEqual(["b", "a"]);

    await manager.emit("extendGraph", undefined as never);
    await manager.emit("afterRetrieve", undefined as never);
    expect(calls).toEqual(["extendGraph", "afterRetrieve"]);
  });

  it("supports imperative setup() registration", async () => {
    const plugin = definePlugin({
      name: "imperative",
      setup(context) {
        context.registerSignal({ name: "hotness", compute: () => 1 });
        context.on("beforeRetrieve", () => undefined);
        expect(context.config.graphDepth).toBeGreaterThanOrEqual(0);
        expect(context.telemetry.enabled).toBe(false);
      },
    });
    const manager = await PluginManager.load([plugin], base());
    expect(manager.signals().map((signal) => signal.name)).toEqual(["hotness"]);
    // default weight applied for signals without one
    expect(manager.weights()["hotness"]).toBe(0.05);
  });

  it("loads plugins from module specifiers (default export and factory)", async () => {
    const dir = await makeTempDir("plugins");
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "direct-plugin.mjs"),
      'export default { name: "direct", ranking: { weights: { graph: 0.7 } } };\n',
      "utf8",
    );
    await writeFile(
      path.join(dir, "factory-plugin.mjs"),
      'export default () => ({ name: "factory" });\n',
      "utf8",
    );
    const manager = await PluginManager.load(
      ["./direct-plugin.mjs", "./factory-plugin.mjs"],
      base(dir),
    );
    expect(manager.names).toEqual(["direct", "factory"]);
    expect(manager.weights()["graph"]).toBe(0.7);
  });

  it("rejects duplicate names, invalid shapes, and missing modules", async () => {
    await expect(
      PluginManager.load([{ name: "dup" }, { name: "dup" }], base()),
    ).rejects.toBeInstanceOf(PluginError);
    await expect(PluginManager.load([{ notAName: true } as never], base())).rejects.toBeInstanceOf(
      PluginError,
    );
    await expect(PluginManager.load(["./does-not-exist.mjs"], base())).rejects.toBeInstanceOf(
      PluginError,
    );
  });

  it("wraps setup and hook failures with the plugin name", async () => {
    await expect(
      PluginManager.load(
        [
          definePlugin({
            name: "exploder",
            setup() {
              throw new Error("bad setup");
            },
          }),
        ],
        base(),
      ),
    ).rejects.toThrow(/exploder.*bad setup/);

    const manager = await PluginManager.load(
      [
        definePlugin({
          name: "hook-exploder",
          hooks: {
            afterIndex: () => {
              throw new Error("hook boom");
            },
          },
        }),
      ],
      base(),
    );
    await expect(manager.emit("afterIndex", undefined as never)).rejects.toBeInstanceOf(
      PluginError,
    );
  });
});
