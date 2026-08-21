import type { TokenCounter } from "./interfaces.js";

/**
 * Characters-per-token ratio for source code under modern BPE tokenizers.
 * Measured averages for TypeScript hover around 3.4–3.9 chars/token; 3.6 is a
 * safe middle that slightly overestimates, which is the right direction for
 * budget enforcement (we would rather under-fill than overflow).
 */
export const CHARS_PER_TOKEN = 3.6;

/**
 * Deterministic, dependency-free token estimator. Swap in a real tokenizer by
 * providing your own {@link TokenCounter} through `AGContextOptions.tokenCounter`.
 */
export class HeuristicTokenCounter implements TokenCounter {
  count(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}

export const defaultTokenCounter: TokenCounter = new HeuristicTokenCounter();

export function estimateTokens(text: string): number {
  return defaultTokenCounter.count(text);
}
