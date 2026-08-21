import { ProviderCapabilityError, ProviderError } from "../core/errors.js";
import { postJson } from "./http.js";
import type {
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
  ProviderCapabilities,
  ProviderInit,
} from "./types.js";

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

export const ANTHROPIC_DEFAULT_GENERATE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Anthropic adapter (Messages API). Anthropic does not offer an embeddings
 * endpoint, so `embed()` throws a capability error; pair this provider with
 * an embedding-capable one (openai/azure/google) or the offline `local`
 * provider — the registry does exactly that under `embeddingProvider: "auto"`.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly capabilities: ProviderCapabilities = { generate: true, embed: false };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly generateModel: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(init: ProviderInit) {
    if (!init.apiKey) {
      throw new ProviderError("anthropic", "Missing API key (set ANTHROPIC_API_KEY).");
    }
    this.apiKey = init.apiKey;
    this.baseUrl = (init.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.generateModel = init.generateModel ?? ANTHROPIC_DEFAULT_GENERATE_MODEL;
    this.timeoutMs = init.timeoutMs ?? 60_000;
    this.fetchFn = init.fetchFn;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await postJson<MessagesResponse>({
      provider: this.name,
      url: `${this.baseUrl}/v1/messages`,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: this.generateModel,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0,
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: "user", content: request.prompt }],
      },
      timeoutMs: this.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });

    const text = (response.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    if (text.length === 0) {
      throw new ProviderError(this.name, "Response contained no text content.");
    }
    return {
      text,
      model: response.model ?? this.generateModel,
      usage: {
        ...(response.usage?.input_tokens !== undefined
          ? { inputTokens: response.usage.input_tokens }
          : {}),
        ...(response.usage?.output_tokens !== undefined
          ? { outputTokens: response.usage.output_tokens }
          : {}),
      },
    };
  }

  embed(_request: EmbedRequest): Promise<EmbedResult> {
    return Promise.reject(
      new ProviderCapabilityError(
        this.name,
        "embed",
        'Anthropic has no embeddings API. Use embeddingProvider: "openai" | "google" | "azure" | "local".',
      ),
    );
  }
}
