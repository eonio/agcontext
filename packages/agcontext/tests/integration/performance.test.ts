import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { generateSyntheticRepo, removeDir, testAppOptions } from "../helpers/testkit.js";

/**
 * Phase 15 target: warm retrieval under 500ms on an indexed repository.
 * The synthetic repo has ~120 files / ~1300 graph nodes; the first retrieval
 * warms the snapshot (cold load is excluded from the target by design), then
 * we assert the median of five warm runs.
 */
const FILE_COUNT = 120;

let repo: string;
let app: AGContext;

beforeAll(async () => {
  repo = await generateSyntheticRepo(FILE_COUNT);
  app = new AGContext(testAppOptions(repo));
  await app.index();
  await app.retrieve({ query: "warmup service workflow" });
}, 120_000);

afterAll(async () => {
  await removeDir(repo);
});

describe("performance", () => {
  it("indexes the synthetic repository completely", async () => {
    const stats = await app.stats();
    expect(stats.meta?.stats.files).toBe(FILE_COUNT + 1);
    expect(stats.meta?.stats.nodes).toBeGreaterThan(FILE_COUNT * 3);
  });

  it("answers warm retrievals in under 500ms (median of 5)", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await app.retrieve({ query: `workflow step ${i * 7} service helper` });
      durations.push(performance.now() - start);
      expect(result.items.length).toBeGreaterThan(0);
    }
    durations.sort((a, b) => a - b);
    const median = durations[2] as number;
    expect(median).toBeLessThan(500);
  });

  it("incremental no-op re-index is fast and correct", async () => {
    const start = performance.now();
    const stats = await app.index();
    const elapsed = performance.now() - start;
    expect(stats.incremental).toBe(true);
    expect(stats.changedFiles).toBe(0);
    // No re-parse, no re-embed: this should be well under the full index time.
    expect(elapsed).toBeLessThan(5000);
  });
});
