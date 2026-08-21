# Package Structure

AGContext is an npm-workspaces monorepo. The published package lives in
`packages/agcontext`; the root holds shared tooling, docs, and examples so
future packages (MCP server, editor extensions — see the roadmap) join
without restructuring.

```text
agcontext/
├── package.json                  # private workspace root, shared scripts
├── tsconfig.base.json            # strict compiler baseline (NodeNext, ES2023)
├── eslint.config.mjs             # flat ESLint config (typescript-eslint)
├── .prettierrc.json              # formatting contract
├── .github/workflows/            # CI + release pipelines
├── docs/                         # product + engineering documentation
├── examples/                     # runnable usage examples
└── packages/
    └── agcontext/                # @eonio/agcontext (the npm package)
        ├── package.json          # exports, bin: { agc }, files: [dist]
        ├── tsconfig.build.json   # emit config (src → dist)
        ├── vitest.config.ts      # unit + integration + coverage gates
        ├── vitest.e2e.config.ts  # built-binary e2e suite
        ├── src/                  # see below
        └── tests/
            ├── unit/             # module-level tests
            ├── integration/      # cross-module pipelines on fixtures
            ├── e2e/              # spawned dist/cli binary
            ├── benchmarks/       # vitest bench suites
            ├── fixtures/         # sample-repo: miniature app exercising
            │                     # every graph relationship
            └── helpers/          # temp dirs, fixture copies, synthetic repos
```

## `src/` — one directory per subsystem

```text
src/
├── core/        # domain types, errors, ports, pure utilities (no IO)
├── config/      # schema (zod), defaults, discovery/loading, resolution
├── cache/       # .agcontext/ workspace + atomic versioned JSON stores
├── telemetry/   # opt-in local metrics (ring buffer + JSONL sink)
├── providers/   # LLMProvider port + openai/anthropic/azure/google/
│                # openrouter/local adapters + env registry
├── indexing/    # scanner, TS/JS AST analyzer, chunker, git inspector,
│                # index orchestrator + snapshot loading
├── graph/       # CodeGraph store, cross-file linker, best-first expansion,
│                # PageRank + corpus metrics
├── analysis/    # repository intelligence (patterns, layout, hotspots,
│                # ownership)
├── retrieval/   # BM25, embedding index, query parsing, hybrid orchestrator
├── ranking/     # multi-signal normalization + weighted/RRF fusion
├── compression/ # file/symbol/architecture/dependency summaries
├── context/     # token-budgeted builder, recommendations, renderers
├── plugins/     # plugin contracts + manager
├── cli/         # commander program, IO seam, formatting, commands/
├── agcontext.ts # the AGContext facade (composition root)
├── version.ts   # package identity
└── index.ts     # public API surface
```

Why this shape:

- **`core/` is the dependency sink.** Every module imports core; core
  imports nothing. This keeps domain types IO-free and the layering
  enforceable at a glance.
- **Each subsystem is a folder with an `index.ts` barrel** so internal
  imports are explicit (`../graph/traversal.js`) while the public surface is
  curated once in `src/index.ts`.
- **`indexing/` and `graph/` split the two halves of phase 5**: per-file
  extraction (embarrassingly parallel, cacheable) vs. cross-file linking
  (cheap, recomputed each run). The split is what makes incremental indexing
  simple and correct.
- **`cli/commands/` holds one file per command**, all thin wrappers over the
  facade with an injected IO seam — the CLI is tested in-process with full
  coverage, plus spawned end-to-end.
- **`tests/fixtures/sample-repo/`** is a deliberately engineered miniature
  application (barrels, star re-exports, inheritance, composition, `this.`
  calls, external packages, tests directory) — a single shared canvas every
  suite asserts against.
