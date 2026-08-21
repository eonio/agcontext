import { AuthService } from "../auth/auth-service.js";

/** HTTP request shape for login. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Handles the POST /login endpoint. */
export class LoginController {
  constructor(private readonly auth: AuthService) {}

  async handle(request: LoginRequest): Promise<{ status: number; token?: string }> {
    const result = await this.auth.login(request.email, request.password);
    if (!result) return { status: 401 };
    return { status: 200, token: result.token };
  }
}
