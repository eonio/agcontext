# Testing Strategy

Four layers, all hermetic (no network, no API keys — the offline `local`
provider and stubbed `fetch` cover everything):

## Unit tests (`tests/unit/`)

Module-level behavior: tokenization, normalization math, the heap, BM25
scoring, the embedding index (round-trips, pruning, growth), the local
provider (determinism, normalization), every HTTP adapter against a stubbed
`fetch` (request shaping, retries, error taxonomy), the provider registry,
config validation/merging/loading, JSON stores, telemetry, the AST analyzer
(fixture files + synthetic edge cases: aliased/default exports, `require()`,
namespaces, overload merging, malformed input), the graph builder (every
edge kind on the fixture), traversal guards, PageRank + metrics, the ranker
(both fusion modes), compression, the context builder (budget, redundancy,
determinism), renderers (escaping, CDATA), and the plugin manager.

## Integration tests (`tests/integration/`)

Cross-module pipelines on real temp directories:

- **index-retrieve** — full index → retrieve → context on the fixture repo,
  incremental re-index, change detection, persistence across instances,
  `NotIndexedError`.
- **repository-analysis** — the phase 6 report end to end.
- **cli** — every `agc` command in-process through `runCli` with captured IO
  (which is why CLI handlers count toward coverage).
- **facade** — explain resolution/ambiguity, AI explanation via an injected
  fake provider, doctor checks, plugin hooks + custom signals end to end,
  graceful degradation when the embedding provider fails.
- **git-signals** — a real temp git repository (skipped when git is absent).
- **performance** — the < 500 ms warm-retrieval assertion on a 121-file
  synthetic repository.

## E2E tests (`tests/e2e/`)

Spawn the **built** `dist/cli/main.js` as a child process — exactly what an
npm consumer executes — with scrubbed provider env. `npm run test:e2e`
builds first.

## Benchmarks (`tests/benchmarks/`)

`npm run bench` — BM25 search, full hybrid retrieval, and context assembly
on a 150-file synthetic repository via vitest bench.

## Coverage

`npm run test:coverage` enforces thresholds in `vitest.config.ts`:
**lines/statements >= 90%, functions >= 92%, branches >= 78%** (v8
provider, `src/**` excluding barrels and the bin shim). CI fails below the
floor.

## The fixture repository

`tests/fixtures/sample-repo/` is a miniature application engineered so that
_every_ graph relationship exists at least once: barrel + star re-exports,
NodeNext `.js` → `.ts` specifiers, class inheritance, constructor-property
composition, `this.` calls, cross-file calls via imports and unique global
names, instantiations, an external package (`express`), an exported const, a
gitignored directory, and a dedicated tests folder importing the sources.
Extend it rather than creating parallel fixtures.
