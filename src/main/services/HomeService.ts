import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { SkillInfo } from "../../shared/ipc-channels";
import { EVALUATE_RESEARCH_SKILL } from "../agent/builtin-skills";
import { getAgentsPath, getHomePath } from "../paths";
import { parseFrontmatter } from "../utils/frontmatter";
import { type ResearchTask, TaskPersistenceService } from "./TaskPersistenceService";

export type { ResearchTask };

@injectable()
export class HomeService {
  constructor(
    @inject(TaskPersistenceService)
    private readonly taskPersistence: TaskPersistenceService,
  ) {}

  getHomePath(): string {
    return getHomePath();
  }

  getAgentsPath(): string {
    return getAgentsPath();
  }

  async ensureDirectories(): Promise<void> {
    const home = this.getHomePath();
    const agents = this.getAgentsPath();

    const dirs = [
      home,
      join(home, "skills"),
      join(home, "workspace"),
      join(home, "projects"),
      join(home, "tasks"),
      join(home, "pending-tools"),
      join(agents, "skills"),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    await this.copyBuiltinSkillsIfNeeded();
  }

  async isFirstRun(): Promise<boolean> {
    try {
      await access(join(this.getHomePath(), "config.md"));
      return false;
    } catch {
      return true;
    }
  }

  async ensureWorkspaceForProject(projectId: string): Promise<string> {
    const dir = join(this.getHomePath(), "workspace", projectId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  // --- Task persistence delegation ---

  async saveTask(task: ResearchTask): Promise<void> {
    return this.taskPersistence.saveTask(task);
  }

  async deleteTask(taskId: string): Promise<void> {
    return this.taskPersistence.deleteTask(taskId);
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    return this.taskPersistence.getInProgressTasks();
  }

  async updateTaskStatus(
    taskId: string,
    status: "pending" | "in_progress" | "complete" | "failed",
    error?: string,
  ): Promise<void> {
    return this.taskPersistence.updateTaskStatus(taskId, status, error);
  }

  async migrateTasksFromJson(): Promise<void> {
    return this.taskPersistence.migrateTasksFromJson();
  }

  // --- Pending tool management ---

  async savePendingTool(name: string, skillContent: string, script?: string): Promise<void> {
    const dir = join(this.getHomePath(), "pending-tools", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
    if (script) {
      const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
      await writeFile(join(dir, `script${ext}`), script, "utf-8");
    }
  }

  async getPendingTools(): Promise<Array<{ name: string; skillContent: string }>> {
    const dir = join(this.getHomePath(), "pending-tools");
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const tools: Array<{ name: string; skillContent: string }> = [];
    for (const name of entries) {
      try {
        const skillContent = await readFile(join(dir, name, "SKILL.md"), "utf-8");
        tools.push({ name, skillContent });
      } catch (err) {
        console.error(`[HomeService] getPendingTools: skipping malformed entry ${name}:`, err);
      }
    }
    return tools;
  }

  async approvePendingTool(name: string): Promise<void> {
    const src = join(this.getHomePath(), "pending-tools", name);
    const dst = join(this.getHomePath(), "skills", name);
    await rename(src, dst);
  }

  async rejectPendingTool(name: string): Promise<void> {
    await rm(join(this.getHomePath(), "pending-tools", name), { recursive: true, force: true });
  }

  async getSkills(): Promise<SkillInfo[]> {
    const dir = join(this.getHomePath(), "skills");
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const skills: SkillInfo[] = [];
    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const skillMdPath = join(skillDir, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf-8");
        const meta = parseFrontmatter(content);
        const disabledFile = join(skillDir, ".disabled");
        let enabled = true;
        try {
          await access(disabledFile);
          enabled = false;
        } catch {
          // not disabled
        }
        skills.push({
          name: meta.name ?? entry,
          description: meta.description ?? "",
          enabled,
          content,
        });
      } catch (err) {
        console.error(`[HomeService] getSkills: skipping malformed entry ${entry}:`, err);
      }
    }
    return skills;
  }

  async toggleSkill(name: string, enabled: boolean): Promise<void> {
    const dir = join(this.getHomePath(), "skills", name);
    const disabledFile = join(dir, ".disabled");
    if (enabled) {
      try {
        await rm(disabledFile);
      } catch {
        /* already not disabled */
      }
    } else {
      await writeFile(disabledFile, "");
    }
  }

  async deleteSkill(name: string): Promise<void> {
    await rm(join(this.getHomePath(), "skills", name), { recursive: true, force: true });
  }

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    const builtins: Array<[name: string, content: string]> = [
      ["evaluate-research", EVALUATE_RESEARCH_SKILL],
    ];

    for (const [name, content] of builtins) {
      await this.ensureSkillFile(skillsDir, name, content);
    }
  }

  private async ensureSkillFile(skillsDir: string, name: string, content: string): Promise<void> {
    const skillDir = join(skillsDir, name);
    const skillMdPath = join(skillDir, "SKILL.md");
    try {
      await access(skillMdPath);
      // Already exists — skip
    } catch {
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillMdPath, content, "utf-8");
    }
  }
}
