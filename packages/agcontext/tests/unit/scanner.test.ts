import { describe, expect, it } from "vitest";
import { scanRepository } from "../../src/indexing/scanner.js";
import { FIXTURE_REPO } from "../helpers/testkit.js";

const BASE = {
  root: FIXTURE_REPO,
  extensions: [".ts", ".tsx", ".js"],
  exclude: [] as string[],
  maxFileSizeBytes: 1_000_000,
};

describe("scanRepository", () => {
  it("finds source files sorted by path", async () => {
    const files = await scanRepository(BASE);
    const paths = files.map((file) => file.path);
    expect(paths).toContain("src/auth/auth-service.ts");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("tests/auth-service.test.ts");
    expect([...paths].sort()).toEqual(paths);
    expect(files.every((file) => file.size > 0 && file.mtimeMs > 0)).toBe(true);
  });

  it("honors the repository .gitignore", async () => {
    const files = await scanRepository(BASE);
    expect(files.map((file) => file.path)).not.toContain("secret/legacy.ts");
  });

  it("filters by extension", async () => {
    const files = await scanRepository({ ...BASE, extensions: [".xyz"] });
    expect(files).toEqual([]);
    const jsonOnly = await scanRepository({ ...BASE, extensions: [".json"] });
    expect(jsonOnly.map((file) => file.path)).toEqual(["package.json"]);
  });

  it("applies configured exclude patterns", async () => {
    const files = await scanRepository({ ...BASE, exclude: ["src/auth/"] });
    const paths = files.map((file) => file.path);
    expect(paths).not.toContain("src/auth/auth-service.ts");
    expect(paths).toContain("src/index.ts");
  });

  it("skips files above the size cap", async () => {
    const files = await scanRepository({ ...BASE, maxFileSizeBytes: 10 });
    expect(files).toEqual([]);
  });
});
