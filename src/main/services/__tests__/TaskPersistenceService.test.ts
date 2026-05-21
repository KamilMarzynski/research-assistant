import "reflect-metadata";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../db/migrate";
import * as schema from "../../db/schema";
import { TaskPersistenceService } from "../TaskPersistenceService";

async function createTestDb() {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return db;
}

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>) {
  await db.insert(schema.projects).values({
    id: "p1",
    name: "P",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("TaskPersistenceService — brief field", () => {
  it("persists and reads back the brief on a task", async () => {
    const db = await createTestDb();
    await seedProject(db);
    const svc = new TaskPersistenceService(db, "/tmp/.scholar");
    const brief = "<research_brief><user_request>hello</user_request></research_brief>";

    await svc.saveTask({
      taskId: "t1",
      projectId: "p1",
      projectName: "P",
      query: "fallback query",
      brief,
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });

    const tasks = await svc.getInProgressTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].brief).toBe(brief);
  });

  it("loads a task with null brief (back-compat)", async () => {
    const db = await createTestDb();
    await seedProject(db);
    const svc = new TaskPersistenceService(db, "/tmp/.scholar");
    await svc.saveTask({
      taskId: "t2",
      projectId: "p1",
      projectName: "P",
      query: "legacy",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });
    const tasks = await svc.getInProgressTasks();
    expect(tasks[0].brief).toBeUndefined();
  });
});
