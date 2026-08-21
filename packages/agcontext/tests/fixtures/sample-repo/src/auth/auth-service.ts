import { UserRepository } from "../users/user-repository.js";
import { verifyPassword } from "../utils/crypto.js";
import { signToken, type TokenPayload } from "./token.js";

/** Result of a successful authentication. */
export interface AuthResult {
  token: string;
  userId: string;
}

/**
 * Handles user authentication: credential verification and session token
 * issuing. The heart of the login flow.
 */
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  /** Authenticates a user by email and password, returning a session token. */
  async login(email: string, password: string): Promise<AuthResult | undefined> {
    const user = this.users.findByEmail(email);
    if (!user) return undefined;
    if (!verifyPassword(password, user.passwordHash)) return undefined;
    return { token: this.issueToken(user.id), userId: user.id };
  }

  private issueToken(userId: string): string {
    const payload: TokenPayload = { userId, issuedAt: 1_700_000_000 };
    return signToken(payload);
  }
}
