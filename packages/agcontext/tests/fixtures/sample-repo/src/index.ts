export { AuthService, type AuthResult } from "./auth/auth-service.js";
export * from "./users/user-repository.js";
export { appConfig } from "./config.js";
import { startServer } from "./server.js";

startServer(3000);
