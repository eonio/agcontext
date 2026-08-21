import { readFileSync } from "node:fs";

let cached: { name: string; version: string } | undefined;

/**
 * Package identity, read from package.json relative to the built module
 * (dist/version.js and src/version.ts sit one level below the package root).
 */
export function packageInfo(): { name: string; version: string } {
  if (cached) return cached;
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    cached = { name: pkg.name ?? "@eonio/agcontext", version: pkg.version ?? "0.0.0" };
  } catch {
    cached = { name: "@eonio/agcontext", version: "0.0.0" };
  }
  return cached;
}
