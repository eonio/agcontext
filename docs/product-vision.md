# AGContext — Product Definition

> **AGContext (Augmented Context)** is a context engineering harness for AI
> coding agents. It sits between codebases and agents, and its mission is
> simple: _give agents the context a senior engineer would gather before
> making a change._

## Product Vision

Every AI coding agent — GitHub Copilot, Claude Code, Cursor, Roo Code, Cline,
OpenHands, or your custom agent — is bottlenecked by the same thing: the
quality of the context in its window. Model capability keeps climbing;
context quality has not kept pace. Agents routinely read the wrong files,
miss the call site that matters, and re-derive architecture that a senior
engineer holds in their head.

AGContext's vision is to become the **standard context engineering layer**
for AI coding agents: one indexing pass, one retrieval API, one assembled
context package — consumable by any agent, on any provider, with zero
mandatory API keys.

## Problem Statement

Most code agents can _search text_. Few can _navigate software systems_.

Concretely, when an agent is asked "fix the login timeout," it needs:

1. the authentication service itself (easy — text search finds it),
2. the session/token code it calls (harder — different vocabulary),
3. the controller and middleware that call _it_ (harder still — reverse
   dependencies are invisible to text search),
4. the base classes and interfaces that shape its behavior,
5. an architectural frame: where this sits in the system, what patterns the
   repo uses, which files are load-bearing,
6. all of it inside a strict token budget.

Today's tooling gives agents grep and, at best, a vector store. Both answer
"what looks similar to the query" — neither answers "what is _connected_ to
the answer." The result is familiar: agents patch symptoms at the match site,
break unseen callers, and burn tokens on irrelevant files.

## Solution Overview

AGContext combines five subsystems into one pipeline:

- **Code Graph** — an AST-derived graph of repositories, directories, files,
  classes, interfaces, functions, methods, types, and modules, connected by
  imports, exports, references, calls, inheritance, and composition.
- **Hybrid Retrieval** — lexical (BM25), semantic (embeddings), and
  structural (graph traversal) retrieval running together, each covering the
  others' blind spots.
- **Repository Compression** — Repomix-inspired file/symbol/architecture/
  dependency summaries that preserve shape while shedding tokens.
- **Multi-Signal Ranking** — nine signals (semantic, lexical, graph
  proximity, centrality, file importance, git activity, recency, dependency
  weight, symbol usage) fused into one score.
- **Context Assembly** — a deterministic, token-budgeted packager that emits
  a summary, architecture brief, files, symbols, and next-step
  recommendations in markdown, XML, or JSON.

It ships as a TypeScript library (`@eonio/agcontext`) and a CLI (`agc`), and
is provider-agnostic across OpenAI, Anthropic, Azure OpenAI, Google, and
OpenRouter — with a deterministic offline embedding provider so everything
works with no keys at all.

**AGContext is not another RAG framework.** RAG frameworks orchestrate
prompts around a vector store. AGContext is the layer _below_ that: it
understands the repository as a system and hands any agent — or any RAG
pipeline — dramatically better raw material.

## Why Vector Search Alone Fails

Vector search treats a codebase as a bag of embedded chunks. That fails in
three structural ways:

- **Missing structure.** Embeddings capture what code _says_, not how it
  _connects_. `LoginController.handle` and `AuthService.login` may sit far
  apart in embedding space (different vocabulary, different style) while
  being one call apart in reality. The similarity metric has no notion of
  "calls," "implements," or "is imported by."
- **Disconnected context.** Top-k chunks arrive as islands. The agent gets
  fragment A from one file and fragment C from another with no indication
  that B — the type they share, the base class between them — exists. Every
  relationship must be re-inferred inside the context window, at token cost
  and error risk.
- **Poor architectural understanding.** Cosine similarity cannot tell an
  entrypoint from a test fixture, a load-bearing core module from a
  generated artifact. Nothing in a vector index encodes "this file is
  imported by half the repo" — precisely the information a senior engineer
  uses to decide where to look first.

## Why Graph Search Alone Fails

