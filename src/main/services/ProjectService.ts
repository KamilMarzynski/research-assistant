import { access } from "node:fs/promises";
import { inject, injectable } from "tsyringe";
import type { Project } from "../../shared/types";
import { PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { NotFoundError } from "./errors";

@injectable()
export class ProjectService {
  constructor(@inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository) {}

  async createProject(name: string, folderPath?: string | null): Promise<Project> {
    return this.repo.create({ name, folderPath: folderPath ?? null });
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
    await this.getProject(id); // throws NotFoundError if missing
    await this.repo.delete(id);
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
}
