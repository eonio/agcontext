# Performance Engineering

**Target: warm retrieval in under 500 ms** on an indexed repository. The
design principle behind every decision here: query time touches only
in-memory structures; anything expensive happens at index time and persists.

## Where the time goes

| Stage            | Typical cost (5k-file repo)                 | Notes                                                     |
| ---------------- | ------------------------------------------- | --------------------------------------------------------- |
| BM25 search      | ~1-5 ms                                     | posting-list walk over unique query terms                 |
| Semantic search  | ~5-15 ms local; + one API round-trip remote | brute-force dot products over a contiguous Float32 matrix |
| Graph expansion  | ~1-10 ms                                    | best-first, hard-capped at `traversalBudget` visits       |
| Merge + ranking  | ~1-5 ms                                     | pure arithmetic; corpus signals precomputed               |
| Context assembly | ~5-30 ms                                    | file reads for full-content inclusions                    |

The verified numbers: the integration suite asserts a **median warm
retrieval < 500 ms** on a 121-file synthetic repository, and
`tests/benchmarks/retrieval.bench.ts` reports bm25 / full-retrieve /
context-assembly throughput (`npm run bench`).

## The mechanisms

**Local cache (`.agcontext/`).** Versioned, atomically-written JSON stores
(write-temp-then-rename, with a Windows-safe retry). Corruption or version
mismatch reads as a cold cache — self-healing, never crashing.

**Graph persistence.** The graph serializes deterministically and reloads in
one pass; adjacency and the name index rebuild in memory on load.

**Embedding persistence.** Vectors live in base64-encoded Float32 blocks
keyed by chunk content hash. Re-indexing re-embeds only changed chunks;
pruning compacts removed ones. Query-time search runs over one contiguous
`Float32Array` — cache-friendly, allocation-free per row.

**Incremental updates** (three layers, cheapest first):

1. `(size, mtime)` match → skip even hashing the file.
2. Content-hash match → reuse cached AST analysis and chunks (parsing is
   the expensive step).
3. Only changed files re-parse; the graph relinks from cached analyses
   (linking is milliseconds; correctness demands it since cross-file edges
   can change when any file changes).

A no-op re-index of an unchanged repository is asserted at < 5 s in tests;
in practice it is dominated by the scan and one metadata pass.

**Memory discipline.**

- One `Float32Array` matrix for embeddings (no per-vector objects).
- BM25 postings as `Map<term, [docIndex, tf][]>` with typed-array doc
  lengths.
- Signature/doc/chunk caps bound worst-case strings on generated files.
- Candidate sets capped by `retrieval.candidateLimit`; expansion capped by
  budget and `maxNodes`.

**Warm process reuse.** The `AGContext` instance memoizes its snapshot;
long-lived embedders (editor integrations, MCP server) pay the load cost
once. Cold CLI starts add JSON-parse time for the stores — measured in the
hundreds of milliseconds on large repos, and excluded from the 500 ms warm
target by definition (documented honestly rather than hidden).

**Concurrency.** File IO and analysis fan out with a bounded pool (16);
embedding batches (64 texts) run 4-wide after the first batch fixes the
index dimension.

## Latency diagnostics

Every retrieval returns stage timings:

```bash
agc retrieve "auth" --json | jq '.diagnostics'
```

and telemetry (opt-in) aggregates them across runs for `agc stats`.