Pure structural traversal fails from the opposite direction:

- **Noisy expansion.** From any seed, most neighbors are irrelevant to the
  _question_. A file's import list includes loggers, utilities, and config —
  edges exist, relevance does not. Structure without semantics cannot rank.
- **Graph explosion.** Real repositories contain hub nodes — barrel
  `index.ts` files, god utility modules — with hundreds of edges. Naive BFS
  reaches half the repository within two or three hops; the candidate set
  grows exponentially while precision collapses.
- **Lack of semantic understanding.** A graph cannot process the query "how
  does authentication work?" at all. It has no entry point: you cannot
  traverse toward a concept, only from a node. Graph search needs something
  else to find the seeds.

## Why Hybrid Search Wins

The failure modes are complementary, so the fix is composition:

- **Lexical retrieval (BM25)** anchors precision: exact identifiers, error
  strings, file names. When the user says `AuthService`, nothing beats an
  exact match. It is also free — no API, no model.
- **Semantic retrieval (embeddings)** bridges vocabulary: "login flow"
  matches `authenticate()` and `SessionToken`. It finds seeds that lexical
  search cannot see.
- **Structural retrieval (graph traversal)** completes the picture: from
  strong lexical/semantic seeds it walks calls, imports, inheritance, and
  composition — guarded by depth limits, traversal budgets, score decay, and
  hub damping — surfacing the callers, callees, and contracts that _no_ text
  method can find, because they share neither words nor embeddings with the
  query.

Text stages find the entry points; the graph explains the neighborhood; the
ranker weighs both against corpus-level evidence (centrality, importance,
git activity); the assembler compresses the result under the token budget.
Recall from semantics, precision from lexical matching, connectedness from
structure — that is the hybrid bet, and it is the entire design of AGContext.

## Design Principles

1. **Structure is signal.** The call graph and import graph carry
   information no text index has. Use it everywhere: retrieval, ranking,
   recommendations.
2. **Works with zero keys.** Offline-first: local deterministic embeddings,
   local BM25, local graph. API providers upgrade quality; they are never
   required.
3. **Deterministic by default.** Same repository + same query = byte-identical
   output. Agents, caches, and tests all depend on it.
4. **Token budgets are contracts.** The assembler never exceeds its budget;
   density comes from choosing representations (full → compressed → mention),
   not from truncating mid-thought.
5. **Fail soft, degrade gracefully.** No git? Drop the git signals. Embedding
   API down? Lexical + graph still deliver. Every subsystem is optional
   except the graph.
6. **Provider-agnostic via dependency inversion.** The pipeline depends on an
   `LLMProvider` interface; adapters are configuration.
7. **Open for extension.** Analyzers, signals, summarizers, providers, and
   lifecycle hooks are all plugin surfaces.
8. **Latency is a feature.** Warm retrieval in under 500 ms on indexed
   repositories, or agents will not call it in their inner loop.

## Success Metrics

Retrieval quality (measured against repositories with hand-labeled
"gold context" for realistic tasks):

- **Recall@20** — fraction of gold files/symbols present in the top 20
  retrieved nodes. Target: >= 0.85, and >= 15 points over BM25-only and
  embedding-only baselines.
- **Precision@10** — fraction of the top 10 that is gold-relevant.
  Target: >= 0.6.
- **Context density** — gold-relevant tokens / total tokens in the assembled
  package. Target: >= 2x the naive "top-k full files" baseline.

System performance:

- **Warm retrieval latency** — p95 < 500 ms on indexed repos up to ~5k files
  (local embeddings; remote embedding adds one API round-trip).
- **Incremental index time** — proportional to changed files, not repo size;
  no-op re-index < 5 s on a 5k-file repository.

Downstream and adoption:

- **Agent task success uplift** — pass-rate delta on SWE-bench-style tasks
  with AGContext context vs. grep-only context for the same agent and model.
- **Adoption** — npm downloads, GitHub stars, and integrations (MCP server,
  editor extensions) tracked on the public roadmap.
