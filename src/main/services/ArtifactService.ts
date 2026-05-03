import { inject, injectable } from "tsyringe";
import type { Artifact } from "../../shared/types";
import { ARTIFACT_REPO_TOKEN } from "../di/tokens";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";

@injectable()
export class ArtifactService {
  constructor(@inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository) {}

  async saveArtifact(
    data: Omit<Artifact, "id" | "createdAt" | "acknowledged"> & { acknowledged?: boolean },
  ): Promise<Artifact> {
    return this.repo.create(data);
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    return this.repo.listByProject(projectId);
  }

  async listUnacknowledged(projectId: string): Promise<Artifact[]> {
    const all = await this.repo.listByProject(projectId);
    return all
      .filter((a) => !a.acknowledged)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  async acknowledge(_projectId: string, artifactId: string): Promise<void> {
    await this.repo.acknowledge(artifactId);
  }

  async acknowledgeAll(projectId: string): Promise<void> {
    await this.repo.acknowledgeAllByProject(projectId);
  }
}
