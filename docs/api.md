# Public TypeScript API

Everything ships from the package root:

```ts
import { AGContext, defineConfig } from "@eonio/agcontext";
```

## Quick start

```ts
import { AGContext } from "@eonio/agcontext";

const agc = new AGContext();

await agc.index(); // build or incrementally update the index

const context = await agc.retrieve({
  query: "How does authentication work?",
});

for (const item of context.items) {
  console.log(item.score.toFixed(3), item.kind, item.name, item.path);
}
```

## Advanced construction

```ts
const agc = new AGContext({
  // Flat ergonomic config (same keys as agcontext.config.ts)
  graphDepth: 3,
  strategy: "hybrid",
  provider: "anthropic",
  embeddingProvider: "openai",
  maxNodes: 50,
  weights: { semantic: 0.35, graph: 0.25 },

  // Harness injection points
  cwd: "/path/to/repo",
  configFile: false, // skip agcontext.config.* discovery
  logger: myLogger, // any { debug, info, warn, error }
  tokenCounter: myTokenizer, // real tokenizer instead of the heuristic
  providers: {
    // instance injection beats name resolution
    generate: myProvider,
    embed: myEmbedder,
  },
  env: { get: (k) => vault[k] }, // custom secret source
});
```

Constructor options are `AGContextUserConfig` (every config-file field, flat)
plus injection points — see [configuration.md](configuration.md) for the full
schema. Construction is synchronous and cheap; discovery, plugin loading, and
provider resolution happen lazily on the first call.

## AGContext methods

| Method                                 | Returns              | Purpose                                                                               |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `index({ force? })`                    | `IndexStats`         | Build/update the index (incremental unless `force`).                                  |
| `retrieve(query \| RetrieveOptions)`   | `RetrievalResult`    | Full hybrid retrieval + multi-signal ranking.                                         |
| `search(query \| RetrieveOptions)`     | `RetrievalResult`    | Fast lexical-first lookup (no embedding call, no expansion).                          |
| `context(query \| ContextOptions)`     | `ContextPackage`     | Retrieval + token-budgeted context assembly.                                          |
| `contextText(query \| ContextOptions)` | `string`             | `context()` rendered as markdown/XML/JSON.                                            |
| `explain(target, { ai? })`             | `SymbolExplanation`  | Symbol/file card: signature, doc, metrics, graph relations; optional LLM explanation. |
| `repositoryAnalysis()`                 | `RepositoryAnalysis` | Repository intelligence report.                                                       |
| `graph()`                              | `CodeGraph`          | Read access to the loaded code graph.                                                 |
| `stats()`                              | `AGCStats`           | Index/graph/cache/telemetry statistics.                                               |
| `doctor({ network? })`                 | `DoctorCheck[]`      | Environment and index health checks.                                                  |
| `use(plugin)`                          | `this`               | Register a plugin (before the first operation).                                       |
| `resolvedConfig()`                     | `ResolvedConfig`     | The fully-layered effective configuration.                                            |
| `dispose()`                            | `void`               | Flush telemetry sinks.                                                                |

### Key option and result types

```ts
interface RetrieveOptions {
  query: string;
  limit?: number; // default: 20
  strategy?: "hybrid" | "graph" | "lexical" | "semantic";
  graphDepth?: number; // expansion hops, default 2
  maxNodes?: number; // expansion result cap, default 50
  signal?: AbortSignal;
}

interface ContextOptions extends RetrieveOptions {
  maxTokens?: number; // default: 12000
  format?: "markdown" | "xml" | "json";
  includeArchitecture?: boolean;
  includeRecommendations?: boolean;
}

interface RetrievalResult {
  query: string;
  items: RetrievedItem[]; // ranked; each carries score, per-signal
  // breakdown, sources, depth, snippet
  diagnostics: RetrievalDiagnostics; // stage timings, counts, strategy
}

interface ContextPackage {
  summary: string;
  architecture: string[];
  files: ContextFile[]; // full | compressed | mention representations
  symbols: ContextSymbol[]; // signature cards, optionally with code
  recommendations: string[]; // graph-driven next steps
  tokens: { budget: number; used: number; breakdown: Record<string, number> };
  meta: { query; strategy; nodeCount; indexedAt? };
}
```

## Interfaces, generics, and extension points

The package is built around a small set of ports (dependency inversion):

```ts
interface LLMProvider {
  readonly name: string;
  readonly capabilities: { generate: boolean; embed: boolean };
  readonly embedModel?: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

interface SourceAnalyzer {           // add languages
  readonly name: string;
  readonly extensions: readonly string[];
  analyze(path: string, content: string): FileAnalysis | undefined;
}

interface SignalProvider {           // add ranking signals
  name: string;
  weight?: number;
  compute(nodeId: string, ctx: { query: string; graph: CodeGraph }): number | undefined;
}

interface TokenCounter { count(text: string): number }
interface Logger { debug/info/warn/error(msg, ...args): void }
interface Clock { now(): number }
interface ProviderEnv { get(name: string): string | undefined }
```

Generic helpers keep authoring type-safe end to end:

```ts
defineConfig<T extends AGContextUserConfig>(config: T): T   // config files
definePlugin<T extends AGContextPlugin>(plugin: T): T       // plugins
readJsonStore<T>(path, version): Promise<T | undefined>     // typed stores
PluginManager.emit<K extends keyof PluginHooks>(k, payload) // typed hooks
```

Plugin contracts (`AGContextPlugin`, `GraphPlugin`, `RankingPlugin`,
`CompressionPlugin`, `ProviderPlugin`, `PluginHooks`) are documented in
[plugins.md](plugins.md).

## Composing the pieces yourself

Every subsystem is exported for advanced embedding — build a custom pipeline
without the facade:

```ts
import {
  TypeScriptAnalyzer,
  buildGraph,
  applyGraphMetrics,
  buildFileChunks,
  BM25Index,
  expandFromSeeds,
  Ranker,
  ContextBuilder,
  renderXml,
} from "@eonio/agcontext";
```

## Errors

All failures are `AGContextError` subclasses with stable `code`s:
`CONFIG`, `INDEX`, `NOT_INDEXED`, `PROVIDER`, `PROVIDER_CAPABILITY`,
`PLUGIN`, `NODE_NOT_FOUND`, `AMBIGUOUS_TARGET`, `CACHE`. Branch on
`error.code`, not messages.
