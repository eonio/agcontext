import pc from "picocolors";
import type { Logger, LogLevel } from "./interfaces.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

/**
 * Console logger writing to stderr, keeping stdout free for machine-readable
 * CLI output. Color usage respects the `NO_COLOR` convention via picocolors.
 */
export class ConsoleLogger implements Logger {
  private readonly threshold: number;

  constructor(level: LogLevel = "info") {
    this.threshold = LEVEL_ORDER[level];
  }

  private write(level: LogLevel, prefix: string, message: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < this.threshold) return;
    const rendered =
      args.length > 0
        ? `${message} ${args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ")}`
        : message;
    process.stderr.write(`${prefix} ${rendered}\n`);
  }

  debug(message: string, ...args: unknown[]): void {
    this.write("debug", pc.dim("agc:debug"), message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.write("info", pc.cyan("agc"), message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write("warn", pc.yellow("agc:warn"), message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write("error", pc.red("agc:error"), message, args);
  }
}

/** Logger that drops everything; used as a default in library embedding. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
