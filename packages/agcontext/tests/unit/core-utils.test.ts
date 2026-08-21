import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapWithConcurrency, pLimit } from "../../src/core/async.js";
import { fnv1a32, sha1Hex, sha256Hex } from "../../src/core/hash.js";
import {
  absFromRoot,
  ancestorDirs,
  extensionOf,
  posixDirname,
  relFromRoot,
  stem,
  toPosix,
} from "../../src/core/paths.js";
import { HeuristicTokenCounter, estimateTokens } from "../../src/core/tokens.js";

describe("hash", () => {
  it("produces stable sha digests", () => {
    expect(sha1Hex("agcontext")).toBe(sha1Hex("agcontext"));
    expect(sha1Hex("a")).not.toBe(sha1Hex("b"));
    expect(sha256Hex("agcontext")).toHaveLength(64);
  });

  it("fnv1a32 is deterministic and 32-bit", () => {
    expect(fnv1a32("token")).toBe(fnv1a32("token"));
    expect(fnv1a32("token")).not.toBe(fnv1a32("tokens"));
    expect(fnv1a32("anything")).toBeLessThan(2 ** 32);
  });
});

describe("paths", () => {
  it("normalizes to POSIX and back", () => {
    expect(toPosix("a\\b\\c.ts")).toBe("a/b/c.ts");
    const root = path.resolve("repo");
    const abs = path.join(root, "src", "x.ts");
    expect(relFromRoot(root, abs)).toBe("src/x.ts");
    expect(absFromRoot(root, "src/x.ts")).toBe(abs);
  });

  it("computes dirnames and ancestors", () => {
    expect(posixDirname("src/a/b.ts")).toBe("src/a");
    expect(posixDirname("top.ts")).toBe("");
    expect(ancestorDirs("src/a/b.ts")).toEqual(["src", "src/a"]);
    expect(ancestorDirs("top.ts")).toEqual([]);
  });

  it("extracts stems and extensions", () => {
    expect(stem("src/auth/auth-service.ts")).toBe("auth-service");
    expect(extensionOf("a/B.TSX")).toBe(".tsx");
    expect(extensionOf("Makefile")).toBe("");
  });
});

describe("tokens", () => {
  it("estimates by character ratio", () => {
    expect(new HeuristicTokenCounter().count("")).toBe(0);
    expect(estimateTokens("x".repeat(360))).toBe(100);
  });
});

describe("async", () => {
  it("pLimit caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const limit = pLimit(3);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("mapWithConcurrency preserves order and propagates errors", async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n * 3));
      return n * 10;
    });
    expect(result).toEqual([30, 10, 20]);
    await expect(
      mapWithConcurrency([1], 1, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });

  it("rejects invalid concurrency", () => {
    expect(() => pLimit(0)).toThrow(RangeError);
  });
});
