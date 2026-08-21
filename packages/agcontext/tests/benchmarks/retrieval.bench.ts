import { bench, describe } from "vitest";
import { AGContext } from "../../src/agcontext.js";
import { tokenize } from "../../src/core/text.js";
import { BM25Index } from "../../src/retrieval/bm25.js";
import { loadIndexSnapshot } from "../../src/indexing/indexer.js";
import { Workspace } from "../../src/cache/workspace.js";
import path from "node:path";
import { generateSyntheticRepo, testAppOptions } from "../helpers/testkit.js";

const repo = await generateSyntheticRepo(150);
const app = new AGContext(testAppOptions(repo));
await app.index();
await app.retrieve("warmup");

const snapshot = await loadIndexSnapshot(new Workspace(repo, path.join(repo, ".agcontext")));
const bm25 = snapshot ? snapshot.bm25 : BM25Index.fromChunks([]);
const queryTokens = tokenize("service workflow helper transform");

describe("retrieval benchmarks (150-file synthetic repo)", () => {
  bench("bm25 search", () => {
    bm25.search(queryTokens, 100);
  });

  bench("full hybrid retrieve (warm)", async () => {
    await app.retrieve({ query: "service workflow helper transform" });
  });

  bench("context assembly", async () => {
    await app.context({ query: "service workflow helper transform", maxTokens: 8000 });
  });
});
