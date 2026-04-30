import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./client";

export async function runMigrations(db: DrizzleDB): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Run 6: add folder_path — idempotent, ignore "duplicate column name" error
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN folder_path TEXT`);
  } catch {
    // column already exists — safe to ignore
  }

  // Run 7: add max_recent_messages — idempotent, ignore "duplicate column name" error
  try {
    await db.run(
      sql`ALTER TABLE projects ADD COLUMN max_recent_messages INTEGER NOT NULL DEFAULT 20`,
    );
  } catch {
    // column already exists — safe to ignore
  }

  // Run 12: add model_override
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN model_override TEXT`);
  } catch {
    // column already exists — safe to ignore
  }
}
