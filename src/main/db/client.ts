import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DrizzleDB = LibSQLDatabase<typeof schema>;

export async function createDatabase(dbPath: string): Promise<DrizzleDB> {
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute("PRAGMA journal_mode=WAL");
  return drizzle(client, { schema });
}
