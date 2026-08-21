# The `agc` CLI

```bash
npm install -g @eonio/agcontext   # or: npx @eonio/agcontext ...
agc --help
```

Global flags on every command: `--cwd <dir>`, `--config <file>`, `--json`,
`--quiet`. stdout carries data (pipeable); stderr carries commentary. Exit
codes: `0` success, `1` failure (typed error printed), `2`+ usage errors.

## Commands

### `agc init`

Scaffolds `agcontext.config.ts`, gitignores `.agcontext/`, and reports which
provider keys were detected (or that you are in fully-offline mode).
`--force` overwrites an existing config.

### `agc index`

Builds or incrementally updates the index. `--force` ignores every cache.

```text
indexed 412 files in 3.1s (incremental: +2 ~5 -0)
  graph:      3187 nodes, 9421 edges (2775 symbols)
  retrieval:  3187 chunks, 3187 embedded
```

### `agc graph [target]`

Without a target: node/edge counts by kind. With a target (symbol name, file
path, or node id): the node's neighborhood grouped by relation kind.

```bash
agc graph
agc graph AuthService
agc graph src/auth/auth-service.ts --json
```

### `agc search "query"`

Fast lexical search — no API calls, no graph expansion. Options:
`-n, --limit <count>`.

### `agc retrieve "query"`

The full hybrid pipeline with per-signal score breakdowns and stage timings.
Options: `-n, --limit`, `-s, --strategy <hybrid|graph|lexical|semantic>`,
`-d, --depth <hops>`.

```text
#  score  kind    name         location                     signals              via
1  0.847  class   AuthService  src/auth/auth-service.ts:14  lex .91 gph .78 ...  lexical+semantic+graph
2  0.512  method  login        src/auth/auth-service.ts:19  gph .95 use .60      graph@1
...
18/64 candidates in 74ms [hybrid; seeds=9, expanded=41, embeddings=on] (lexical 3ms, semantic 12ms, ...)
```

### `agc context "query"`

Assembles the token-budgeted context package. Options: `-f, --format
<markdown|xml|json>`, `-b, --budget <tokens>`, `-o, --out <file>`,
`-s, --strategy`, `-d, --depth`, `--no-architecture`,
`--no-recommendations`.

```bash
agc context "how does authentication work" --format xml --budget 8000 --out ctx.xml
```

### `agc explain <target>`

A symbol/file card: signature, doc, metrics (centrality, importance, usage,
commits), and graph relations. `--full` adds the compressed file summary;
`--ai` adds an LLM-generated explanation (requires a generation provider).

```bash
agc explain AuthService
agc explain src/auth/token.ts --full
agc explain UserRepository.findByEmail --ai
```

### `agc doctor`

Environment/config/index health: Node version, config source, cache
writability, index presence and staleness (files changed since indexing),
detected providers, generation/embedding resolution, embedding-index
provider match, loaded plugins. `--network` adds one tiny embedding call to
probe connectivity. Exits 1 if any check fails.

### `agc stats`

Index metadata, graph counts, retrieval configuration, cache file sizes, and
(when telemetry is enabled) per-event latency aggregates.

### `agc version`

Prints the version (as does `-v, --version`).

## Scripting

Every informational command supports `--json`:

```bash
agc retrieve "payment flow" --json | jq '.items[].path'
agc doctor --json | jq '[.[] | select(.status != "pass")]'
agc context "add rate limiting" --format json | jq '.tokens'
```
