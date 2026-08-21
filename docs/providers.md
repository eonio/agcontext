# Provider Abstraction Layer

AGContext is provider-agnostic by dependency inversion: the pipeline depends
only on the `LLMProvider` port, and adapters are chosen by configuration and
environment at composition time.

```ts
interface LLMProvider {
  readonly name: string;
  readonly capabilities: { generate: boolean; embed: boolean };
  readonly embedModel?: string; // part of the embedding cache key
  generate(request: GenerateRequest): Promise<GenerateResult>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
}
```

## Built-in adapters

| Provider     | Env                                                              | generate | embed | Default models                            |
| ------------ | ---------------------------------------------------------------- | :------: | :---: | ----------------------------------------- |
| `anthropic`  | `ANTHROPIC_API_KEY`                                              |   yes    |  no¹  | `claude-haiku-4-5-20251001`               |
| `openai`     | `OPENAI_API_KEY`                                                 |   yes    |  yes  | `gpt-4o-mini` / `text-embedding-3-small`  |
| `azure`      | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` (+ deployments) |   yes    |  yes  | your deployments                          |
| `google`     | `GOOGLE_API_KEY`                                                 |   yes    |  yes  | `gemini-2.0-flash` / `text-embedding-004` |
| `openrouter` | `OPENROUTER_API_KEY`                                             |   yes    |  no¹  | `openrouter/auto`                         |
| `local`      | none                                                             |    no    |  yes  | deterministic 256-dim hash embeddings     |

¹ These APIs offer no embeddings endpoint; `embed()` rejects with a
`ProviderCapabilityError` that names working alternatives. Under `auto`
resolution this never surfaces — the registry pairs them with an
embed-capable provider automatically.

## Resolution rules

Generation (`provider: "auto"`): first configured key in quality order
`anthropic → openai → azure → google → openrouter`; none configured →
generation features (only `explain --ai`) are simply unavailable — the core
pipeline never requires generation.

Embeddings (`embeddingProvider: "auto"`): first embed-capable configured key
in `openai → azure → google`; none → the **local provider**, so semantic
retrieval always works offline.

Explicit names always win and fail fast when misconfigured (missing key,
embed-incapable choice). Model overrides: `models: { generate, embed }`.

## The local provider

Signed feature hashing (FNV-1a) over the same code-aware tokens BM25 uses,
L2-normalized, 256 dimensions. Deterministic across machines, zero network,
zero keys — which keeps CI hermetic and makes AGContext useful the moment
it is installed. It captures identifier/term overlap rather than deep
semantics; API embedding providers meaningfully improve semantic recall and
are recommended for production. The embedding index records which
provider/model built it; switching providers flags a re-index instead of
silently mixing vector spaces.

## Engineering properties (all adapters)

- **Keys travel in headers, never URLs** (including Google, via
  `x-goog-api-key`).
- **Retries with exponential backoff** on 408/429/5xx and network errors
  (2 retries default); non-retryable statuses fail immediately with the
  status and a truncated body excerpt — request headers are never echoed.
- **Timeouts** via `AbortSignal.timeout` (60 s default), merged with any
  caller-provided signal.
- **Typed errors**: `ProviderError` (with `status`, `retryable`) and
  `ProviderCapabilityError`.
- **Injectable `fetch`** on every adapter — the whole layer is unit-tested
  against a stub with zero live calls.
- **Usage accounting**: token usage from provider responses feeds telemetry
  when enabled.

## Custom providers

Two ways in:

```ts
// 1. Instance injection (bypasses name resolution)
const agc = new AGContext({ providers: { generate: myLLM, embed: myEmbedder } });

// 2. A ProviderPlugin (addressable by name in config)
const agc = new AGContext({ provider: "acme" }).use({
  name: "acme-provider",
  providers: [acmeProvider], // LLMProvider with name "acme"
});
```
