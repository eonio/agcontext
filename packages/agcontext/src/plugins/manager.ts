import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedConfig } from "../config/resolve.js";
import { PluginError } from "../core/errors.js";
import type { Logger } from "../core/interfaces.js";
import type { Candidate, PluginLike } from "../core/types.js";
import type { SourceAnalyzer } from "../indexing/analyzer.js";
import type { LLMProvider } from "../providers/types.js";
import type { Telemetry } from "../telemetry/telemetry.js";
import type {
  AGContextPlugin,
  FileSummarizer,
  PluginContext,
  PluginHooks,
  SignalProvider,
} from "./types.js";

export interface PluginManagerBase {
  config: ResolvedConfig;
  logger: Logger;
  telemetry: Telemetry;
}

type HookBuckets = { [K in keyof PluginHooks]: Array<PluginHooks[K]> };

/**
 * Loads plugins (objects or module specifiers), collects their declarative
 * capabilities, runs their `setup()` with registration APIs, and dispatches
 * lifecycle hooks. Every plugin failure is wrapped in a {@link PluginError}
 * naming the offending plugin.
 */
export class PluginManager {
  private readonly loaded: AGContextPlugin[] = [];
  private readonly analyzerList: SourceAnalyzer[] = [];
  private readonly signalList: SignalProvider[] = [];
  private readonly summarizerList: FileSummarizer[] = [];
  private readonly providerList: LLMProvider[] = [];
  private readonly rerankList: Array<{
    plugin: string;
    fn: (candidates: Candidate[], query: string) => Candidate[];
  }> = [];
  private weightOverrides: Record<string, number> = {};
  private readonly hookBuckets: HookBuckets = {
    afterIndex: [],
    extendGraph: [],
    beforeRetrieve: [],
    afterRetrieve: [],
    beforeContext: [],
  };

  static async load(
    entries: ReadonlyArray<string | PluginLike>,
    base: PluginManagerBase,
  ): Promise<PluginManager> {
    const manager = new PluginManager();
    for (const entry of entries) {
      const plugin =
        typeof entry === "string"
          ? await importPlugin(entry, base.config.root)
          : validatePlugin(entry, "(inline)");
      await manager.register(plugin, base);
    }
    return manager;
  }

  get names(): string[] {
    return this.loaded.map((plugin) => plugin.name);
  }

  async register(plugin: AGContextPlugin, base: PluginManagerBase): Promise<void> {
    if (this.loaded.some((existing) => existing.name === plugin.name)) {
      throw new PluginError(plugin.name, "A plugin with this name is already registered.");
    }
    this.loaded.push(plugin);

    /* Declarative capabilities. */
    if (plugin.graph?.analyzers) this.analyzerList.push(...plugin.graph.analyzers);
    if (plugin.graph?.extend) {
      this.hookBuckets.extendGraph.push(plugin.graph.extend.bind(plugin.graph));
    }
    if (plugin.ranking?.signals) this.signalList.push(...plugin.ranking.signals);
    if (plugin.ranking?.weights) {
      this.weightOverrides = { ...this.weightOverrides, ...plugin.ranking.weights };
    }
    if (plugin.ranking?.rerank) {
      this.rerankList.push({ plugin: plugin.name, fn: plugin.ranking.rerank });
    }
    if (plugin.compression?.fileSummarizer) {
      this.summarizerList.push(plugin.compression.fileSummarizer);
    }
    if (plugin.providers) this.providerList.push(...plugin.providers);
    if (plugin.hooks) {
      for (const [hook, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          (this.hookBuckets[hook as keyof PluginHooks] as Array<unknown>).push(handler);
        }
      }
    }

    /* Imperative setup. */
    if (plugin.setup) {
      const context: PluginContext = {
        config: base.config,
        logger: base.logger,
        telemetry: base.telemetry,
        registerAnalyzer: (analyzer) => this.analyzerList.push(analyzer),
        registerSignal: (signal) => this.signalList.push(signal),
        registerProvider: (provider) => this.providerList.push(provider),
        registerFileSummarizer: (summarizer) => this.summarizerList.push(summarizer),
        on: (hook, handler) => {
          (this.hookBuckets[hook] as Array<unknown>).push(handler);
        },
      };
      try {
        await plugin.setup(context);
      } catch (error) {
        throw new PluginError(
          plugin.name,
          `setup() failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
    }
  }

  analyzers(): readonly SourceAnalyzer[] {
    return this.analyzerList;
  }

  signals(): readonly SignalProvider[] {
    return this.signalList;
  }

  fileSummarizers(): readonly FileSummarizer[] {
    return this.summarizerList;
  }

  providers(): readonly LLMProvider[] {
    return this.providerList;
  }

  /** Signal weight overrides plus defaults for plugin signals lacking one. */
  weights(): Record<string, number> {
    const weights = { ...this.weightOverrides };
    for (const signal of this.signalList) {
      weights[signal.name] ??= signal.weight ?? 0.05;
    }
    return weights;
  }

  applyReranks(candidates: Candidate[], query: string): Candidate[] {
    let current = candidates;
    for (const { plugin, fn } of this.rerankList) {
      try {
        current = fn(current, query);
      } catch (error) {
        throw new PluginError(
          plugin,
          `rerank() failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }
    }
    return current;
  }

  async emit<K extends keyof PluginHooks>(
    hook: K,
    payload: Parameters<PluginHooks[K]>[0],
  ): Promise<void> {
    for (const handler of this.hookBuckets[hook]) {
      try {
        await (handler as (arg: typeof payload) => void | Promise<void>)(payload);
      } catch (error) {
        throw new PluginError(
          `hook:${hook}`,
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
    }
  }
}

async function importPlugin(specifier: string, root: string): Promise<AGContextPlugin> {
  let resolved = specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier)) {
    resolved = pathToFileURL(path.resolve(root, specifier)).href;
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(resolved)) as Record<string, unknown>;
  } catch (error) {
    throw new PluginError(
      specifier,
      `Could not import plugin module: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  let candidate: unknown = mod["default"] ?? mod;
  if (typeof candidate === "function") {
    candidate = await (candidate as () => unknown | Promise<unknown>)();
  }
  return validatePlugin(candidate, specifier);
}

function validatePlugin(candidate: unknown, source: string): AGContextPlugin {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as { name?: unknown }).name !== "string" ||
    (candidate as { name: string }).name.length === 0
  ) {
    throw new PluginError(
      source,
      "Not a valid AGContext plugin: expected an object (or factory returning one) with a string `name`.",
    );
  }
  return candidate as AGContextPlugin;
}
