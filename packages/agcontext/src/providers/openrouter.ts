import { ProviderCapabilityError } from "../core/errors.js";
import { OpenAIProvider } from "./openai.js";
import type { EmbedRequest, EmbedResult, ProviderCapabilities, ProviderInit } from "./types.js";

export const OPENROUTER_DEFAULT_GENERATE_MODEL = "openrouter/auto";

/**
 * OpenRouter adapter. OpenRouter speaks the OpenAI chat-completions wire
 * format, so this specializes the OpenAI adapter with OpenRouter's base URL.
 * OpenRouter offers no embeddings endpoint; pair it with openai/google/azure
 * or the offline `local` provider for embeddings.
 */
export class OpenRouterProvider extends OpenAIProvider {
  override readonly name: string = "openrouter";
  override readonly capabilities: ProviderCapabilities = { generate: true, embed: false };

  constructor(init: ProviderInit) {
    super({
      ...init,
      baseUrl: init.baseUrl ?? "https://openrouter.ai/api/v1",
      generateModel: init.generateModel ?? OPENROUTER_DEFAULT_GENERATE_MODEL,
    });
  }

  override embed(_request: EmbedRequest): Promise<EmbedResult> {
    return Promise.reject(
      new ProviderCapabilityError(
        this.name,
        "embed",
        'OpenRouter has no embeddings API. Use embeddingProvider: "openai" | "google" | "azure" | "local".',
      ),
    );
  }
}
