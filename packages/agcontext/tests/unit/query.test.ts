import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/retrieval/query.js";

describe("parseQuery", () => {
  it("extracts normalized tokens and raw identifiers", () => {
    const parsed = parseQuery("How does AuthService.login handle passwords?");
    expect(parsed.tokens).toContain("authservice");
    expect(parsed.tokens).toContain("login");
    expect(parsed.tokens).toContain("passwords");
    expect(parsed.identifiers).toContain("AuthService.login");
    expect(parsed.identifiers).toContain("handle");
  });

  it("deduplicates identifiers case-insensitively and trims dots", () => {
    const parsed = parseQuery("AuthService authservice AuthService.");
    expect(parsed.identifiers).toEqual(["AuthService"]);
  });

  it("ignores short and non-identifier fragments", () => {
    const parsed = parseQuery("a b? c! 42 ->");
    expect(parsed.identifiers).toEqual([]);
  });
});
