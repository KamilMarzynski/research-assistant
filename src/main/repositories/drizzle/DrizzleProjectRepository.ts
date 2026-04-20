import type { Project } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { projects } from "../../db/schema";
import { DB_TOKEN } from "../../di/tokens";
import type { IProjectRepository } from "../IProjectRepository";

@injectable()
export class DrizzleProjectRepository implements IProjectRepository {
  private lastTimestamp = 0;

  private monotonicNow(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }

  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
    const now = this.monotonicNow();
    const project: Project = {
      id: crypto.randomUUID(),
      name: data.name,
      folderPath: data.folderPath ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    return project;
  }

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt), desc(projects.id));
    return rows.map(this.rowToProject);
  }

  async get(id: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return rows[0] ? this.rowToProject(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async linkFolder(id: string, folderPath: string): Promise<void> {
    await this.db.update(projects).set({ folderPath }).where(eq(projects.id, id));
  }

  private rowToProject = (row: typeof projects.$inferSelect): Project => ({
    id: row.id,
    name: row.name,
    folderPath: row.folderPath ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
