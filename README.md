# AGContext

> **Augmented Context** — a context engineering harness for AI coding agents.
>
> _Give agents the context a senior engineer would gather before making a change._

[![CI](https://github.com/eonio/agcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/eonio/agcontext/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40eonio%2Fagcontext)](https://www.npmjs.com/package/@eonio/agcontext)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Most code agents can **search text**. Few can **navigate software systems**.
AGContext sits between your codebase and any AI coding agent — GitHub
Copilot, Claude Code, Cursor, Roo Code, Cline, OpenHands, or your own — and
combines **code graphs**, **hybrid retrieval**, **repository compression**,
**multi-signal ranking**, and **token-aware context assembly** into one
pipeline, so the agent starts every task the way a senior engineer would:
knowing the entry points, the call sites, the contracts, and the
architecture.

AGContext is **not another RAG framework**. It is the context engineering
layer underneath: it understands the repository as a _system_ and hands any
agent (or any RAG pipeline) dramatically better raw material.

```text
User Query
    ↓
AGContext
    ↓  Code Graph  →  Hybrid Retrieval  →  Compression  →  Ranking  →  Context Builder
    ↓
Agent
```

## Why hybrid?

- **Vector search alone** returns disconnected look-alike chunks: no notion
  of _calls_, _implements_, or _imported-by_, and no idea which files are
  load-bearing.
- **Graph search alone** cannot understand a question, and naive traversal
  explodes through hub files within two hops.
- **Together**: lexical (BM25) anchors exact identifiers, embeddings bridge
  vocabulary, and budget-guarded graph expansion surfaces the callers,
  callees, and base classes that share _no words_ with the query — then nine
  ranking signals (semantic, lexical, graph proximity, PageRank centrality,
  file importance, git activity, recency, dependency weight, symbol usage)
  decide what actually enters the token budget.

See [docs/product-vision.md](docs/product-vision.md) for the full argument.

## Installation

```bash
npm install @eonio/agcontext        # library + CLI in your project
npm install -g @eonio/agcontext     # global `agc`
```

Requires **Node.js >= 22**. Works fully offline out of the box — no API
keys required (deterministic local embeddings); add provider keys for
higher-quality semantic retrieval and AI explanations.

## Quick start (CLI)

```bash
cd your-repo
agc init          # scaffold agcontext.config.ts, gitignore the cache
agc index         # build the code graph + retrieval index (incremental after)

agc search "authentication"                 # fast lexical hits
agc retrieve "how does login work"          # full hybrid pipeline + ranking
agc context "how does login work" --format xml --budget 8000
agc explain AuthService                     # signature, relations, metrics
agc graph AuthService                       # graph neighborhood
agc doctor                                  # health checks
agc stats                                   # index/graph/cache statistics
```

`agc retrieve` shows exactly why every result ranked where it did:

```text
#  score  kind    name         location                     signals              via
1  0.847  class   AuthService  src/auth/auth-service.ts:14  lex .91 gph .78 ...  lexical+semantic+graph
2  0.512  method  login        src/auth/auth-service.ts:19  gph .95 use .60      graph@1
```

## Quick start (library)

```ts
import { AGContext } from "@eonio/agcontext";

const agc = new AGContext();
await agc.index();

const context = await agc.retrieve({
  query: "How does authentication work?",
});

// Or the fully assembled, token-budgeted package:
const pkg = await agc.context({ query: "How does authentication work?", maxTokens: 8000 });
console.log(pkg.summary); // one-paragraph framing
console.log(pkg.architecture); // repo shape, patterns, dependency map
console.log(pkg.files); // full | compressed | mention representations
console.log(pkg.symbols); // signature cards with graph relations
console.log(pkg.recommendations); // "AuthService is called by LoginController (…) — not included here"

const xml = await agc.contextText({ query: "…", format: "xml" }); // for your agent prompt
```

Advanced construction:

```ts
const agc = new AGContext({
  graphDepth: 3,
  strategy: "hybrid",
  provider: "anthropic",
  embeddingProvider: "openai",
});
```

## Providers

| Provider        | Env var                                       | generate | embed |
| --------------- | --------------------------------------------- | :------: | :---: |
| Anthropic       | `ANTHROPIC_API_KEY`                           |    ✓     |   —   |
| OpenAI          | `OPENAI_API_KEY`                              |    ✓     |   ✓   |
| Azure OpenAI    | `AZURE_OPENAI_API_KEY` + endpoint/deployments |    ✓     |   ✓   |
| Google Gemini   | `GOOGLE_API_KEY`                              |    ✓     |   ✓   |
| OpenRouter      | `OPENROUTER_API_KEY`                          |    ✓     |   —   |
| local (offline) | —                                             |    —     |   ✓   |

`auto` resolution picks the best configured option and always falls back to
the offline local embedder — details in [docs/providers.md](docs/providers.md).

## How it works

1. **Index** — scan (gitignore-aware, incremental by content hash), parse
   every TS/JS file with the TypeScript compiler API, link a typed code
   graph (imports, exports, references, calls, inheritance, composition),
   precompute corpus signals (PageRank centrality, importance, git
   activity), chunk symbols, build BM25 + embedding indexes, and produce a
   repository intelligence report — all persisted under `.agcontext/`.
2. **Retrieve** — BM25 + embedding + exact-name candidates seed a
   best-first graph expansion guarded by depth limits, traversal budgets,
   score thresholds, and hub damping; everything dedupes into one candidate
   per graph node.
3. **Rank** — nine normalized signals fused by weighted sum (or RRF), with
   weights renormalized over the evidence actually available.
4. **Assemble** — a deterministic builder packs the budget using a
   representation ladder (full source → compressed signatures → mention),
   removes redundancy, and adds graph-driven recommendations. Warm
   retrieval lands in **well under 500 ms**.

Deep dives: [architecture](docs/architecture.md) ·
[retrieval & ranking](docs/retrieval.md) ·
[compression & assembly](docs/compression.md) ·
[performance](docs/performance.md)

## Documentation

|                                                |                                                        |
| ---------------------------------------------- | ------------------------------------------------------ |
| [Product vision](docs/product-vision.md)       | Problem, solution, why hybrid wins, success metrics    |
| [Architecture](docs/architecture.md)           | System diagram and layer responsibilities              |
| [Package structure](docs/package-structure.md) | Monorepo and module layout                             |
| [Public API](docs/api.md)                      | `AGContext`, types, interfaces, extension points       |
| [CLI](docs/cli.md)                             | Every `agc` command with examples                      |
| [Configuration](docs/configuration.md)         | Full config reference and env vars                     |
| [Providers](docs/providers.md)                 | Adapters, resolution rules, custom providers           |
| [Plugins](docs/plugins.md)                     | Graph/Ranking/Compression/Provider plugins + hooks     |
| [Telemetry](docs/telemetry.md)                 | Opt-in, local-only metrics                             |
| [Testing](docs/testing.md)                     | Unit/integration/e2e/benchmarks, coverage gates        |
| [Roadmap](docs/roadmap.md)                     | MCP server, VS Code, Copilot, multi-repo, agent memory |

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Development is
standard: `npm install`, `npm run build`, `npm test`. The
[fixture repository](packages/agcontext/tests/fixtures/sample-repo) and the
determinism rules in the contributing guide are the two things to know
before diving in.

## License

[MIT](LICENSE) © eonio
