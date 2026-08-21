import { describe, expect, it } from "vitest";
import { ProviderCapabilityError, ProviderError } from "../../src/core/errors.js";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import { AzureOpenAIProvider } from "../../src/providers/azure-openai.js";
import { GoogleProvider } from "../../src/providers/google.js";
import { postJson } from "../../src/providers/http.js";
import { OpenAIProvider } from "../../src/providers/openai.js";
import { OpenRouterProvider } from "../../src/providers/openrouter.js";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchFn: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
    });
    const next = responses[Math.min(call++, responses.length - 1)] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, requests };
}

describe("postJson", () => {
  it("returns parsed JSON on success", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const result = await postJson<{ ok: boolean }>({
      provider: "test",
      url: "https://api.example.com/v1/x",
      headers: { authorization: "Bearer secret" },
      body: { input: 1 },
      timeoutMs: 5000,
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(requests[0]?.headers["authorization"]).toBe("Bearer secret");
    expect(requests[0]?.body).toEqual({ input: 1 });
  });

  it("retries retryable statuses and succeeds", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 500, body: { error: "transient" } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await postJson<{ ok: boolean }>({
      provider: "test",
      url: "https://api.example.com/v1/x",
      headers: {},
      body: {},
      timeoutMs: 5000,
      retries: 2,
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("does not retry client errors and surfaces status", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 400, body: { error: "bad" } }]);
    const promise = postJson({
      provider: "test",
      url: "https://api.example.com/v1/x",
      headers: {},
      body: {},
      timeoutMs: 5000,
      fetchFn,
    });
    await expect(promise).rejects.toBeInstanceOf(ProviderError);
    await promise.catch((error: unknown) => {
      expect((error as ProviderError).status).toBe(400);
      expect((error as ProviderError).retryable).toBe(false);
    });
    expect(requests).toHaveLength(1);
  });

  it("gives up after exhausting retries", async () => {
    const { fetchFn, requests } = fakeFetch([{ status: 503, body: {} }]);
    await expect(
      postJson({
        provider: "test",
        url: "https://api.example.com/v1/x",
        headers: {},
        body: {},
        timeoutMs: 5000,
        retries: 1,
        fetchFn,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(requests).toHaveLength(2);
  });
});

describe("OpenAIProvider", () => {
  it("shapes chat completion requests and parses responses", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: {
          model: "gpt-4o-mini",
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        },
      },
    ]);
    const provider = new OpenAIProvider({ apiKey: "sk-test", fetchFn });
    const result = await provider.generate({ prompt: "hi", system: "be brief", maxTokens: 64 });
    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    const request = requests[0];
    expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.headers["authorization"]).toBe("Bearer sk-test");
    expect(request?.body["messages"]).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
  });

  it("parses embeddings and validates counts", async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 200,
        body: {
          model: "text-embedding-3-small",
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        },
      },
    ]);
    const provider = new OpenAIProvider({ apiKey: "sk-test", fetchFn });
    const result = await provider.embed({ texts: ["a", "b"] });
    expect(result.dim).toBe(2);
    expect([...(result.vectors[1] as Float32Array)]).toEqual([
      expect.closeTo(0.3, 5),
      expect.closeTo(0.4, 5),
    ]);

    const short = fakeFetch([{ status: 200, body: { data: [{ embedding: [1] }] } }]);
    const provider2 = new OpenAIProvider({ apiKey: "sk-test", fetchFn: short.fetchFn });
    await expect(provider2.embed({ texts: ["a", "b"] })).rejects.toThrow(/Expected 2 embeddings/);
  });

  it("requires an API key", () => {
    expect(() => new OpenAIProvider({})).toThrow(ProviderError);
  });

  it("rejects responses without message content", async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { choices: [{}] } }]);
    const provider = new OpenAIProvider({ apiKey: "sk-test", fetchFn });
    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(/no message content/);
  });
});

