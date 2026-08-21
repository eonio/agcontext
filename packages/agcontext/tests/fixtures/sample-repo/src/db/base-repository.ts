import { Database } from "./database.js";

/** Base class wiring repositories to the database. */
export abstract class BaseRepository {
  constructor(protected readonly db: Database) {}

  protected table(): string {
    return "default";
  }
}
