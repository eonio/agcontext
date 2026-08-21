import { tokenize } from "../core/text.js";

export interface ParsedQuery {
  text: string;
  /** Normalized retrieval terms (identifier-split, stopword-filtered). */
  tokens: string[];
  /** Raw identifier-looking words, used for exact graph-name seeding. */
  identifiers: string[];
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$.]*$/;

export function parseQuery(query: string): ParsedQuery {
  const text = query.trim();
  const tokens = tokenize(text);
  const identifiers: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[^A-Za-z0-9_$.]+/)) {
    const word = raw.replace(/^\.+|\.+$/g, "");
    if (word.length < 3) continue;
    if (!IDENTIFIER_RE.test(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push(word);
  }
  return { text, tokens, identifiers };
}
