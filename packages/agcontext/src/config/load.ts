import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { ConfigError } from "../core/errors.js";
import type { AGContextUserConfig } from "./schema.js";
import { validateUserConfig } from "./resolve.js";

export const CONFIG_FILENAMES = [
  "agcontext.config.ts",
  "agcontext.config.mts",
  "agcontext.config.js",
  "agcontext.config.mjs",
  "agcontext.config.json",
] as const;

export interface LoadedConfig {
  config: AGContextUserConfig;
  filePath: string;
}

/** Walks upward from `startDir` looking for the nearest config file. */
export function findConfigFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads and validates a config file. TypeScript and JavaScript configs are
 * evaluated with jiti (no build step needed); JSON is parsed directly. A
 * default export that is a function is invoked (async factories supported).
 */
export async function loadConfigFile(filePath: string): Promise<AGContextUserConfig> {
  const abs = path.resolve(filePath);
  if (!existsSync(abs)) {
    throw new ConfigError(`Config file not found: ${abs}`);
  }
  let raw: unknown;
  if (abs.endsWith(".json")) {
    try {
      raw = JSON.parse(await readFile(abs, "utf8"));
    } catch (error) {
      throw new ConfigError(`Failed to parse ${abs} as JSON`, error);
    }
  } else {
    try {
      const jiti = createJiti(import.meta.url);
      const mod = (await jiti.import(abs)) as Record<string, unknown>;
      raw = mod["default"] ?? mod;
    } catch (error) {
      throw new ConfigError(
        `Failed to load config file ${abs}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
  if (typeof raw === "function") {
    raw = await (raw as () => unknown | Promise<unknown>)();
  }
  return validateUserConfig(raw, abs);
}

/**
 * Discovers and loads configuration for `cwd`.
 * - `explicit` path: load exactly that file (error if missing).
 * - `false`: skip discovery entirely (pure-defaults / programmatic mode).
 * - otherwise: nearest `agcontext.config.*` walking up from `cwd`.
 */
export async function discoverConfig(
  cwd: string,
  explicit?: string | false,
): Promise<LoadedConfig | undefined> {
  if (explicit === false) return undefined;
  const filePath = explicit ? path.resolve(cwd, explicit) : findConfigFile(cwd);
  if (!filePath) return undefined;
  const config = await loadConfigFile(filePath);
  return { config, filePath };
}
