import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { Project } from "../../shared/types";
import { resolveProvider } from "../agent/model-provider";
import { AGENT_HOME_PATH_TOKEN, PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { NotFoundError } from "./errors";
import { SettingsService } from "./SettingsService";

@injectable()
export class ProjectService {
  constructor(
    @inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository,
    @inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string,
    @inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  async createProject(name: string, folderPath?: string | null): Promise<Project> {
    const settings = await this.settingsService.getSettings();
    const provider = resolveProvider({ settings });
    const modelOverride = `${provider.type}:${provider.model}`;

    const project = await this.repo.create({
      name,
      folderPath: folderPath ?? null,
      modelOverride,
      projectPath: null,
    });

    const projectPath = join(this.homePath, "projects", project.id);
    await mkdir(projectPath, { recursive: true });
    await this.repo.setProjectPath(project.id, projectPath);

    return { ...project, projectPath };
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
    const project = await this.getProject(id); // throws NotFoundError if missing
    await this.repo.delete(id);

    // Best-effort cleanup of app-managed filesystem artifacts
    await this.safeRm(join(this.homePath, "workspace", id));
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
