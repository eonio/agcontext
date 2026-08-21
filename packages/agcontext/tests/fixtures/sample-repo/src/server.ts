import express from "express";
import { AuthService } from "./auth/auth-service.js";
import { Database } from "./db/database.js";
import { LoginController } from "./http/login-controller.js";
import { UserRepository } from "./users/user-repository.js";

/** Boots the HTTP server with all wiring. */
export function startServer(port: number): void {
  const database = new Database();
  const users = new UserRepository(database);
  const auth = new AuthService(users);
  const controller = new LoginController(auth);
  const app = express();
  app.post("/login", (req: { body: LoginBody }, res: { json: (value: unknown) => void }) => {
    void controller.handle(req.body).then((result) => res.json(result));
  });
  app.listen(port);
}

interface LoginBody {
  email: string;
  password: string;
}
