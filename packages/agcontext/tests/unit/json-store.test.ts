import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readJsonStore, writeJsonStore } from "../../src/cache/json-store.js";
import { Workspace } from "../../src/cache/workspace.js";
import { makeTempDir, removeDir } from "../helpers/testkit.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => removeDir(dir)));
});

describe("json-store", () => {
  it("round-trips versioned data atomically", async () => {
    const dir = await makeTempDir("store");
    tempDirs.push(dir);
    const file = path.join(dir, "nested", "data.json");
    await writeJsonStore(file, 1, { hello: "world", n: 42 });
    expect(await readJsonStore<{ hello: string; n: number }>(file, 1)).toEqual({
      hello: "world",
      n: 42,
    });
    // Overwrite works (rename over existing on Windows).
    await writeJsonStore(file, 1, { hello: "again", n: 1 });
    expect((await readJsonStore<{ hello: string }>(file, 1))?.hello).toBe("again");
  });

  it("treats version mismatches as cache misses", async () => {
    const dir = await makeTempDir("store-version");
    tempDirs.push(dir);
    const file = path.join(dir, "data.json");
    await writeJsonStore(file, 1, { x: 1 });
    expect(await readJsonStore(file, 2)).toBeUndefined();
  });

  it("treats corrupt or missing files as cache misses", async () => {
    const dir = await makeTempDir("store-corrupt");
    tempDirs.push(dir);
    const file = path.join(dir, "data.json");
    expect(await readJsonStore(file, 1)).toBeUndefined();
    await writeFile(file, "{not json", "utf8");
    expect(await readJsonStore(file, 1)).toBeUndefined();
  });

  it("serializes with an envelope containing the schema version", async () => {
    const dir = await makeTempDir("store-envelope");
    tempDirs.push(dir);
    const file = path.join(dir, "data.json");
    await writeJsonStore(file, 7, [1, 2, 3]);
    const raw = JSON.parse(await readFile(file, "utf8")) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(7);
  });
});

describe("Workspace", () => {
  it("exposes the cache layout and sizes", async () => {
    const dir = await makeTempDir("workspace");
    tempDirs.push(dir);
    const workspace = new Workspace(dir, path.join(dir, ".agcontext"));
    await workspace.ensure();
    await writeJsonStore(workspace.metaFile, 1, { ok: true });
    await writeJsonStore(workspace.graphFile, 1, { nodes: [], edges: [] });
    const sizes = await workspace.sizes();
    expect(sizes["index-meta.json"]).toBeGreaterThan(0);
    expect(sizes["graph.json"]).toBeGreaterThan(0);
    expect(sizes["embeddings.json"]).toBeUndefined();
    expect(workspace.telemetryFile).toContain("telemetry");
  });
});
