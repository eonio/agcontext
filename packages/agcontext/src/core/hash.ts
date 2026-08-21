import { createHash } from "node:crypto";

/** SHA-1 hex digest — used for content-change detection (not security). */
export function sha1Hex(input: string | Buffer): string {
  return createHash("sha1").update(input).digest("hex");
}

/** SHA-256 hex digest. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * FNV-1a 32-bit hash. Fast and deterministic; drives the local
 * feature-hashing embedding provider.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
