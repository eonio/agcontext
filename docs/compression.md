# Repository Compression and Context Assembly

Phases 9 (compression) and 11 (context builder): reduce token consumption
while preserving relevance, then package the result deterministically.

## Compression structures (phase 9)

**File Summary** — the Repomix-inspired compressed view: imports, re-export
surface, JSDoc first lines, and every signature with bodies elided. Typically
5-15x fewer tokens than the source while keeping everything an agent needs to
navigate:

```ts
// src/auth/auth-service.ts — compressed view (32 lines)
import { UserRepository } from "../users/user-repository.js";
import { verifyPassword } from "../utils/crypto.js";
import { signToken, TokenPayload as TokenPayload } from "./token.js";

/** Handles user authentication: credential verification and session token issuing. */
export class AuthService {
  /** Authenticates a user by email and password, returning a session token. */
  async login(email: string, password: string): Promise<AuthResult | undefined>;
  private issueToken(userId: string): string;
}

// exports: AuthResult, AuthService
```

**Symbol Summary** — a one-symbol card: kind, name, location, signature,
doc, and relation notes (`called by LoginController.handle`, `extends
BaseRepository`).

**Architecture Summary** — deterministic bullets from the repository report:
identity, language mix, detected stack, structural patterns, directory
layout with roles, entrypoints, and the most central files.

**Dependency Summary** — for the _selected_ files only: the import edges
among them ("how the pieces you are looking at connect") and the external
packages they lean on.

## Context builder (phase 11)

Input: the ranked node list. Output:

```ts
{
  summary: string,          // one-paragraph framing (template, no LLM needed)
  architecture: string[],   // architecture + dependency bullets
  files: ContextFile[],     // full | compressed | mention
  symbols: ContextSymbol[], // cards, optionally carrying full source
  recommendations: string[] // graph-driven next steps
}
```

### Token awareness

An injectable `TokenCounter` prices every piece (default heuristic:
~3.6 chars/token, deliberately slightly over-estimating so budgets never
overflow; swap in a real tokenizer via `AGContextOptions.tokenCounter`).
A reserve (25%, capped at 3000 tokens) covers summary/architecture/
dependency/recommendation sections; ranked content greedily consumes the
rest. **The budget is a contract — `tokens.used <= tokens.budget`, always.**

### The representation ladder (density maximization)

Walking the ranked list in order, each node gets the _richest representation
that fits_:

- **File nodes:** full source (if within `maxFileTokens` and remaining
  budget) → compressed file summary → one-line mention.
- **Symbol nodes:** card + full source slice (within `maxSymbolTokens`) →
  card with signature/doc/relations only → skipped.

### Redundancy removal

- A file included in full swallows its symbols — no duplicate cards.
- An included class card swallows its methods (container-id check).
- Once symbol-level code from a file is in, a later file-level inclusion
  degrades to the compressed view rather than duplicating the source.

### Recommendations

Pure graph queries, no LLM: where to start (top-ranked node), call sites
that did _not_ make the budget ("`AuthService` is called by
`LoginController` (src/http/login-controller.ts) — not included here"),
inheritance notes, tests that import the included files, and barrel-surface
warnings. Capped, deduplicated, deterministic.

### Determinism

Stable input order (ranking tie-breaks on id), stable trimming, no
wall-clock values in output (`meta.indexedAt` comes from the index, not
"now"). Identical inputs produce byte-identical packages — asserted in the
test suite.

## Renderers

- `markdown` — headed sections with fenced code, for humans and most agents.
- `xml` — attribute-escaped tags with CDATA-wrapped code (including
  `]]>`-safe splitting), for models that respond well to tagged context.
- `json` — the raw `ContextPackage`, for programmatic consumers.

`agc context "query" --format xml` or `format` in config /
`ContextOptions`.
