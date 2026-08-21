import { ConfigError } from "../core/errors.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { AnthropicProvider } from "./anthropic.js";
import { AzureOpenAIProvider } from "./azure-openai.js";
import { GoogleProvider } from "./google.js";
import { LocalProvider } from "./local.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { processEnv, type LLMProvider, type ProviderEnv } from "./types.js";

export interface DetectedProvider {
  name: string;
  envVar: string;
  configured: boolean;
  capabilities: { generate: boolean; embed: boolean };
  detail?: string;
}

/** Auto-selection order for generation: quality-first among configured keys. */
const GENERATE_ORDER = ["anthropic", "openai", "azure", "google", "openrouter"] as const;
/** Auto-selection order for embeddings (embed-capable APIs only). */
const EMBED_ORDER = ["openai", "azure", "google"] as const;

/**
 * Creates and resolves providers from configuration and environment, and
 * accepts custom providers registered by ProviderPlugins. Uses dependency
 * inversion end to end: the pipeline sees only {@link LLMProvider}.
 */
export class ProviderRegistry {
  private readonly custom = new Map<string, LLMProvider>();

  constructor(private readonly env: ProviderEnv = processEnv) {}

  /** Blank env values (e.g. `OPENAI_API_KEY=` in a .env file) count as absent. */
  private envValue(name: string): string | undefined {
    const value = this.env.get(name);
    return value !== undefined && value.trim().length > 0 ? value : undefined;
  }

  /** Registers a plugin-supplied provider, addressable via config `provider: "<name>"`. */
  register(provider: LLMProvider): void {
    if (this.custom.has(provider.name)) {
      throw new ConfigError(`A provider named "${provider.name}" is already registered.`);
    }
    this.custom.set(provider.name, provider);
  }

  registered(): readonly LLMProvider[] {
    return [...this.custom.values()];
  }

  /** Reports which providers are configured in the environment (for doctor/init). */
  detect(): DetectedProvider[] {
    const azureConfigured =
      this.envValue("AZURE_OPENAI_API_KEY") !== undefined &&
      this.envValue("AZURE_OPENAI_ENDPOINT") !== undefined;
    const rows: DetectedProvider[] = [
      {
        name: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        configured: this.envValue("ANTHROPIC_API_KEY") !== undefined,
        capabilities: { generate: true, embed: false },
      },
      {
        name: "openai",
        envVar: "OPENAI_API_KEY",
        configured: this.envValue("OPENAI_API_KEY") !== undefined,
        capabilities: { generate: true, embed: true },
      },
      {
        name: "azure",
        envVar: "AZURE_OPENAI_API_KEY",
        configured: azureConfigured,
        capabilities: { generate: true, embed: true },
        ...(this.envValue("AZURE_OPENAI_API_KEY") && !azureConfigured
          ? { detail: "AZURE_OPENAI_ENDPOINT is also required" }
          : {}),
      },
      {
        name: "google",
        envVar: "GOOGLE_API_KEY",
        configured: this.envValue("GOOGLE_API_KEY") !== undefined,
        capabilities: { generate: true, embed: true },
      },
      {
        name: "openrouter",
        envVar: "OPENROUTER_API_KEY",
        configured: this.envValue("OPENROUTER_API_KEY") !== undefined,
        capabilities: { generate: true, embed: false },
      },
      {
        name: "local",
        envVar: "(none)",
        configured: true,
        capabilities: { generate: false, embed: true },
      },
    ];
    for (const provider of this.custom.values()) {
      rows.push({
        name: provider.name,
        envVar: "(plugin)",
        configured: true,
        capabilities: provider.capabilities,
      });
    }
    return rows;
  }

