/**
 * Ports (in the hexagonal-architecture sense): small interfaces the core
 * depends on, with concrete adapters supplied at composition time.
 * Everything here is trivially replaceable in tests.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Estimates LLM token counts for budget accounting. */
export interface TokenCounter {
  count(text: string): number;
}

/** Injectable clock so ranking recency and telemetry are testable. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
