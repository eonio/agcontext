import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/resolve.js";
import { ConfigError } from "../../src/core/errors.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type {
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
  ProviderEnv,
} from "../../src/providers/types.js";

function env(values: Record<string, string>): ProviderEnv {
  return { get: (name) => values[name] };
}

function config(overrides: Record<string, unknown> = {}) {
  return resolveConfig({ cwd: process.cwd(), overrides });
}

const customProvider: LLMProvider = {
  name: "acme",
  capabilities: { generate: true, embed: true },
  embedModel: "acme-embed-1",
  generate: (_request: GenerateRequest): Promise<GenerateResult> =>
    Promise.resolve({ text: "acme", model: "acme-1" }),
  embed: (request: EmbedRequest): Promise<EmbedResult> =>
    Promise.resolve({
      vectors: request.texts.map(() => Float32Array.from([1, 0])),
      model: "acme-embed-1",
      dim: 2,
    }),
};

describe("ProviderRegistry", () => {
  it("detects configured providers from the environment", () => {
    const registry = new ProviderRegistry(
      env({ OPENAI_API_KEY: "sk", AZURE_OPENAI_API_KEY: "az" }),
    );
    const rows = Object.fromEntries(registry.detect().map((row) => [row.name, row.configured]));
    expect(rows["openai"]).toBe(true);
    expect(rows["anthropic"]).toBe(false);
    // Azure needs the endpoint too.
    expect(rows["azure"]).toBe(false);
    expect(rows["local"]).toBe(true);
  });

  it("treats blank env values as absent", () => {
    const registry = new ProviderRegistry(env({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "   " }));
    const rows = Object.fromEntries(registry.detect().map((row) => [row.name, row.configured]));
    expect(rows["anthropic"]).toBe(false);
    expect(rows["openai"]).toBe(false);
    expect(registry.resolveGenerate(config())).toBeUndefined();
    expect(registry.resolveEmbed(config()).name).toBe("local");
  });

  it("auto-resolves generation in quality order", () => {
    const both = new ProviderRegistry(env({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }));
    expect(both.resolveGenerate(config())?.name).toBe("anthropic");

    const openaiOnly = new ProviderRegistry(env({ OPENAI_API_KEY: "o" }));
    expect(openaiOnly.resolveGenerate(config())?.name).toBe("openai");

    const none = new ProviderRegistry(env({}));
    expect(none.resolveGenerate(config())).toBeUndefined();
  });

  it("auto-resolves embeddings with a local fallback", () => {
    const withOpenAI = new ProviderRegistry(env({ OPENAI_API_KEY: "o" }));
    expect(withOpenAI.resolveEmbed(config()).name).toBe("openai");

    const anthropicOnly = new ProviderRegistry(env({ ANTHROPIC_API_KEY: "a" }));
    expect(anthropicOnly.resolveEmbed(config()).name).toBe("local");
  });

  it("fails fast when an explicit embed provider cannot embed", () => {
    const registry = new ProviderRegistry(env({ ANTHROPIC_API_KEY: "a" }));
    expect(() => registry.resolveEmbed(config({ embeddingProvider: "anthropic" }))).toThrow(
      ConfigError,
    );
  });

  it("honors explicit provider selection and model overrides", () => {
    const registry = new ProviderRegistry(env({ OPENAI_API_KEY: "o" }));
    const provider = registry.resolveEmbed(
      config({ embeddingProvider: "openai", models: { embed: "text-embedding-3-large" } }),
    );
    expect(provider.name).toBe("openai");
    expect(provider.embedModel).toBe("text-embedding-3-large");
  });

  it("rejects unknown provider names", () => {
    const registry = new ProviderRegistry(env({}));
    expect(() => registry.create("nope", config())).toThrow(ConfigError);
  });

  it("registers plugin providers addressable by name", () => {
    const registry = new ProviderRegistry(env({}));
    registry.register(customProvider);
    expect(registry.create("acme", config()).name).toBe("acme");
    expect(registry.resolveGenerate(config({ provider: "acme" }))?.name).toBe("acme");
    expect(registry.resolveEmbed(config({ embeddingProvider: "acme" })).name).toBe("acme");
    expect(() => registry.register(customProvider)).toThrow(ConfigError);
  });
});