  /** Instantiates a provider by name; throws {@link ConfigError} for unknown names. */
  create(name: string, config: ResolvedConfig): LLMProvider {
    const registered = this.custom.get(name);
    if (registered) return registered;

    const init = {
      ...(config.models.generate !== undefined ? { generateModel: config.models.generate } : {}),
      ...(config.models.embed !== undefined ? { embedModel: config.models.embed } : {}),
    };
    switch (name) {
      case "local":
        return new LocalProvider();
      case "openai":
        return new OpenAIProvider({ ...init, apiKey: this.envValue("OPENAI_API_KEY") ?? "" });
      case "anthropic":
        return new AnthropicProvider({ ...init, apiKey: this.envValue("ANTHROPIC_API_KEY") ?? "" });
      case "azure":
        return new AzureOpenAIProvider({
          ...init,
          apiKey: this.envValue("AZURE_OPENAI_API_KEY") ?? "",
          ...(this.envValue("AZURE_OPENAI_ENDPOINT")
            ? { endpoint: this.envValue("AZURE_OPENAI_ENDPOINT") as string }
            : {}),
          ...(this.envValue("AZURE_OPENAI_DEPLOYMENT")
            ? { deployment: this.envValue("AZURE_OPENAI_DEPLOYMENT") as string }
            : {}),
          ...(this.envValue("AZURE_OPENAI_EMBED_DEPLOYMENT")
            ? { embedDeployment: this.envValue("AZURE_OPENAI_EMBED_DEPLOYMENT") as string }
            : {}),
          ...(this.envValue("AZURE_OPENAI_API_VERSION")
            ? { apiVersion: this.envValue("AZURE_OPENAI_API_VERSION") as string }
            : {}),
        });
      case "google":
        return new GoogleProvider({ ...init, apiKey: this.envValue("GOOGLE_API_KEY") ?? "" });
      case "openrouter":
        return new OpenRouterProvider({
          ...init,
          apiKey: this.envValue("OPENROUTER_API_KEY") ?? "",
        });
      default:
        throw new ConfigError(
          `Unknown provider "${name}". Built-ins: openai, anthropic, azure, google, openrouter, local.`,
        );
    }
  }

  /**
   * Resolves the generation provider. `auto` picks the first configured key
   * in quality order; returns `undefined` when nothing is configured
   * (generation features are optional — the core pipeline never requires it).
   */
  resolveGenerate(config: ResolvedConfig): LLMProvider | undefined {
    if (config.provider !== "auto") {
      return this.create(config.provider, config);
    }
    for (const name of GENERATE_ORDER) {
      if (this.isConfigured(name)) return this.create(name, config);
    }
    return undefined;
  }

  /**
   * Resolves the embedding provider. `auto` picks the first embed-capable
   * configured key, falling back to the offline `local` provider so semantic
   * retrieval always works. Explicitly selecting an embed-incapable provider
   * fails fast with a clear error.
   */
  resolveEmbed(config: ResolvedConfig): LLMProvider {
    if (config.embeddingProvider !== "auto") {
      const provider = this.create(config.embeddingProvider, config);
      if (!provider.capabilities.embed) {
        throw new ConfigError(
          `Provider "${provider.name}" cannot embed. Use openai, azure, google, local, or an embed-capable plugin provider.`,
        );
      }
      return provider;
    }
    for (const name of EMBED_ORDER) {
      if (this.isConfigured(name)) return this.create(name, config);
    }
    return new LocalProvider();
  }

  private isConfigured(name: (typeof GENERATE_ORDER)[number]): boolean {
    switch (name) {
      case "anthropic":
        return this.envValue("ANTHROPIC_API_KEY") !== undefined;
      case "openai":
        return this.envValue("OPENAI_API_KEY") !== undefined;
      case "azure":
        return (
          this.envValue("AZURE_OPENAI_API_KEY") !== undefined &&
          this.envValue("AZURE_OPENAI_ENDPOINT") !== undefined
        );
      case "google":
        return this.envValue("GOOGLE_API_KEY") !== undefined;
      case "openrouter":
        return this.envValue("OPENROUTER_API_KEY") !== undefined;
    }
  }
}
