import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AGContextOptions } from "../../src/agcontext.js";
import { silentLogger } from "../../src/core/logger.js";

export const FIXTURE_REPO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "sample-repo",
);

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `agc-${prefix}-`));
}

export async function copyFixtureRepo(): Promise<string> {
  const dir = await makeTempDir("fixture");
  await cp(FIXTURE_REPO, dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}

/** Hermetic AGContext options: no config discovery, no env keys, no git, offline embeddings. */
export function testAppOptions(dir: string): AGContextOptions {
  return {
    cwd: dir,
    configFile: false,
    logger: silentLogger,
    embeddingProvider: "local",
    git: { enabled: false },
    env: { get: () => undefined },
  };
}

/** Generates a synthetic repository with a connected import/call structure. */
export async function generateSyntheticRepo(fileCount: number): Promise<string> {
  const dir = await makeTempDir("synthetic");
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "synthetic-app",
      version: "1.0.0",
      type: "module",
      main: "src/index.ts",
    }),
    "utf8",
  );
  await mkdir(path.join(dir, "src"), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    const lines: string[] = [];
    if (i > 0) lines.push(`import { helper${i - 1} } from "./mod${i - 1}.js";`);
    const half = i >> 1;
    if (half > 0 && half !== i - 1) {
      lines.push(`import { Service${half} } from "./mod${half}.js";`);
    }
    lines.push(
      "",
      `/** Service number ${i} handling workflow step ${i}. */`,
      `export class Service${i} {`,
      `  run(input: string): string {`,
      i > 0 ? `    return helper${i - 1}(input) + "-${i}";` : `    return input + "-${i}";`,
      "  }",
      "}",
      "",
      `/** Helper transforming values for stage ${i}. */`,
      `export function helper${i}(value: string): string {`,
      half > 0 && half !== i - 1
        ? `  return new Service${half}().run(value);`
        : `  return value.toUpperCase() + "${i}";`,
      "}",
      "",
    );
    await writeFile(path.join(dir, "src", `mod${i}.ts`), lines.join("\n"), "utf8");
  }
  const barrel = Array.from(
    { length: Math.min(fileCount, 20) },
    (_, i) => `export * from "./mod${i}.js";`,
  ).join("\n");
  await writeFile(path.join(dir, "src", "index.ts"), `${barrel}\n`, "utf8");
  return dir;
}

export { silentLogger };
