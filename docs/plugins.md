# Plugin System

Plugins extend AGContext along four axes — graph, ranking, compression, and
providers — plus lifecycle hooks. A plugin declares capabilities
_declaratively_ and/or registers them _imperatively_ in `setup()`.

## Anatomy

```ts
import { definePlugin } from "@eonio/agcontext";

export default definePlugin({
  name: "my-plugin",
  version: "1.0.0",

  /* GraphPlugin capabilities */
  graph: {
    analyzers: [myPythonAnalyzer],          // SourceAnalyzer: add languages
    extend: (graph) => {                    // add custom nodes/edges
      graph.addNode({ id: "svc:billing", kind: NodeKind.Module,
                      name: "billing-service", metrics: {} });
    },
  },

  /* RankingPlugin capabilities */
  ranking: {
    signals: [{                             // new named signal in [0,1]
      name: "ticketHeat",
      weight: 0.1,
      compute: (nodeId, { graph }) => heatByFile.get(fileOf(nodeId, graph)),
    }],
    weights: { recency: 0.1 },              // override built-in weights
    rerank: (candidates, query) => candidates, // post-fusion adjustment
  },

  /* CompressionPlugin capability */
  compression: {
    fileSummarizer: {
      summarize: (analysis, defaultSummary) =>
        `${defaultSummary}\n// owner: ${ownerOf(analysis.path)}`,
    },
  },

  /* ProviderPlugin capability */
  providers: [myProvider],                  // then: config provider: "my-llm"

  /* Lifecycle hooks */
  hooks: {
    afterIndex: ({ stats, graph }) => { ... },
    extendGraph: (graph) => { ... },        // runs on every graph load
    beforeRetrieve: ({ options }) => { options.graphDepth = 3; }, // mutable
    afterRetrieve: (result) => { ... },     // items mutable
    beforeContext: (pkg) => { pkg.recommendations.push("..."); },
  },

  /* Imperative alternative with full access */
  async setup(ctx) {
    ctx.registerSignal(...);
    ctx.registerAnalyzer(...);
    ctx.registerProvider(...);
    ctx.registerFileSummarizer(...);
    ctx.on("afterRetrieve", ...);
    // ctx.config / ctx.logger / ctx.telemetry available
  },
});
```

The named types `GraphPlugin`, `RankingPlugin`, `CompressionPlugin`, and
`ProviderPlugin` are refinements of `AGContextPlugin` that _require_ their
capability block — use them to type focused plugins precisely.

## Loading

```ts
// Programmatic — before the first operation:
const agc = new AGContext().use(myPlugin);
```

```ts
// Config file — objects or module specifiers:
export default defineConfig({
  plugins: [
    myInlinePlugin,
    "./agc-plugins/ownership.mjs", // relative to the repo root
    "agc-plugin-jira", // installed package
  ],
});
```

Module specifiers are dynamically imported; the default export may be the
plugin object or a (possibly async) factory returning one.

## Execution semantics

- Plugins load in order; duplicate names are rejected.
- Plugin analyzers take precedence over the built-in TypeScript analyzer for
  the extensions they claim.
- Plugin signals get a default weight of 0.05 unless they specify one;
  their values are clamped to [0,1] and fused exactly like built-in signals.
- Hooks run sequentially in registration order; `extendGraph` runs after
  every index _and_ every snapshot load (plugin-added graph data is
  recomputed, never persisted).
- Every plugin failure is wrapped in a `PluginError` naming the plugin —
  a broken plugin never produces a mystery stack.

## A complete worked example

See `examples/custom-plugin/` for a runnable plugin that boosts recently
hot files with a custom signal and annotates compressed summaries.
