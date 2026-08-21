import { appConfig } from "../config.js";

/** Claims carried by a session token. */
export interface TokenPayload {
  userId: string;
  issuedAt: number;
}

/** Signs a session token for authenticated users. */
export function signToken(payload: TokenPayload): string {
  return `${payload.userId}.${payload.issuedAt}.${appConfig.tokenTtlMinutes}`;
}

/** Parses and validates a session token. */
export function verifyToken(token: string): TokenPayload | undefined {
  const [userId, issuedAt] = token.split(".");
  if (!userId || !issuedAt) return undefined;
  return { userId, issuedAt: Number(issuedAt) };
}
