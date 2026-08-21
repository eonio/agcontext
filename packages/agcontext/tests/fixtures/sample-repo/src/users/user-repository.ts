import { BaseRepository } from "../db/base-repository.js";

/** A user account row. */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
}

/** Data access for user accounts. */
export class UserRepository extends BaseRepository {
  protected override table(): string {
    return "users";
  }

  findByEmail(email: string): User | undefined {
    const rows = this.db.query(this.table()) as User[];
    return rows.find((row) => row.email === email);
  }

  save(user: User): void {
    this.db.insert(this.table(), user);
  }
}
