import type { ApprovalLevel } from "@shared/types";
import { inject, injectable } from "tsyringe";
import { PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { NotFoundError } from "./errors";

@injectable()
export class ApprovalPolicyService {
  private readonly cache = new Map<string, ApprovalLevel>();

  constructor(@inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository) {}

  async getLevel(projectId: string): Promise<ApprovalLevel> {
    const cached = this.cache.get(projectId);
    if (cached) {
      return cached;
    }

    const project = await this.repo.get(projectId);
    if (!project) {
      throw new NotFoundError("Project", projectId);
    }

    const level = project.approvalLevel ?? "default";
    this.cache.set(projectId, level);
    return level;
  }

  async setLevel(projectId: string, level: ApprovalLevel): Promise<void> {
    try {
      await this.repo.setApprovalLevel(projectId, level);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Project not found:")) {
        throw new NotFoundError("Project", projectId);
      }
      throw error;
    }
    this.cache.set(projectId, level);
  }

  async shouldBypass(projectId: string): Promise<boolean> {
    return (await this.getLevel(projectId)) === "bypass_approvals";
  }
}
