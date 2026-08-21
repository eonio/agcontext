/** Minimal database gateway used by repositories. */
export class Database {
  private readonly rows = new Map<string, unknown[]>();

  query(table: string): unknown[] {
    return this.rows.get(table) ?? [];
  }

  insert(table: string, row: unknown): void {
    const rows = this.rows.get(table) ?? [];
    rows.push(row);
    this.rows.set(table, rows);
  }
}
