import { inject, injectable } from "tsyringe";
import { ARTIFACT_REPO_TOKEN } from "../di/tokens";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";

@injectable()
export class OutputNotificationService {
  constructor(@inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository) {}

  async recordWrite(
    projectId: string,
    absolutePath: string,
    relativePath: string,
    fileName: string,
  ): Promise<void> {
    await this.repo.create({
      projectId,
      title: fileName,
      filePath: absolutePath,
      relativePath,
      acknowledged: false,
    });
  }
}
