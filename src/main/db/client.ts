import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DrizzleDB = LibSQLDatabase<typeof schema>;

export async function createDatabase(dbPath: string): Promise<DrizzleDB> {
  let client: ReturnType<typeof createClient>;
  try {
    client = createClient({ url: `file:${dbPath}` });
  } catch (err) {
    throw new Error(`Failed to open SQLite database at ${dbPath}: ${String(err)}`);
  }
  const walResult = await client.execute("PRAGMA journal_mode=WAL");
  const mode = walResult.rows[0]?.[0];
  if (mode !== "wal") {
    throw new Error(`SQLite WAL mode not enabled; journal_mode=${String(mode)}`);
  }

  await client.execute("PRAGMA foreign_keys=ON");
  return drizzle(client, { schema });
}
