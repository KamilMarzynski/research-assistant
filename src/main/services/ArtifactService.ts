import { inject, injectable } from "tsyringe";
import type { Artifact } from "../../shared/types";
import { ARTIFACT_REPO_TOKEN } from "../di/tokens";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";

@injectable()
export class ArtifactService {
  constructor(@inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository) {}

  async saveArtifact(data: Omit<Artifact, "id" | "createdAt">): Promise<Artifact> {
    return this.repo.create(data);
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    return this.repo.listByProject(projectId);
  }
}