describe("AnthropicProvider", () => {
  it("uses the Messages API wire format", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: {
          model: "claude-haiku-4-5-20251001",
          content: [
            { type: "text", text: "part one " },
            { type: "text", text: "part two" },
          ],
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      },
    ]);
    const provider = new AnthropicProvider({ apiKey: "ak-test", fetchFn });
    const result = await provider.generate({ prompt: "explain", system: "expert" });
    expect(result.text).toBe("part one part two");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    const request = requests[0];
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers["x-api-key"]).toBe("ak-test");
    expect(request?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request?.body["system"]).toBe("expert");
    expect(request?.body["max_tokens"]).toBe(1024);
  });

  it("rejects embed() with a capability error", async () => {
    const provider = new AnthropicProvider({ apiKey: "ak-test" });
    await expect(provider.embed({ texts: ["x"] })).rejects.toBeInstanceOf(ProviderCapabilityError);
  });
});

describe("GoogleProvider", () => {
  it("keeps the API key in a header, never the URL", async () => {
    const { fetchFn, requests } = fakeFetch([
      {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "gemini says" }] } }] },
      },
    ]);
    const provider = new GoogleProvider({ apiKey: "g-test", fetchFn });
    const result = await provider.generate({ prompt: "hi" });
    expect(result.text).toBe("gemini says");
    const request = requests[0];
    expect(request?.url).toContain("models/gemini-2.0-flash:generateContent");
    expect(request?.url).not.toContain("g-test");
    expect(request?.headers["x-goog-api-key"]).toBe("g-test");
  });

  it("parses batch embeddings", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { embeddings: [{ values: [0.5, 0.5] }] } },
    ]);
    const provider = new GoogleProvider({ apiKey: "g-test", fetchFn });
    const result = await provider.embed({ texts: ["only"] });
    expect(result.dim).toBe(2);
    expect(requests[0]?.url).toContain(":batchEmbedContents");
  });

  it("rejects empty candidates and mismatched embedding counts", async () => {
    const empty = fakeFetch([{ status: 200, body: { candidates: [] } }]);
    const provider = new GoogleProvider({ apiKey: "g-test", fetchFn: empty.fetchFn });
    await expect(provider.generate({ prompt: "hi" })).rejects.toThrow(/no text content/);

    const short = fakeFetch([{ status: 200, body: { embeddings: [] } }]);
    const provider2 = new GoogleProvider({ apiKey: "g-test", fetchFn: short.fetchFn });
    await expect(provider2.embed({ texts: ["a", "b"] })).rejects.toThrow(/Expected 2 embeddings/);
  });
});

describe("OpenRouterProvider", () => {
  it("targets the OpenRouter endpoint and cannot embed", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { choices: [{ message: { content: "routed" } }] } },
    ]);
    const provider = new OpenRouterProvider({ apiKey: "or-test", fetchFn });
    const result = await provider.generate({ prompt: "hi" });
    expect(result.text).toBe("routed");
    expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    await expect(provider.embed({ texts: ["x"] })).rejects.toBeInstanceOf(ProviderCapabilityError);
  });
});

describe("AzureOpenAIProvider", () => {
  it("uses deployment-scoped URLs with api-version and api-key header", async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 200, body: { choices: [{ message: { content: "azure" } }] } },
    ]);
    const provider = new AzureOpenAIProvider({
      apiKey: "az-test",
      endpoint: "https://myres.openai.azure.com",
      deployment: "gpt-4o",
      embedDeployment: "embed-3",
      fetchFn,
    });
    const result = await provider.generate({ prompt: "hi" });
    expect(result.text).toBe("azure");
    expect(requests[0]?.url).toBe(
      "https://myres.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
    );
    expect(requests[0]?.headers["api-key"]).toBe("az-test");
  });

  it("fails fast without endpoint or deployments", async () => {
    expect(() => new AzureOpenAIProvider({ apiKey: "az-test" })).toThrow(/endpoint/i);
    const provider = new AzureOpenAIProvider({
      apiKey: "az-test",
      endpoint: "https://myres.openai.azure.com",
    });
    await expect(provider.generate({ prompt: "x" })).rejects.toThrow(/deployment/i);
    await expect(provider.embed({ texts: ["x"] })).rejects.toThrow(/deployment/i);
  });
});
