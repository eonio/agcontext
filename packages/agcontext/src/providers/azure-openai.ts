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

export interface AzureProviderInit extends ProviderInit {
  /** e.g. https://my-resource.openai.azure.com */
  endpoint?: string;
  /** Chat deployment name (AZURE_OPENAI_DEPLOYMENT). */
  deployment?: string;
  /** Embeddings deployment name (AZURE_OPENAI_EMBED_DEPLOYMENT). */
  embedDeployment?: string;
  apiVersion?: string;
}

export const AZURE_DEFAULT_API_VERSION = "2024-10-21";

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

/**
 * Azure OpenAI adapter. The wire format matches OpenAI, but URLs are scoped
 * per deployment and authentication uses the `api-key` header.
 */
export class AzureOpenAIProvider implements LLMProvider {
  readonly name = "azure";
  readonly capabilities: ProviderCapabilities = { generate: true, embed: true };
  readonly embedModel: string;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly deployment: string | undefined;
  private readonly embedDeployment: string | undefined;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(init: AzureProviderInit) {
    if (!init.apiKey) {
      throw new ProviderError("azure", "Missing API key (set AZURE_OPENAI_API_KEY).");
    }
    if (!init.endpoint) {
      throw new ProviderError("azure", "Missing endpoint (set AZURE_OPENAI_ENDPOINT).");
    }
    this.apiKey = init.apiKey;
    this.endpoint = init.endpoint.replace(/\/$/, "");
    this.deployment = init.deployment;
    this.embedDeployment = init.embedDeployment;
    this.apiVersion = init.apiVersion ?? AZURE_DEFAULT_API_VERSION;
    this.embedModel = `azure:${init.embedDeployment ?? "unset"}`;
    this.timeoutMs = init.timeoutMs ?? 60_000;
    this.fetchFn = init.fetchFn;
  }

  private url(deployment: string, route: string): string {
    return `${this.endpoint}/openai/deployments/${deployment}/${route}?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (!this.deployment) {
      throw new ProviderError("azure", "Missing chat deployment (set AZURE_OPENAI_DEPLOYMENT).");
    }
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const response = await postJson<ChatCompletionResponse>({
      provider: this.name,
      url: this.url(this.deployment, "chat/completions"),
      headers: { "api-key": this.apiKey },
      body: {
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
      model: response.model ?? this.deployment,
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
    if (!this.embedDeployment) {
      throw new ProviderError(
        "azure",
        "Missing embeddings deployment (set AZURE_OPENAI_EMBED_DEPLOYMENT).",
      );
    }
    const response = await postJson<EmbeddingsResponse>({
      provider: this.name,
      url: this.url(this.embedDeployment, "embeddings"),
      headers: { "api-key": this.apiKey },
      body: { input: request.texts },
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
    return {
      vectors,
      model: response.model ?? this.embedModel,
      dim: vectors[0]?.length ?? 0,
      usage: {
        ...(response.usage?.prompt_tokens !== undefined
          ? { inputTokens: response.usage.prompt_tokens }
          : {}),
      },
    };
  }
}
