import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

async function createTestDb() {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return { client, db };
}

describe("database integrity", () => {
  it("enforces foreign keys", async () => {
    const { client } = await createTestDb();

    // Verify FK pragma is on
    const pragmaResult = await client.execute("PRAGMA foreign_keys");
    expect(pragmaResult.rows[0]?.["foreign_keys"] ?? pragmaResult.rows[0]?.[0]).toBe(1);

    // Insert a project
    await client.execute(
      "INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'test', 1, 1)",
    );

    // Insert a message referencing the project - should succeed
    await client.execute(
      "INSERT INTO messages (id, project_id, role, content, created_at) VALUES ('m1', 'p1', 'user', 'hello', 1)",
    );

    // Insert a message with non-existent project - should fail
    const err = await client
      .execute(
        "INSERT INTO messages (id, project_id, role, content, created_at) VALUES ('m2', 'no-such-project', 'user', 'hello', 1)",
      )
      .then(() => null)
      .catch((e: Error) => e);
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/FOREIGN KEY|constraint/i);

    // Delete project should cascade
    await client.execute("DELETE FROM projects WHERE id = 'p1'");
    const orphan = await client.execute(
      "SELECT COUNT(*) as cnt FROM messages WHERE project_id = 'p1'",
    );
    const count = Number(Object.values(orphan.rows[0] ?? {})[0] ?? 0);
    expect(count).toBe(0);
  });
});
