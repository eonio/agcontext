/**
 * Typed error hierarchy. Every error thrown by AGContext is an
 * {@link AGContextError} with a stable `code` so callers can branch
 * programmatically instead of parsing messages.
 */

export type ErrorCode =
  | "CONFIG"
  | "INDEX"
  | "NOT_INDEXED"
  | "PROVIDER"
  | "PROVIDER_CAPABILITY"
  | "PLUGIN"
  | "NODE_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "CACHE";

export class AGContextError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends AGContextError {
  constructor(message: string, cause?: unknown) {
    super("CONFIG", message, { cause });
  }
}

export class IndexError extends AGContextError {
  constructor(message: string, cause?: unknown) {
    super("INDEX", message, { cause });
  }
}

export class NotIndexedError extends AGContextError {
  constructor(root: string) {
    super(
      "NOT_INDEXED",
      `No AGContext index found for "${root}". Run "agc index" (or AGContext.index()) first.`,
    );
  }
}

export class CacheError extends AGContextError {
  constructor(message: string, cause?: unknown) {
    super("CACHE", message, { cause });
  }
}

export interface ProviderErrorOptions {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

export class ProviderError extends AGContextError {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(provider: string, message: string, options: ProviderErrorOptions = {}) {
    super("PROVIDER", `[${provider}] ${message}`, { cause: options.cause });
    this.provider = provider;
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export class ProviderCapabilityError extends AGContextError {
  readonly provider: string;
  readonly capability: "generate" | "embed";

  constructor(provider: string, capability: "generate" | "embed", hint?: string) {
    super(
      "PROVIDER_CAPABILITY",
      `Provider "${provider}" does not support ${capability}().${hint ? ` ${hint}` : ""}`,
    );
    this.provider = provider;
    this.capability = capability;
  }
}

export class PluginError extends AGContextError {
  readonly plugin: string;

  constructor(plugin: string, message: string, cause?: unknown) {
    super("PLUGIN", `[plugin:${plugin}] ${message}`, { cause });
    this.plugin = plugin;
  }
}

export class NodeNotFoundError extends AGContextError {
  readonly target: string;

  constructor(target: string) {
    super("NODE_NOT_FOUND", `No graph node matches "${target}".`);
    this.target = target;
  }
}

export class AmbiguousTargetError extends AGContextError {
  readonly target: string;
  readonly matches: string[];

  constructor(target: string, matches: string[]) {
    super(
      "AMBIGUOUS_TARGET",
      `"${target}" matches ${matches.length} nodes. Be more specific:\n  ${matches.join("\n  ")}`,
    );
    this.target = target;
    this.matches = matches;
  }
}
