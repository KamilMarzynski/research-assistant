import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/main/db/schema";
import { runMigrations } from "../../src/main/db/migrate";
import type { DrizzleDB } from "../../src/main/db/client";

export async function createTestDatabase(): Promise<DrizzleDB> {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return db;
}
