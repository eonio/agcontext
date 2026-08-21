import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    benchmark: {
      include: ["tests/benchmarks/**/*.bench.ts"],
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/main.ts", "src/index.ts", "src/**/index.ts"],
      reporter: ["text-summary", "text", "lcov"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 92,
        branches: 78,
      },
    },
  },
});
