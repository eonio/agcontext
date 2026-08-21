import path from "node:path";
import { ConfigError } from "../core/errors.js";
import {
  EdgeKind,
  type PluginLike,
  type RetrievalStrategy,
  type SignalWeights,
} from "../core/types.js";
import {
  DEFAULT_CACHE_DIRNAME,
  DEFAULT_EDGE_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_WEIGHTS,
} from "./defaults.js";
import {
  userConfigSchema,
  type AGContextUserConfig,
  type ContextFormat,
  type ProviderName,
} from "./schema.js";

/** Fully-populated configuration used internally. Every field has a value. */
export interface ResolvedConfig {
  /** Absolute repository root. */
  root: string;
  extensions: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  graphDepth: number;
  maxNodes: number;
  strategy: RetrievalStrategy;
  rankingMode: "weighted" | "rrf";
  provider: ProviderName;
  embeddingProvider: ProviderName;
  models: { generate?: string; embed?: string };
  weights: SignalWeights;
  expansion: {
    traversalBudget: number;
    minScore: number;
    decay: number;
    hubDegreeLimit: number;
    edgeWeights: Record<EdgeKind, number>;
  };
  retrieval: { limit: number; candidateLimit: number; snippetLength: number };
  context: {
    maxTokens: number;
    format: ContextFormat;
    maxFileTokens: number;
    maxSymbolTokens: number;
    includeArchitecture: boolean;
    includeRecommendations: boolean;
  };
  /** Absolute cache directory. */
  cacheDir: string;
  telemetry: { enabled: boolean; file: boolean };
  git: { enabled: boolean; windowDays: number; maxCommits: number };
  plugins: Array<string | PluginLike>;
  /** Absolute path of the config file this was resolved from, if any. */
  configFile?: string;
}

/** Validates unknown input against the user-config schema with readable errors. */
export function validateUserConfig(value: unknown, source: string): AGContextUserConfig {
  const parsed = userConfigSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration (${source}):\n${details}`);
  }
  return parsed.data as AGContextUserConfig;
}

function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as Partial<T>;
}

/** Merges two user configs; `override` wins field-by-field, plugins concatenate. */
export function mergeUserConfigs(
  base: AGContextUserConfig,
  override: AGContextUserConfig,
): AGContextUserConfig {
  return {
    ...defined(base),
    ...defined(override),
    models: { ...defined(base.models), ...defined(override.models) },
    weights: { ...defined(base.weights), ...defined(override.weights) },
    expansion: {
      ...defined(base.expansion),
      ...defined(override.expansion),
      edgeWeights: {
        ...defined(base.expansion?.edgeWeights),
        ...defined(override.expansion?.edgeWeights),
      },
    },
    retrieval: { ...defined(base.retrieval), ...defined(override.retrieval) },
    context: { ...defined(base.context), ...defined(override.context) },
    cache: { ...defined(base.cache), ...defined(override.cache) },
    telemetry: { ...defined(base.telemetry), ...defined(override.telemetry) },
    git: { ...defined(base.git), ...defined(override.git) },
    exclude: [...new Set([...(base.exclude ?? []), ...(override.exclude ?? [])])],
    plugins: [...(base.plugins ?? []), ...(override.plugins ?? [])],
  };
}

const VALID_EDGE_KINDS = new Set<string>(Object.values(EdgeKind));

function resolveEdgeWeights(
  overrides: Partial<Record<string, number>> | undefined,
): Record<EdgeKind, number> {
  const result: Record<EdgeKind, number> = { ...DEFAULT_EDGE_WEIGHTS };
  if (!overrides) return result;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (!VALID_EDGE_KINDS.has(key)) {
      throw new ConfigError(
        `Unknown edge kind "${key}" in expansion.edgeWeights. Valid kinds: ${[...VALID_EDGE_KINDS].join(", ")}`,
      );
    }
    result[key as EdgeKind] = value;
  }
  return result;
}

export interface ResolveConfigInput {
  /** Directory the process is anchored at. */
  cwd: string;
  /** Config loaded from a file, already validated. */
  fileConfig?: AGContextUserConfig;
  /** Directory containing the config file (base for relative `root`). */
  fileDir?: string;
  /** Programmatic overrides (constructor options / CLI flags), already validated. */
  overrides?: AGContextUserConfig;
  configFile?: string;
}

/** Layers defaults ← config file ← programmatic overrides into a {@link ResolvedConfig}. */
export function resolveConfig(input: ResolveConfigInput): ResolvedConfig {
  const merged = mergeUserConfigs(input.fileConfig ?? {}, input.overrides ?? {});
  const baseDir = input.fileDir ?? input.cwd;
  const root = path.resolve(baseDir, merged.root ?? ".");
  const cacheDir = merged.cache?.dir
    ? path.resolve(root, merged.cache.dir)
    : path.join(root, DEFAULT_CACHE_DIRNAME);

  const resolved: ResolvedConfig = {
    root,
    extensions: (merged.extensions ?? [...DEFAULT_EXTENSIONS]).map((e) => e.toLowerCase()),
    exclude: merged.exclude ?? [],
    maxFileSizeBytes: merged.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    graphDepth: merged.graphDepth ?? 2,
    maxNodes: merged.maxNodes ?? 50,
    strategy: merged.strategy ?? "hybrid",
    rankingMode: merged.ranking === "rrf" ? "rrf" : "weighted",
    provider: merged.provider ?? "auto",
    embeddingProvider: merged.embeddingProvider ?? "auto",
    models: { ...merged.models },
    weights: { ...DEFAULT_WEIGHTS, ...defined(merged.weights) },
    expansion: {
      traversalBudget: merged.expansion?.traversalBudget ?? 300,
      minScore: merged.expansion?.minScore ?? 0.05,
      decay: merged.expansion?.decay ?? 0.6,
      hubDegreeLimit: merged.expansion?.hubDegreeLimit ?? 64,
      edgeWeights: resolveEdgeWeights(merged.expansion?.edgeWeights),
    },
    retrieval: {
      limit: merged.retrieval?.limit ?? 20,
      candidateLimit: merged.retrieval?.candidateLimit ?? 100,
      snippetLength: merged.retrieval?.snippetLength ?? 240,
    },
    context: {
      maxTokens: merged.context?.maxTokens ?? 12_000,
      format: merged.context?.format ?? "markdown",
      maxFileTokens: merged.context?.maxFileTokens ?? 2000,
      maxSymbolTokens: merged.context?.maxSymbolTokens ?? 800,
      includeArchitecture: merged.context?.includeArchitecture ?? true,
      includeRecommendations: merged.context?.includeRecommendations ?? true,
    },
    cacheDir,
    telemetry: {
      enabled: merged.telemetry?.enabled ?? false,
      file: merged.telemetry?.file ?? false,
    },
    git: {
      enabled: merged.git?.enabled ?? true,
      windowDays: merged.git?.windowDays ?? 180,
      maxCommits: merged.git?.maxCommits ?? 2000,
    },
    plugins: merged.plugins ?? [],
  };
  if (input.configFile !== undefined) resolved.configFile = input.configFile;
  return resolved;
}
