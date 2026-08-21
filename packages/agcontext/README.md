# @eonio/agcontext

> **AGContext (Augmented Context)** — a context engineering harness for AI
> coding agents. _Give agents the context a senior engineer would gather
> before making a change._

[![CI](https://github.com/eonio/agcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/eonio/agcontext/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40eonio%2Fagcontext)](https://www.npmjs.com/package/@eonio/agcontext)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

AGContext combines **code graphs**, **hybrid retrieval** (BM25, embeddings,
and graph expansion), **repository compression**, **multi-signal ranking**,
and **token-aware context assembly** so any agent — Copilot, Claude Code,
Cursor, Cline, or your own — starts each task with the entry points, call
sites, contracts, and architecture already in hand.

Works fully offline (deterministic local embeddings, no API keys required);
OpenAI / Anthropic / Azure / Google / OpenRouter keys upgrade quality when
present.

## Install

```bash
npm install @eonio/agcontext      # Node.js >= 22
```

## CLI

```bash
agc init                                  # scaffold config, gitignore cache
agc index                                 # build/update the index
agc retrieve "how does login work"        # hybrid retrieval + ranking
agc context "how does login work" --format xml --budget 8000
agc explain AuthService                   # relations, metrics, summary
agc doctor                                # health checks
```

## Library

```ts
import { AGContext } from "@eonio/agcontext";

const agc = new AGContext();
await agc.index();

const result = await agc.retrieve({ query: "How does authentication work?" });
const pkg = await agc.context({ query: "How does authentication work?", maxTokens: 8000 });
const xml = await agc.contextText({ query: "…", format: "xml" });
```

Configuration lives in `agcontext.config.ts`:

```ts
import { defineConfig } from "@eonio/agcontext";

export default defineConfig({
  graphDepth: 3,
  maxNodes: 50,
  ranking: "hybrid",
});
```

## Documentation

Full docs — product vision, architecture, API reference, CLI guide,
configuration, providers, plugins, performance, roadmap — live in the
[GitHub repository](https://github.com/eonio/agcontext#documentation).

## License

[MIT](LICENSE) © eonio
