import type { Artifact } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { artifacts } from "../../db/schema";
import { CLOCK_TOKEN, DB_TOKEN } from "../../di/tokens";
import type { MonotonicClock } from "../../utils/time";
import type { IArtifactRepository } from "../IArtifactRepository";
import { BaseDrizzleRepository } from "./BaseDrizzleRepository";

@injectable()
export class DrizzleArtifactRepository
  extends BaseDrizzleRepository<
    typeof artifacts.$inferSelect,
    typeof artifacts.$inferInsert,
    Artifact
  >
  implements IArtifactRepository
{
  constructor(@inject(DB_TOKEN) db: DrizzleDB, @inject(CLOCK_TOKEN) clock: MonotonicClock) {
    super(db, clock);
  }

  async create(
    data: Omit<Artifact, "id" | "createdAt" | "acknowledged"> & { acknowledged?: boolean },
  ): Promise<Artifact> {
    const artifact: Artifact = {
      id: this.id(),
      projectId: data.projectId,
      title: data.title,
      filePath: data.filePath,
      relativePath: data.relativePath,
      acknowledged: data.acknowledged ?? false,
      createdAt: this.now(),
    };
    await this.db.insert(artifacts).values({
      id: artifact.id,
      projectId: artifact.projectId,
      title: artifact.title,
      filePath: artifact.filePath,
      relativePath: artifact.relativePath,
      acknowledged: artifact.acknowledged,
      createdAt: artifact.createdAt,
    });
    return artifact;
  }

  async listByProject(projectId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id));
    return rows.map(this.rowToEntity);
  }

  async get(id: string): Promise<Artifact | null> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    return rows[0] ? this.rowToEntity(rows[0]) : null;
  }

  async acknowledge(id: string): Promise<void> {
    await this.db.update(artifacts).set({ acknowledged: true }).where(eq(artifacts.id, id));
  }

  async acknowledgeAllByProject(projectId: string): Promise<void> {
    await this.db
      .update(artifacts)
      .set({ acknowledged: true })
      .where(eq(artifacts.projectId, projectId));
  }

  async findUnacknowledged(projectId: string, limit = 50): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(artifacts.createdAt), desc(artifacts.id))
      .limit(limit);
    return rows.map(this.rowToEntity).filter((a) => !a.acknowledged);
  }

  protected rowToEntity = (row: typeof artifacts.$inferSelect): Artifact => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    filePath: row.filePath,
    relativePath: row.relativePath ?? undefined,
    acknowledged: row.acknowledged,
    createdAt: row.createdAt,
  });
}
