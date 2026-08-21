import type { AGContextUserConfig } from "./schema.js";

/**
 * Identity helper providing type-checking and editor completion inside
 * `agcontext.config.ts`:
 *
 * ```ts
 * import { defineConfig } from "@eonio/agcontext";
 *
 * export default defineConfig({
 *   graphDepth: 3,
 *   maxNodes: 50,
 *   ranking: "hybrid",
 * });
 * ```
 */
export function defineConfig<T extends AGContextUserConfig>(config: T): T {
  return config;
}
