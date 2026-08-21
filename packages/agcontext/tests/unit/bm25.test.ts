import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/core/text.js";
import { NodeKind, type Chunk } from "../../src/core/types.js";
import { BM25Index } from "../../src/retrieval/bm25.js";

function chunk(id: string, file: string, name: string, text: string): Chunk {
  return { id, file, name, kind: NodeKind.Function, text, hash: id, startLine: 1, endLine: 1 };
}

const chunks: Chunk[] = [
  chunk(
    "sym:src/auth/auth-service.ts#AuthService",
    "src/auth/auth-service.ts",
    "AuthService",
    "class AuthService { login(email, password) { verifyPassword(password) } } authentication",
  ),
  chunk(
    "sym:src/db/database.ts#Database",
    "src/db/database.ts",
    "Database",
    "class Database { query(table) { return rows } }",
  ),
  chunk(
    "sym:src/utils/format.ts#formatDate",
    "src/utils/format.ts",
    "formatDate",
    "export function formatDate(value) { return value.toISOString() }",
  ),
];

describe("BM25Index", () => {
  it("ranks documents containing query terms first", () => {
    const index = BM25Index.fromChunks(chunks);
    const hits = index.search(tokenize("authentication login"), 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe("sym:src/auth/auth-service.ts#AuthService");
  });

  it("matches on file path and symbol name tokens", () => {
    const index = BM25Index.fromChunks(chunks);
    const hits = index.search(tokenize("database"), 10);
    expect(hits[0]?.id).toBe("sym:src/db/database.ts#Database");
  });

  it("returns nothing for unmatched terms or empty queries", () => {
    const index = BM25Index.fromChunks(chunks);
    expect(index.search(tokenize("zeppelin"), 10)).toEqual([]);
    expect(index.search([], 10)).toEqual([]);
  });

  it("respects the limit and orders deterministically", () => {
    const index = BM25Index.fromChunks(chunks);
    // "src" appears in every chunk's file path — three matches, capped to one.
    expect(index.search(["src"], 10)).toHaveLength(3);
    expect(index.search(["src"], 1)).toHaveLength(1);
  });

  it("handles empty corpora", () => {
    const index = BM25Index.fromChunks([]);
    expect(index.size).toBe(0);
    expect(index.search(["anything"], 5)).toEqual([]);
  });
});
