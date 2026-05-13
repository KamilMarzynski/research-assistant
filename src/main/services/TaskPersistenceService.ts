import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import { z } from "zod/v4";
import type { DrizzleDB } from "../db/client";
import { tasks } from "../db/schema";
import { AGENT_HOME_PATH_TOKEN, DB_TOKEN } from "../di/tokens";

export interface ResearchTask {
  taskId: string;
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
  startedAt: string;
  status?: "pending" | "in_progress" | "complete" | "failed";
}

const ResearchTaskSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  query: z.string(),
  folderPath: z.string().nullable(),
  startedAt: z.string(),
  status: z.enum(["pending", "in_progress", "complete", "failed"]).optional(),
});

@injectable()
export class TaskPersistenceService {
  constructor(
    @inject(DB_TOKEN) private readonly db: DrizzleDB,
    @inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string,
  ) {}

  async saveTask(task: ResearchTask): Promise<void> {
    await this.db
      .insert(tasks)
      .values({
        id: task.taskId,
        projectId: task.projectId,
        projectName: task.projectName,
        query: task.query,
        folderPath: task.folderPath,
        status: "in_progress",
        createdAt: new Date(task.startedAt),
        updatedAt: new Date(task.startedAt),
      })
      .onConflictDoNothing();
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.status, "in_progress"));
    return rows.map((r) => ({
      taskId: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      query: r.query,
      folderPath: r.folderPath,
      startedAt: new Date(r.createdAt).toISOString(),
      status: r.status,
    }));
  }

  async getTasksByProject(projectId: string): Promise<ResearchTask[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.createdAt));
    return rows.map((r) => ({
      taskId: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      query: r.query,
      folderPath: r.folderPath,
      startedAt: new Date(r.createdAt).toISOString(),
      status: r.status,
    }));
  }

  async updateTaskStatus(
    taskId: string,
    status: "pending" | "in_progress" | "complete" | "failed",
    error?: string,
  ): Promise<void> {
    await this.db
      .update(tasks)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
  }

  async migrateTasksFromJson(): Promise<void> {
    const dir = join(this.homePath, "tasks");
    let entries: string[] = [];
    try {
      entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    } catch {
      return; // no JSON tasks directory -- nothing to migrate
    }
    for (const entry of entries) {
      try {
        const raw = await readFile(join(dir, entry), "utf-8");
        const parsed = JSON.parse(raw);
        const task = ResearchTaskSchema.parse(parsed);
        await this.saveTask(task);
        await unlink(join(dir, entry));
      } catch (err) {
        console.error(
          `[TaskPersistenceService] migrateTasksFromJson: skipping malformed file ${entry}:`,
          err,
        );
      }
    }
  }
}
