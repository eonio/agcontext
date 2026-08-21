# Telemetry

**Disabled by default. Strictly local. Never transmitted.**

AGContext's telemetry exists so _you_ can see where time and tokens go — it
is an observability feature, not a data collection channel. There is no
network sink in the codebase, by design.

## Enabling

```ts
// agcontext.config.ts
export default defineConfig({
  telemetry: {
    enabled: true, // in-memory ring buffer (powers `agc stats`)
    file: true, // also append JSONL to .agcontext/telemetry/events.jsonl
  },
});
```

## What is captured

| Event                | Fields                                                           |
| -------------------- | ---------------------------------------------------------------- |
| `index.run`          | durationMs, files, nodes, edges, chunks, embedded, incremental   |
| `index.embed.batch`  | chunks, inputTokens (provider-reported usage)                    |
| `retrieval.pipeline` | durationMs, strategy, candidates, seeds, expanded, embeddingUsed |
| `retrieval.total`    | durationMs, results, strategy                                    |
| `context.build`      | tokens, budget, files, symbols                                   |
| `explain.generate`   | provider, inputTokens, outputTokens                              |

Field values are numbers/strings/booleans only. **No source code, no file
contents, no queries, and no API keys ever appear in telemetry records.**

## Consuming

```bash
agc stats            # per-event count / avg / max latency table
```

```ts
const agc = new AGContext({ telemetry: { enabled: true } });
// ... use it ...
const summary = (await agc.stats()).telemetry;
// { "retrieval.total": { count: 12, avgMs: 84.2, maxMs: 201, ... }, ... }
await agc.dispose(); // flush the JSONL sink
```

The JSONL file is newline-delimited `{ name, at, fields }` records — trivial
to load into any analysis tool.

## Extending

`TelemetrySink` is a public interface; embedders can attach custom sinks
(e.g. forwarding into an existing metrics system) by constructing
`new Telemetry({ enabled: true, sinks: [mySink] })` and passing nothing —
the package itself will only ever write to memory and the local file.
