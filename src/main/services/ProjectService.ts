import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { ApprovalLevel, Project } from "../../shared/types";
import { resolveProvider } from "../agent/model-provider";
import { AGENT_HOME_PATH_TOKEN, PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { generateProjectSlug } from "../utils/slug";
import { ApprovalPolicyService } from "./ApprovalPolicyService";
import { NotFoundError } from "./errors";
import { SettingsService } from "./SettingsService";

export type ProjectApprovalResolutionResult =
  | { status: "resolved"; resolvedCount: number }
  | { status: "no_pending_approvals" }
  | { status: "failed"; error: string }
  | { status: "unsupported" };

export interface ProjectApprovalResolver {
  resolvePendingApprovals(projectId: string): Promise<ProjectApprovalResolutionResult>;
}

export interface ProjectApprovalLevelUpdateResult {
  approvalLevel: ApprovalLevel;
  approvalsAutoResolved: boolean;
  resolution: ProjectApprovalResolutionResult | null;
}

@injectable()
export class ProjectService {
  constructor(
    @inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository,
    @inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string,
    @inject(SettingsService) private readonly settingsService: SettingsService,
    @inject(ApprovalPolicyService)
    private readonly approvalPolicyService: ApprovalPolicyService,
  ) {}

  async createProject(name: string, folderPath?: string | null): Promise<Project> {
    const settings = await this.settingsService.getSettings();
    const provider = resolveProvider({ settings });
    const modelOverride = `${provider.type}:${provider.model}`;

    const project = await this.repo.create({
      name,
      slug: null,
      folderPath: folderPath ?? null,
      modelOverride,
      approvalLevel: "default",
      projectPath: null,
    });

    const slug = generateProjectSlug(project.name, project.id);
    const projectPath = join(this.homePath, "projects", slug);
    await mkdir(projectPath, { recursive: true });

    await Promise.all([
      this.repo.setProjectPath(project.id, projectPath),
      this.repo.setSlug(project.id, slug),
    ]);

    return { ...project, slug, projectPath };
  }

  async listProjects(): Promise<Project[]> {
    return this.repo.list();
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.repo.get(id);
    if (!project) throw new NotFoundError("Project", id);
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    await this.repo.delete(id);

    if (project.projectPath) {
      await this.safeRm(project.projectPath);
    }
  }

  private async safeRm(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Ignore errors for best-effort cleanup
    }
  }

  async linkFolder(id: string, folderPath: string): Promise<void> {
    await this.getProject(id); // throws NotFoundError if missing
    try {
      await access(folderPath);
    } catch {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    await this.repo.linkFolder(id, folderPath);
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.getProject(id);
    await this.repo.rename(id, name);
  }

  async unlinkFolder(id: string): Promise<void> {
    await this.getProject(id);
    await this.repo.unlinkFolder(id);
  }

  async setModelOverride(id: string, modelOverride: string | null): Promise<void> {
    await this.getProject(id);
    await this.repo.setModelOverride(id, modelOverride);
  }

  async setApprovalLevel(id: string, approvalLevel: ApprovalLevel): Promise<void> {
    await this.approvalPolicyService.setLevel(id, approvalLevel);
  }

  async transitionApprovalLevel(
    id: string,
    approvalLevel: ApprovalLevel,
    approvalResolver: ProjectApprovalResolver,
  ): Promise<ProjectApprovalLevelUpdateResult> {
    await this.setApprovalLevel(id, approvalLevel);

    if (approvalLevel !== "bypass_approvals") {
      return {
        approvalLevel,
        approvalsAutoResolved: false,
        resolution: null,
      };
    }

    const resolution = await this.resolvePendingApprovalsSafely(id, approvalResolver);
    return {
      approvalLevel,
      approvalsAutoResolved: resolution.status === "resolved",
      resolution,
    };
  }

  private async resolvePendingApprovalsSafely(
    id: string,
    approvalResolver: ProjectApprovalResolver,
  ): Promise<ProjectApprovalResolutionResult> {
    try {
      return await approvalResolver.resolvePendingApprovals(id);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async updateAllProjectsModel(): Promise<void> {
    const settings = await this.settingsService.getSettings();
    const provider = resolveProvider({ settings });
    const modelOverride = `${provider.type}:${provider.model}`;

    const allProjects = await this.repo.list();
    for (const project of allProjects) {
      await this.repo.setModelOverride(project.id, modelOverride);
    }
  }
}
