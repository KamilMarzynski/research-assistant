import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { SkillInfo } from "../../shared/ipc-channels";
import { EVALUATE_RESEARCH_SKILL } from "../agent/builtin-skills";
import { getAgentsPath, getHomePath } from "../paths";
import { SkillManagementService } from "./SkillManagementService";
import { type ResearchTask, TaskPersistenceService } from "./TaskPersistenceService";
import { ToolApprovalService } from "./ToolApprovalService";

export type { ResearchTask };

@injectable()
export class HomeService {
  constructor(
    @inject(TaskPersistenceService)
    private readonly taskPersistence: TaskPersistenceService,
    @inject(SkillManagementService)
    private readonly skillManagement: SkillManagementService,
    @inject(ToolApprovalService)
    private readonly toolApproval: ToolApprovalService,
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

  // --- Tool approval delegation ---

  async savePendingTool(name: string, skillContent: string, script?: string): Promise<void> {
    return this.toolApproval.savePendingTool(name, skillContent, script);
  }

  async getPendingTools(): Promise<Array<{ name: string; skillContent: string }>> {
    return this.toolApproval.getPendingTools();
  }

  async approvePendingTool(name: string): Promise<void> {
    return this.toolApproval.approvePendingTool(name);
  }

  async rejectPendingTool(name: string): Promise<void> {
    return this.toolApproval.rejectPendingTool(name);
  }

  // --- Skill management delegation ---

  async getSkills(): Promise<SkillInfo[]> {
    return this.skillManagement.getSkills();
  }

  async toggleSkill(name: string, enabled: boolean): Promise<void> {
    return this.skillManagement.toggleSkill(name, enabled);
  }

  async deleteSkill(name: string): Promise<void> {
    return this.skillManagement.deleteSkill(name);
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
