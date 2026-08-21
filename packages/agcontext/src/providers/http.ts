import { ProviderError } from "../core/errors.js";

export interface HttpJsonOptions {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  /** Retries on 429/5xx/network errors with exponential backoff. */
  retries?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

/**
 * POSTs JSON and returns the parsed JSON response, with timeout, bounded
 * retries, and provider-tagged errors. Response bodies in error messages are
 * truncated; request headers (which carry credentials) are never echoed.
 */
export async function postJson<T>(options: HttpJsonOptions): Promise<T> {
  const { provider, url, headers, body, timeoutMs, signal, fetchFn } = options;
  const retries = options.retries ?? 2;
  const doFetch = fetchFn ?? fetch;
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await delay(Math.min(4000, 300 * 2 ** (attempt - 1)));
    }
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: combineSignals(timeoutMs, signal),
      });
    } catch (error) {
      lastError = new ProviderError(provider, `Request to ${url} failed: ${describe(error)}`, {
        retryable: true,
        cause: error,
      });
      if (signal?.aborted) throw lastError;
      continue;
    }

    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new ProviderError(provider, "Response was not valid JSON", { cause: error });
      }
    }

    const excerpt = truncate(await response.text().catch(() => ""), 300);
    const retryable = RETRYABLE_STATUS.has(response.status);
    lastError = new ProviderError(
      provider,
      `HTTP ${response.status} from ${url}${excerpt ? `: ${excerpt}` : ""}`,
      { status: response.status, retryable },
    );
    if (!retryable) throw lastError;
  }

  throw lastError ?? new ProviderError(provider, `Request to ${url} failed`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
