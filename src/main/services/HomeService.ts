import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { injectable } from "tsyringe";
import {
  DISCOVER_PROJECT_SKILL,
  EVALUATE_RESEARCH_SKILL,
  START_RESEARCH_SKILL,
} from "../agent/builtin-skills";

export interface ResearchTask {
  taskId: string;
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
  startedAt: string;
}

@injectable()
export class HomeService {
  getHomePath(): string {
    return join(homedir(), ".research-assistant");
  }

  getAgentsPath(): string {
    return join(homedir(), ".agents");
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

  async saveTask(task: ResearchTask): Promise<void> {
    const dir = join(this.getHomePath(), "tasks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${task.taskId}.json`), JSON.stringify(task, null, 2), "utf-8");
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      await unlink(join(this.getHomePath(), "tasks", `${taskId}.json`));
    } catch {
      // already gone — idempotent
    }
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    const dir = join(this.getHomePath(), "tasks");
    let entries: string[] = [];
    try {
      entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    } catch {
      return [];
    }
    const tasks: ResearchTask[] = [];
    for (const entry of entries) {
      try {
        const raw = await readFile(join(dir, entry), "utf-8");
        tasks.push(JSON.parse(raw) as ResearchTask);
      } catch {
        // skip malformed file
      }
    }
    return tasks;
  }

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    const builtins: Array<[string, string]> = [
      ["start_research", START_RESEARCH_SKILL],
      ["discover_project", DISCOVER_PROJECT_SKILL],
      ["evaluate-research", EVALUATE_RESEARCH_SKILL],
    ];

    for (const [name, content] of builtins) {
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
}
