/**
 * Code-aware text tokenization shared by lexical retrieval (BM25), the local
 * embedding provider, and query parsing. Splitting identifiers into their
 * parts is what lets "authentication token" match `AuthTokenService`.
 */

const WORD_RE = /[A-Za-z_$][A-Za-z0-9_$]*|\d+/g;
const CAMEL_RE = /[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g;
const DIGITS_RE = /^\d+$/;

/** Language keywords and near-universal code noise excluded from indexing. */
export const CODE_STOPWORDS: ReadonlySet<string> = new Set([
  "abstract",
  "any",
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "exports",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unknown",
  "var",
  "void",
  "while",
  "yield",
  // Query noise words so natural-language queries reduce to their content terms.
  "the",
  "a",
  "an",
  "and",
  "or",
  "how",
  "does",
  "do",
  "what",
  "where",
  "when",
  "why",
  "work",
  "works",
  "with",
  "to",
  "into",
]);

/**
 * Splits one identifier into its constituent words.
 * `parseHTMLResponse` → `["parse", "HTML", "Response"]`,
 * `user_repo-v2` → `["user", "repo", "v2"]`.
 */
export function splitIdentifier(identifier: string): string[] {
  const parts: string[] = [];
  for (const segment of identifier.split(/[_\-$.]+/)) {
    if (segment.length === 0) continue;
    const matches = segment.match(CAMEL_RE);
    if (matches) parts.push(...matches);
  }
  return parts;
}

/**
 * Tokenizes arbitrary text (code or natural language) into normalized terms.
 * Compound identifiers emit both the compound term and its parts so exact
 * symbol-name queries and word-level queries both hit.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const words = text.match(WORD_RE);
  if (!words) return out;
  for (const word of words) {
    const lower = word.toLowerCase();
    if (DIGITS_RE.test(lower)) continue;
    if (CODE_STOPWORDS.has(lower)) continue;
    const parts = splitIdentifier(word);
    if (parts.length > 1) {
      if (lower.length >= 2 && lower.length <= 48) out.push(lower);
      for (const part of parts) {
        const partLower = part.toLowerCase();
        if (partLower.length < 2) continue;
        if (DIGITS_RE.test(partLower)) continue;
        if (CODE_STOPWORDS.has(partLower)) continue;
        out.push(partLower);
      }
    } else if (lower.length >= 2) {
      out.push(lower);
    }
  }
  return out;
}

/** Collapses runs of whitespace into single spaces and trims. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncates to `max` characters on a whole-line boundary with a marker. */
export function truncateLines(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastNewline = slice.lastIndexOf("\n");
  const head = lastNewline > max * 0.5 ? slice.slice(0, lastNewline) : slice;
  return `${head}\n/* … truncated by agcontext … */`;
}
