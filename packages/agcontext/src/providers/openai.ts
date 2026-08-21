import { ProviderError } from "../core/errors.js";
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

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
  usage?: { prompt_tokens?: number };
  model?: string;
}

export const OPENAI_DEFAULT_GENERATE_MODEL = "gpt-4o-mini";
export const OPENAI_DEFAULT_EMBED_MODEL = "text-embedding-3-small";

/** OpenAI adapter (Chat Completions + Embeddings). */
export class OpenAIProvider implements LLMProvider {
  readonly name: string = "openai";
  readonly capabilities: ProviderCapabilities = { generate: true, embed: true };
  readonly embedModel: string;

  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly generateModel: string;
  protected readonly timeoutMs: number;
  protected readonly fetchFn: typeof fetch | undefined;

  constructor(init: ProviderInit) {
    if (!init.apiKey) {
      throw new ProviderError("openai", "Missing API key (set OPENAI_API_KEY).");
    }
    this.apiKey = init.apiKey;
    this.baseUrl = (init.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.generateModel = init.generateModel ?? OPENAI_DEFAULT_GENERATE_MODEL;
    this.embedModel = init.embedModel ?? OPENAI_DEFAULT_EMBED_MODEL;
    this.timeoutMs = init.timeoutMs ?? 60_000;
    this.fetchFn = init.fetchFn;
  }

  protected headers(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const response = await postJson<ChatCompletionResponse>({
      provider: this.name,
      url: `${this.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: {
        model: this.generateModel,
        messages,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0,
      },
      timeoutMs: this.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });

    const text = response.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new ProviderError(this.name, "Response contained no message content.");
    }
    return {
      text,
      model: response.model ?? this.generateModel,
      usage: {
        ...(response.usage?.prompt_tokens !== undefined
          ? { inputTokens: response.usage.prompt_tokens }
          : {}),
        ...(response.usage?.completion_tokens !== undefined
          ? { outputTokens: response.usage.completion_tokens }
          : {}),
      },
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const response = await postJson<EmbeddingsResponse>({
      provider: this.name,
      url: `${this.baseUrl}/embeddings`,
      headers: this.headers(),
      body: { model: this.embedModel, input: request.texts },
      timeoutMs: this.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });

    const data = response.data;
    if (!data || data.length !== request.texts.length) {
      throw new ProviderError(
        this.name,
        `Expected ${request.texts.length} embeddings, got ${data?.length ?? 0}.`,
      );
    }
    const vectors = data.map((entry, i) => {
      if (!entry.embedding) {
        throw new ProviderError(this.name, `Embedding ${i} missing from response.`);
      }
      return Float32Array.from(entry.embedding);
    });
    const dim = vectors[0]?.length ?? 0;
    return {
      vectors,
      model: response.model ?? this.embedModel,
      dim,
      usage: {
        ...(response.usage?.prompt_tokens !== undefined
          ? { inputTokens: response.usage.prompt_tokens }
          : {}),
      },
    };
  }
}
