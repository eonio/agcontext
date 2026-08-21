/**
 * Provider abstraction (phase 12). AGContext is provider-agnostic: the core
 * pipeline depends only on this interface (dependency inversion), and concrete
 * adapters are selected by configuration or environment at composition time.
 */

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: TokenUsage;
}

export interface EmbedRequest {
  texts: string[];
  signal?: AbortSignal;
}

export interface EmbedResult {
  vectors: Float32Array[];
  model: string;
  dim: number;
  usage?: TokenUsage;
}

export interface ProviderCapabilities {
  generate: boolean;
  embed: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** Model id used by embed(); part of the embedding cache key. */
  readonly embedModel?: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
}

/** Common adapter wiring; every field injectable for tests. */
export interface ProviderInit {
  apiKey?: string;
  baseUrl?: string;
  generateModel?: string;
  embedModel?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** Read-only environment access, injectable so provider detection is testable. */
export interface ProviderEnv {
  get(name: string): string | undefined;
}

export const processEnv: ProviderEnv = {
  get: (name) => process.env[name],
};
