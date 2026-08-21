import { describe, expect, it } from "vitest";
import { ProviderCapabilityError } from "../../src/core/errors.js";
import { LOCAL_EMBED_DIM, LocalProvider } from "../../src/providers/local.js";

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

describe("LocalProvider", () => {
  const provider = new LocalProvider();

  it("declares embed-only capabilities", () => {
    expect(provider.capabilities).toEqual({ generate: false, embed: true });
    expect(provider.name).toBe("local");
  });

  it("produces deterministic, normalized vectors", async () => {
    const first = await provider.embed({ texts: ["class AuthService { login() {} }"] });
    const second = await provider.embed({ texts: ["class AuthService { login() {} }"] });
    expect(first.dim).toBe(LOCAL_EMBED_DIM);
    expect(first.vectors[0]).toEqual(second.vectors[0]);
    const norm = Math.sqrt(dot(first.vectors[0] as Float32Array, first.vectors[0] as Float32Array));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("places related texts closer than unrelated texts", async () => {
    const { vectors } = await provider.embed({
      texts: [
        "authentication login password token session user",
        "verify user password and issue a login token",
        "matrix multiplication kernel gpu shader pipeline render",
      ],
    });
    const [query, related, unrelated] = vectors as [Float32Array, Float32Array, Float32Array];
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });

  it("embeds empty text as a zero vector without crashing", async () => {
    const { vectors } = await provider.embed({ texts: [""] });
    expect(vectors[0]).toHaveLength(LOCAL_EMBED_DIM);
  });

  it("rejects generate() with a capability error", async () => {
    await expect(provider.generate({ prompt: "hi" })).rejects.toBeInstanceOf(
      ProviderCapabilityError,
    );
  });
});
