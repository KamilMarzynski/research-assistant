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

  function isDuplicateColumnError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message ?? "";
    const causeMsg = (err as { cause?: { message?: string } }).cause?.message ?? "";
    return msg.includes("duplicate column name") || causeMsg.includes("duplicate column name");
  }

  // Run 6: add folder_path — idempotent, ignore "duplicate column name" error
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN folder_path TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 7: add max_recent_messages — idempotent, ignore "duplicate column name" error
  try {
    await db.run(
      sql`ALTER TABLE projects ADD COLUMN max_recent_messages INTEGER NOT NULL DEFAULT 20`,
    );
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 12: add model_override
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN model_override TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 14: tasks table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      project_name TEXT NOT NULL,
      query TEXT NOT NULL,
      folder_path TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('pending','in_progress','complete','failed')),
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Run 15: add artifact notification columns — idempotent
  try {
    await db.run(sql`ALTER TABLE artifacts ADD COLUMN relative_path TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 16: add project_path — idempotent
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN project_path TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  try {
    await db.run(sql`ALTER TABLE artifacts ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 17: add slug — idempotent
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN slug TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }

  // Run 18: add approval_level — idempotent
  try {
    await db.run(
      sql`ALTER TABLE projects ADD COLUMN approval_level TEXT NOT NULL DEFAULT 'default'`,
    );
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}
