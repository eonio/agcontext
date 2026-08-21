# Configuration

Configuration layers, lowest to highest precedence:

1. **Built-in defaults** — production-quality out of the box.
2. **Config file** — the nearest `agcontext.config.{ts,mts,js,mjs,json}`
   walking up from the working directory (TypeScript configs are evaluated
   with jiti — no build step).
3. **Programmatic overrides** — `new AGContext({ ... })` constructor options
   or CLI flags.

Every layer is validated with zod; invalid values fail fast with the exact
failing path.

## agcontext.config.ts

```ts
import { defineConfig } from "@eonio/agcontext";

export default defineConfig({
  graphDepth: 3,
  maxNodes: 50,
  ranking: "hybrid",
});
```

`agc init` scaffolds a commented starter config and gitignores `.agcontext/`.

## Full reference

```ts
export default defineConfig({
  /* Repository */
  root: ".", // relative to the config file
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  exclude: ["generated/"], // gitignore-style, on top of .gitignore
  maxFileSizeBytes: 1_572_864, // skip larger files (1.5 MB)

  /* Retrieval */
  strategy: "hybrid", // hybrid | graph | lexical | semantic
  graphDepth: 2, // expansion hops from seeds
  maxNodes: 50, // nodes considered for context assembly
  retrieval: {
    limit: 20, // retrieve() result count
    candidateLimit: 100, // per-stage candidates before fusion
    snippetLength: 240, // result snippet chars (0 disables)
  },

  /* Graph expansion guards (see docs/retrieval.md) */
  expansion: {
    traversalBudget: 300,
    minScore: 0.05,
    decay: 0.6,
    hubDegreeLimit: 64,
    edgeWeights: {
      calls: 1.0,
      inheritance: 0.9,
      composition: 0.8,
      imports: 0.7,
      references: 0.6,
      exports: 0.5,
      contains: 0.4,
    },
  },

  /* Ranking */
  ranking: "hybrid", // hybrid (weighted) | rrf
  weights: {
    // relative; renormalized over available signals
    semantic: 0.28,
    lexical: 0.18,
    graph: 0.2,
    centrality: 0.07,
    importance: 0.07,
    usage: 0.06,
    dependency: 0.06,
    activity: 0.04,
    recency: 0.04,
  },

  /* Providers (see docs/providers.md) */
  provider: "auto", // generation: auto | openai | anthropic |
  // azure | google | openrouter | <plugin>
  embeddingProvider: "auto", // embeddings: falls back to offline "local"
  models: { generate: "claude-haiku-4-5-20251001", embed: "text-embedding-3-small" },

  /* Context assembly */
  context: {
    maxTokens: 12_000,
    format: "markdown", // markdown | xml | json
    maxFileTokens: 2_000, // cap for one full-file inclusion
    maxSymbolTokens: 800, // cap for one full-symbol inclusion
    includeArchitecture: true,
    includeRecommendations: true,
  },

  /* Git signals */
  git: { enabled: true, windowDays: 180, maxCommits: 2000 },

  /* Cache + telemetry */
  cache: { dir: ".agcontext" },
  telemetry: { enabled: false, file: false }, // opt-in, local-only

  /* Plugins: objects or module specifiers */
  plugins: ["./agc-plugins/jira-signal.mjs"],
});
```

## Environment variables

Provider credentials are environment-only — never written to config, cache,
or logs:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AZURE_OPENAI_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=

# Azure additionally:
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_EMBED_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=       # optional, default 2024-10-21
```

Blank values (a dangling `OPENAI_API_KEY=` in a `.env`) are treated as
absent.

## Validation behavior

- Unknown edge kinds in `expansion.edgeWeights` → hard `ConfigError` listing
  the valid kinds.
- Out-of-range numbers (e.g. `graphDepth: 12`, `retrieval.limit: 0`) →
  `ConfigError` naming the exact path.
- `ranking: "hybrid"` is an alias of the weighted engine; `"rrf"` switches
  fusion modes.
- Explicitly selecting an embed-incapable provider
  (`embeddingProvider: "anthropic"`) fails fast at startup rather than at
  query time.
- A config _fingerprint_ (extensions, excludes, size cap, analyzer version)
  is stored with the index; changing any of them triggers a full re-index
  automatically.
