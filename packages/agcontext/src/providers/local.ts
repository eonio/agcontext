import { ProviderCapabilityError } from "../core/errors.js";
import { fnv1a32 } from "../core/hash.js";
import { tokenize } from "../core/text.js";
import type {
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
  ProviderCapabilities,
} from "./types.js";

export const LOCAL_EMBED_DIM = 256;
export const LOCAL_EMBED_MODEL = "agc-local-hash-v1";

/**
 * Offline, deterministic embedding provider using signed feature hashing over
 * code-aware tokens. Zero API keys, zero network, identical vectors across
 * machines — so semantic retrieval works out of the box and CI stays hermetic.
 * Quality is below API embedding models (it captures identifier/term overlap,
 * not deep semantics), which is the documented trade-off; configure a remote
 * `embeddingProvider` for the best results.
 */
export class LocalProvider implements LLMProvider {
  readonly name = "local";
  readonly capabilities: ProviderCapabilities = { generate: false, embed: true };
  readonly embedModel = LOCAL_EMBED_MODEL;

  generate(_request: GenerateRequest): Promise<GenerateResult> {
    return Promise.reject(
      new ProviderCapabilityError(
        this.name,
        "generate",
        "Configure a generation provider (e.g. ANTHROPIC_API_KEY or OPENAI_API_KEY).",
      ),
    );
  }

  embed(request: EmbedRequest): Promise<EmbedResult> {
    const vectors = request.texts.map((text) => embedText(text));
    return Promise.resolve({
      vectors,
      model: LOCAL_EMBED_MODEL,
      dim: LOCAL_EMBED_DIM,
    });
  }
}

function embedText(text: string): Float32Array {
  const vector = new Float32Array(LOCAL_EMBED_DIM);
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, tf] of counts) {
    const hash = fnv1a32(token);
    const index = hash % LOCAL_EMBED_DIM;
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    vector[index] = (vector[index] as number) + sign * (1 + Math.log(tf));
  }
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += (vector[i] as number) ** 2;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] as number) / norm;
  }
  return vector;
}
