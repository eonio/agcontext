# Hybrid Retrieval, Graph Expansion, and Ranking

This document covers the query-time pipeline: phases 7 (hybrid retrieval),
8 (graph expansion strategy), and 10 (ranking engine).

## Pipeline shape

```text
Candidate Generation  →  Candidate Expansion  →  Deduplication  →  Ranking
(lexical + semantic       (best-first graph        (one candidate     (normalize +
 + name seeding)           traversal)               per graph node)    fuse 9 signals)
```

## 1. Candidate generation

**Query processing** tokenizes the question with the same code-aware
tokenizer used at index time (identifier splitting: `AuthTokenService` →
`auth`, `token`, `service` + the compound), filters stopwords, and extracts
identifier-looking words for exact-name lookup.

**Lexical (BM25).** Okapi BM25 (`k1 = 1.2`, `b = 0.75`) over chunks, where a
chunk's terms include its text, file path, and symbol name — so
`"auth service"` matches `src/auth/auth-service.ts` even when the body never
spells it out. Zero-cost, exact, the precision anchor.

**Semantic (embeddings).** Cosine similarity over L2-normalized vectors in a
contiguous Float32 matrix (brute-force scan — exact and comfortably inside
the latency budget at repository scale). The query is embedded by the same
provider/model that built the index; any mismatch (provider changed since
indexing, dimension drift) skips the stage with a warning instead of
returning garbage.

**Name seeding.** Query identifiers hit the graph's case-insensitive name
index directly. An exact symbol/file-name match is treated as a top-strength
lexical hit — when the user says `AuthService`, that is the answer's anchor.

## 2. Candidate expansion (phase 8 — preventing graph explosion)

The strongest seeds (top lexical + semantic hits + name matches, capped at 12) feed a **best-first traversal** with a max-heap keyed on propagated
relevance:

```text
score(neighbor) = score(node) × decay × edgeWeight(kind)
```

Default edge weights encode how much behavioral relevance each relationship
carries: Calls 1.0 · Inheritance 0.9 · Composition 0.8 · Imports 0.7 ·
References 0.6 · Exports 0.5 · Contains 0.4.

Four independent guards keep the frontier from exploding:

| Guard            | Config                      | Default | Effect                                                                                                                                                        |
| ---------------- | --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depth limit      | `graphDepth`                | 2       | No node further than N hops from a seed (`Depth 0 → 1 → 2 → STOP`).                                                                                           |
| Traversal budget | `expansion.traversalBudget` | 300     | Hard cap on node visits; the heap spends it best-first, so strong seeds naturally claim more budget than weak ones — this is what makes expansion _adaptive_. |
| Score threshold  | `expansion.minScore`        | 0.05    | Frontiers below the threshold are recorded but never expanded further.                                                                                        |
| Hub damping      | `expansion.hubDegreeLimit`  | 64      | Nodes with degree above the limit (barrel `index.ts`, god utils) are included but never expanded through — one hub cannot pull in the repository.             |

All knobs live under `expansion` in the config, per-edge-kind weights
included:

```ts
export default defineConfig({
  graphDepth: 3,
  expansion: {
    traversalBudget: 500,
    minScore: 0.03,
    decay: 0.65,
    hubDegreeLimit: 96,
    edgeWeights: { calls: 1.0, imports: 0.6 },
  },
});
```

## 3. Deduplication

Chunk ids equal graph node ids, so every stage's hits merge into **one
candidate per node**, accumulating per-source raw signals (`lexical`,
`semantic`, `graph`), source tags, and minimum hop depth. Repository,
directory, and external-module nodes are filtered out — only file-backed
nodes are retrievable output.

## 4. Ranking engine (phase 10)

Nine signals per candidate:

| Signal       | Source                                                  | Computed   |
| ------------ | ------------------------------------------------------- | ---------- |
| `semantic`   | embedding cosine                                        | query time |
| `lexical`    | BM25 score                                              | query time |
| `graph`      | expansion propagation                                   | query time |
| `centrality` | weighted PageRank over the whole graph                  | index time |
| `importance` | fan-in + export surface + entrypoint bonus + path shape | index time |
| `activity`   | git commit count in the window                          | index time |
| `recency`    | half-life decay on last commit/mtime (30-day half-life) | index time |
| `dependency` | import fan-in                                           | index time |
| `usage`      | incoming Calls + References on the symbol               | index time |

**Normalization strategy.** Query-dependent signals are min-max normalized
_within the candidate set_ — their absolute scales are query-specific and
only relative order matters; a degenerate (all-equal) distribution maps to
1.0 because for a query signal, having matched at all is the information.
Corpus signals are heavily right-skewed, so they are `log1p`-scaled and
min-max normalized _across the corpus_ at index time and pass through query
time untouched.

**Fusion.** The final formula (weighted mode, the default — config
`ranking: "hybrid"`):

```ts
finalScore =
  Σ over available signals s of (weight[s] / Σ availableWeights) × signal[s];
```

Weights are **renormalized over the signals actually present** for the
query, so a repository without git history or embeddings is not penalized —
the remaining evidence is re-weighted to sum to 1. Defaults: semantic 0.28 ·
lexical 0.18 · graph 0.20 · centrality 0.07 · importance 0.07 · usage 0.06 ·
dependency 0.06 · activity 0.04 · recency 0.04.

**RRF mode** (`ranking: "rrf"`) replaces values with reciprocal ranks
(`k = 60`), ranking on _raw_ values so an absent signal sorts strictly below
the weakest present one. More robust when score distributions are
unreliable; loses magnitude information.

**Determinism.** Every sort in the pipeline tie-breaks on node id. Identical
repository + identical query = byte-identical results, in both modes.

Plugin `SignalProvider`s inject additional named signals with their own
weights, and plugin `rerank` functions run after fusion — see
[plugins.md](plugins.md).
