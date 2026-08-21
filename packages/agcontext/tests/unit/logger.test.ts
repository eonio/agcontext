import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger, silentLogger } from "../../src/core/logger.js";

describe("ConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureStderr(): string[] {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  }

  it("writes at or above the configured level to stderr", () => {
    const lines = captureStderr();
    const logger = new ConsoleLogger("info");
    logger.debug("hidden");
    logger.info("visible info");
    logger.warn("visible warn");
    logger.error("visible error");
    expect(lines).toHaveLength(3);
    expect(lines.join("")).toContain("visible info");
    expect(lines.join("")).not.toContain("hidden");
  });

  it("serializes structured arguments", () => {
    const lines = captureStderr();
    const logger = new ConsoleLogger("debug");
    logger.debug("payload", { a: 1 }, "extra");
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    logger.info("circular", circular);
    expect(lines[0]).toContain('{"a":1}');
    expect(lines[0]).toContain("extra");
    expect(lines[1]).toContain("[object Object]");
  });

  it("silences everything at level silent", () => {
    const lines = captureStderr();
    const logger = new ConsoleLogger("silent");
    logger.error("nope");
    expect(lines).toHaveLength(0);
  });

  it("silentLogger drops all levels", () => {
    const lines = captureStderr();
    silentLogger.debug("a");
    silentLogger.info("b");
    silentLogger.warn("c");
    silentLogger.error("d");
    expect(lines).toHaveLength(0);
  });
});
