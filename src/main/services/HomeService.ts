import { access, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import { parse } from "yaml";
import type { SkillInfo } from "../../shared/ipc-channels";
import {
  DISCOVER_PROJECT_SKILL,
  EVALUATE_RESEARCH_SKILL,
  START_RESEARCH_SKILL,
} from "../agent/builtin-skills";
import type { DrizzleDB } from "../db/client";
import { tasks } from "../db/schema";
import { DB_TOKEN } from "../di/tokens";
import { getAgentsPath, getHomePath } from "../paths";

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
  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}
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

  async saveTask(task: ResearchTask): Promise<void> {
    await this.db
      .insert(tasks)
      .values({
        id: task.taskId,
        projectId: task.projectId,
        projectName: task.projectName,
        query: task.query,
        folderPath: task.folderPath,
        status: "in_progress",
        createdAt: new Date(task.startedAt),
        updatedAt: new Date(task.startedAt),
      })
      .onConflictDoNothing();
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.status, "in_progress"));
    return rows.map((r) => ({
      taskId: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      query: r.query,
      folderPath: r.folderPath,
      startedAt: new Date(r.createdAt).toISOString(),
    }));
  }

  async updateTaskStatus(
    taskId: string,
    status: "pending" | "in_progress" | "complete" | "failed",
    error?: string,
  ): Promise<void> {
    await this.db
      .update(tasks)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
  }

  async migrateTasksFromJson(): Promise<void> {
    const dir = join(this.getHomePath(), "tasks");
    let entries: string[] = [];
    try {
      entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    } catch {
      return; // no JSON tasks directory — nothing to migrate
    }
    for (const entry of entries) {
      try {
        const raw = await readFile(join(dir, entry), "utf-8");
        const task = JSON.parse(raw) as ResearchTask;
        await this.saveTask(task);
        await unlink(join(dir, entry));
      } catch (err) {
        console.error(`[HomeService] migrateTasksFromJson: skipping malformed file ${entry}:`, err);
      }
    }
  }

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
        const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
        const meta = match ? (parse(match[1]) as { name?: string; description?: string }) : {};
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
