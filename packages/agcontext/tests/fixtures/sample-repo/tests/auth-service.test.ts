import { AuthService } from "../src/auth/auth-service.js";
import { Database } from "../src/db/database.js";
import { UserRepository } from "../src/users/user-repository.js";

export function testLogin(): Promise<unknown> {
  const service = new AuthService(new UserRepository(new Database()));
  return service.login("user@example.com", "password");
}
