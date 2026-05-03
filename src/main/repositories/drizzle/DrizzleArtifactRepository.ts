import type { Artifact } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { artifacts } from "../../db/schema";
import { DB_TOKEN } from "../../di/tokens";
import { MonotonicClock } from "../../utils/time";
import type { IArtifactRepository } from "../IArtifactRepository";

@injectable()
export class DrizzleArtifactRepository implements IArtifactRepository {
  private readonly clock = new MonotonicClock();

  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(
    data: Omit<Artifact, "id" | "createdAt" | "acknowledged"> & { acknowledged?: boolean },
  ): Promise<Artifact> {
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      title: data.title,
      filePath: data.filePath,
      relativePath: data.relativePath,
      acknowledged: data.acknowledged ?? false,
      createdAt: this.clock.now(),
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
    return rows.map(this.rowToArtifact);
  }

  async get(id: string): Promise<Artifact | null> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    return rows[0] ? this.rowToArtifact(rows[0]) : null;
  }

  private rowToArtifact = (row: typeof artifacts.$inferSelect): Artifact => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    filePath: row.filePath,
    relativePath: row.relativePath ?? undefined,
    acknowledged: row.acknowledged,
    createdAt: row.createdAt,
  });
}
