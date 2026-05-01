import type { Project } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { projects } from "../../db/schema";
import { DB_TOKEN } from "../../di/tokens";
import type { CreateProjectData, IProjectRepository } from "../IProjectRepository";

@injectable()
export class DrizzleProjectRepository implements IProjectRepository {
  private lastTimestamp = 0;

  private monotonicNow(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }

  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: CreateProjectData): Promise<Project> {
    const now = this.monotonicNow();
    const project: Project = {
      id: crypto.randomUUID(),
      name: data.name,
      folderPath: data.folderPath ?? null,
      maxRecentMessages: data.maxRecentMessages ?? 20,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      maxRecentMessages: project.maxRecentMessages,
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
    const result = await this.db.update(projects).set({ folderPath }).where(eq(projects.id, id));
    if (result.rowsAffected === 0) {
      throw new Error(`Project not found: ${id}`);
    }
  }

  async rename(id: string, name: string): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ name, updatedAt: new Date() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  async unlinkFolder(id: string): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ folderPath: null, updatedAt: new Date() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  private rowToProject = (row: typeof projects.$inferSelect): Project => ({
    id: row.id,
    name: row.name,
    folderPath: row.folderPath ?? null,
    maxRecentMessages: row.maxRecentMessages ?? 20,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
