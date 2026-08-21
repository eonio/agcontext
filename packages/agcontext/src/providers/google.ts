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

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

interface BatchEmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

export const GOOGLE_DEFAULT_GENERATE_MODEL = "gemini-2.0-flash";
export const GOOGLE_DEFAULT_EMBED_MODEL = "text-embedding-004";

/**
 * Google Gemini adapter (Generative Language API). The API key travels in the
 * `x-goog-api-key` header — never in the URL.
 */
export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  readonly capabilities: ProviderCapabilities = { generate: true, embed: true };
  readonly embedModel: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly generateModel: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(init: ProviderInit) {
    if (!init.apiKey) {
      throw new ProviderError("google", "Missing API key (set GOOGLE_API_KEY).");
    }
    this.apiKey = init.apiKey;
    this.baseUrl = (init.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      "",
    );
    this.generateModel = init.generateModel ?? GOOGLE_DEFAULT_GENERATE_MODEL;
    this.embedModel = init.embedModel ?? GOOGLE_DEFAULT_EMBED_MODEL;
    this.timeoutMs = init.timeoutMs ?? 60_000;
    this.fetchFn = init.fetchFn;
  }

  private headers(): Record<string, string> {
    return { "x-goog-api-key": this.apiKey };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await postJson<GenerateContentResponse>({
      provider: this.name,
      url: `${this.baseUrl}/models/${this.generateModel}:generateContent`,
      headers: this.headers(),
      body: {
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0,
        },
      },
      timeoutMs: this.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });

    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (text.length === 0) {
      throw new ProviderError(this.name, "Response contained no text content.");
    }
    return {
      text,
      model: response.modelVersion ?? this.generateModel,
      usage: {
        ...(response.usageMetadata?.promptTokenCount !== undefined
          ? { inputTokens: response.usageMetadata.promptTokenCount }
          : {}),
        ...(response.usageMetadata?.candidatesTokenCount !== undefined
          ? { outputTokens: response.usageMetadata.candidatesTokenCount }
          : {}),
      },
    };
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const model = `models/${this.embedModel}`;
    const response = await postJson<BatchEmbedResponse>({
      provider: this.name,
      url: `${this.baseUrl}/${model}:batchEmbedContents`,
      headers: this.headers(),
      body: {
        requests: request.texts.map((text) => ({
          model,
          content: { parts: [{ text }] },
        })),
      },
      timeoutMs: this.timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });

    const embeddings = response.embeddings;
    if (!embeddings || embeddings.length !== request.texts.length) {
      throw new ProviderError(
        this.name,
        `Expected ${request.texts.length} embeddings, got ${embeddings?.length ?? 0}.`,
      );
    }
    const vectors = embeddings.map((entry, i) => {
      if (!entry.values) {
        throw new ProviderError(this.name, `Embedding ${i} missing from response.`);
      }
      return Float32Array.from(entry.values);
    });
    return {
      vectors,
      model: this.embedModel,
      dim: vectors[0]?.length ?? 0,
    };
  }
}
