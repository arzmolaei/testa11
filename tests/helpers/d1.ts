import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// SQLite executes the actual migration and Worker SQL. The API shape matches
// the D1 operations used here; isolated Wrangler checks cover the D1 runtime.
export class TestD1 {
  database = new DatabaseSync(":memory:");
  failure = false;
  constructor(team = true) {
    this.database.exec(readFileSync(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8"));
    if (team) this.database.exec(readFileSync(new URL("../../migrations/0002_team_accounts.sql", import.meta.url), "utf8"));
  }
  get revision() { return Number(this.database.prepare("SELECT revision FROM seo_meta").get()!.revision); }
  get snapshots() {
    const map = new Map<string, Map<number, string>>();
    for (const row of this.database.prepare("SELECT snapshot_id, chunk_index, payload FROM seo_chunks").all()) {
      const chunks = map.get(String(row.snapshot_id)) || new Map<number, string>();
      chunks.set(Number(row.chunk_index), String(row.payload));
      map.set(String(row.snapshot_id), chunks);
    }
    return map;
  }
  prepare(sql: string) {
    const db = this;
    let values: (string | number | bigint | null)[] = [];
    const statement = {
      bind(...input: unknown[]) {
        values = input as typeof values;
        return statement;
      },
      execute(operation: "first" | "all" | "run") {
        if (db.failure) throw new Error("private database detail");
        const query = db.database.prepare(sql);
        if (operation === "first") return query.get(...values) || null;
        if (operation === "all") return { success: true, results: query.all(...values) };
        const result = query.run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() { return statement.execute("first"); },
      async all() { return statement.execute("all"); },
      async run() { return statement.execute("run"); },
    };
    return statement;
  }
  async batch(statements: ReturnType<TestD1["prepare"]>[]) {
    if (this.failure) throw new Error("private database detail");
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute("run"));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.database.close(); }
}
