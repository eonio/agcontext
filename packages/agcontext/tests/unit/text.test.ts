import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  splitIdentifier,
  tokenize,
  truncateLines,
} from "../../src/core/text.js";

describe("splitIdentifier", () => {
  it("splits camelCase and PascalCase", () => {
    expect(splitIdentifier("getUserById")).toEqual(["get", "User", "By", "Id"]);
    expect(splitIdentifier("AuthService")).toEqual(["Auth", "Service"]);
  });

  it("handles acronym runs", () => {
    expect(splitIdentifier("parseHTMLResponse")).toEqual(["parse", "HTML", "Response"]);
  });

  it("splits snake_case, kebab-case, and dots", () => {
    expect(splitIdentifier("user_repo-v2")).toEqual(["user", "repo", "v2"]);
    expect(splitIdentifier("auth.service")).toEqual(["auth", "service"]);
  });
});

describe("tokenize", () => {
  it("emits compound identifiers plus their parts", () => {
    const tokens = tokenize("const authService = new AuthTokenService()");
    expect(tokens).toContain("authservice");
    expect(tokens).toContain("auth");
    expect(tokens).toContain("service");
    expect(tokens).toContain("token");
  });

  it("filters language keywords and short tokens", () => {
    const tokens = tokenize("export const x = function () { return null; }");
    expect(tokens).not.toContain("export");
    expect(tokens).not.toContain("const");
    expect(tokens).not.toContain("return");
    expect(tokens).not.toContain("x");
  });

  it("drops pure numbers and query stopwords", () => {
    const tokens = tokenize("How does the login work in 2024?");
    expect(tokens).toEqual(["login"]);
  });

  it("returns empty for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("collapseWhitespace", () => {
  it("collapses runs of whitespace", () => {
    expect(collapseWhitespace("a\n  b\t\tc")).toBe("a b c");
  });
});

describe("truncateLines", () => {
  it("keeps short text intact", () => {
    expect(truncateLines("short", 100)).toBe("short");
  });

  it("truncates on a line boundary with a marker", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const truncated = truncateLines(text, 120);
    expect(truncated.length).toBeLessThan(text.length);
    expect(truncated).toContain("truncated by agcontext");
    expect(
      truncated.split("\n").every((line) => line.startsWith("line-") || line.startsWith("/*")),
    ).toBe(true);
  });
});
