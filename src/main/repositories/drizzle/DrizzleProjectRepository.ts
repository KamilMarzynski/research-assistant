import type { Project } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { projects } from "../../db/schema";
import { CLOCK_TOKEN, DB_TOKEN } from "../../di/tokens";
import type { MonotonicClock } from "../../utils/time";
import type { CreateProjectData, IProjectRepository } from "../IProjectRepository";
import { BaseDrizzleRepository } from "./BaseDrizzleRepository";

@injectable()
export class DrizzleProjectRepository
  extends BaseDrizzleRepository<typeof projects.$inferSelect, typeof projects.$inferInsert, Project>
  implements IProjectRepository
{
  constructor(@inject(DB_TOKEN) db: DrizzleDB, @inject(CLOCK_TOKEN) clock: MonotonicClock) {
    super(db, clock);
  }

  async create(data: CreateProjectData): Promise<Project> {
    const now = this.now();
    const project: Project = {
      id: this.id(),
      name: data.name,
      slug: data.slug ?? null,
      folderPath: data.folderPath ?? null,
      projectPath: data.projectPath ?? null,
      modelOverride: data.modelOverride ?? null,
      maxRecentMessages: data.maxRecentMessages ?? 20,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values({
      id: project.id,
      name: project.name,
      slug: project.slug,
      folderPath: project.folderPath,
      projectPath: project.projectPath,
      modelOverride: project.modelOverride,
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
    return rows.map(this.rowToEntity);
  }

  async get(id: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return rows[0] ? this.rowToEntity(rows[0]) : null;
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
      .set({ name, updatedAt: this.now() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  async unlinkFolder(id: string): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ folderPath: null, updatedAt: this.now() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  async setModelOverride(id: string, modelOverride: string | null): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ modelOverride, updatedAt: this.now() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  async setProjectPath(id: string, projectPath: string): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ projectPath, updatedAt: this.now() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  async setSlug(id: string, slug: string): Promise<void> {
    const result = await this.db
      .update(projects)
      .set({ slug, updatedAt: this.now() })
      .where(eq(projects.id, id));
    if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
  }

  protected rowToEntity = (row: typeof projects.$inferSelect): Project => ({
    id: row.id,
    name: row.name,
    slug: row.slug ?? null,
    folderPath: row.folderPath ?? null,
    projectPath: row.projectPath ?? null,
    modelOverride: row.modelOverride ?? null,
    maxRecentMessages: row.maxRecentMessages ?? 20,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
