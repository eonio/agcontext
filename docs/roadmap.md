# Roadmap

Priorities are ordered by leverage: each item multiplies the value of the
core engine for a new surface area.

## P0 — MCP Server (`@eonio/agcontext-mcp`)

The highest-leverage integration: one Model Context Protocol server makes
AGContext available to Claude Code, Cursor, Cline, and every MCP-capable
agent without per-editor work.

Exposed tools:

```text
retrieve_context   (query, limit?, strategy?)      → ranked nodes + snippets
expand_graph       (nodeId, depth?, budget?)       → neighborhood with scores
search_code        (query, limit?)                 → fast lexical hits
get_architecture   ()                              → repository report + summary
rank_nodes         (nodeIds[], query)              → multi-signal scores
```

plus `assemble_context(query, maxTokens, format)` returning the full
package. Design notes: a long-lived server process keeps the snapshot warm
(sub-100 ms tool calls), watches the filesystem to trigger incremental
re-index, and enforces per-call token budgets. Ships as a new workspace
package reusing the facade unchanged — the monorepo layout exists for
exactly this.

## P1 — VS Code Extension

- Status bar: index freshness + one-click re-index.
- "Explain symbol" and "Assemble context" code actions feeding any
  chat/agent extension via commands.
- A context view: for the current selection, show what AGContext would
  retrieve (files, symbols, scores) — making retrieval quality visible and
  debuggable.
- Bundles the MCP server so agent extensions get AGContext for free.

## P1 — GitHub Copilot Integration

Copilot Extensions/agent integration: register AGContext as a context
provider so Copilot Chat queries pull hybrid-retrieved, graph-aware context
instead of open-tabs heuristics. The `contextText(query, { format: "xml" })`
API is already shaped for this.

## P2 — Multi-Repository Support

One AGContext workspace spanning N repositories: per-repo graphs joined by
cross-repo import edges (package name → owning repo), namespaced node ids
(`repo-name!file:src/x.ts`), federated retrieval with per-repo budget
allocation, and a merged ranking pass. Unlocks service-oriented codebases
where the answer spans the API client in one repo and the handler in
another.

## P2 — Team Knowledge Graph

Layer human knowledge onto the code graph: ownership from git history
(already computed) enriched with CODEOWNERS, PR review relationships, ADR
and doc links as first-class nodes, and incident/ticket annotations via
plugins. Retrieval then answers "who knows this code?" and "what decisions
shaped it?" alongside "what is it connected to?".

## P3 — Agent Memory

Persistent, per-repository memory for agents built on AGContext:

- **Episodic**: which contexts were served for which tasks, and which files
  the agent actually edited afterward — a feedback signal for ranking
  weights (learning-to-rank on your own repo).
- **Semantic**: agent- or human-authored notes pinned to graph nodes
  ("this module is deprecated, prefer X"), retrieved alongside code.
- Storage in `.agcontext/memory/` with the same versioned-store discipline;
  exposed through the plugin signal interface so memory boosts ranking
  without touching the core.

## Continuous investments

- Language analyzers beyond TS/JS (Python first) via the `SourceAnalyzer`
  plugin surface.
- Type-checker-backed resolution as an opt-in high-accuracy mode.
- Retrieval quality benchmark suite with published recall/precision numbers
  per release.
