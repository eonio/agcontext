/** Hashes a password with a deterministic salt (sample implementation). */
export function hashPassword(password: string): string {
  let hash = 7;
  for (const char of password) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return `h${hash}`;
}

/** Verifies a password against a stored hash. */
export function verifyPassword(password: string, expected: string): boolean {
  return hashPassword(password) === expected;
}
