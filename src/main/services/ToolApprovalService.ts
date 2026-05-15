import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import { AGENT_HOME_PATH_TOKEN } from "../di/tokens";

@injectable()
export class ToolApprovalService {
  constructor(@inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string) {}

  private get pendingToolsDir(): string {
    return join(this.homePath, "pending-tools");
  }

  private get skillsDir(): string {
    return join(this.homePath, "skills");
  }

  private assertSafePathComponent(value: string, field: string): void {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
      throw new Error(
        `Invalid ${field} "${value}": only lowercase letters, digits, and hyphens allowed, must start with a letter or digit`,
      );
    }
  }

  async savePendingTool(name: string, skillContent: string, script?: string): Promise<void> {
    this.assertSafePathComponent(name, "name");
    const dir = join(this.pendingToolsDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
    if (script) {
      const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
      await writeFile(join(dir, `script${ext}`), script, "utf-8");
    }
  }

  async getPendingTools(): Promise<Array<{ name: string; skillContent: string }>> {
    const dir = this.pendingToolsDir;
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
        console.error(
          `[ToolApprovalService] getPendingTools: skipping malformed entry ${name}:`,
          err,
        );
      }
    }
    return tools;
  }

  async approvePendingTool(name: string): Promise<void> {
    this.assertSafePathComponent(name, "name");
    const src = join(this.pendingToolsDir, name);
    const dst = join(this.skillsDir, name);
    await rename(src, dst);
  }

  async rejectPendingTool(name: string): Promise<void> {
    this.assertSafePathComponent(name, "name");
    await rm(join(this.pendingToolsDir, name), { recursive: true, force: true });
  }

  private projectPendingToolsDir(slug: string): string {
    return join(this.homePath, "projects", slug, "pending-tools");
  }

  private projectSkillsDir(slug: string): string {
    return join(this.homePath, "projects", slug, "skills");
  }

  async saveProjectPendingTool(
    slug: string,
    name: string,
    skillContent: string,
    script?: string,
  ): Promise<void> {
    this.assertSafePathComponent(slug, "slug");
    this.assertSafePathComponent(name, "name");
    const dir = join(this.projectPendingToolsDir(slug), name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
    if (script) {
      const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
      await writeFile(join(dir, `script${ext}`), script, "utf-8");
    }
  }

  async getProjectPendingTools(
    slug: string,
  ): Promise<Array<{ name: string; skillContent: string }>> {
    this.assertSafePathComponent(slug, "slug");
    const dir = this.projectPendingToolsDir(slug);
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
        console.error(
          `[ToolApprovalService] getProjectPendingTools: skipping malformed entry ${name}:`,
          err,
        );
      }
    }
    return tools;
  }

  async approveProjectPendingTool(slug: string, name: string): Promise<void> {
    this.assertSafePathComponent(slug, "slug");
    this.assertSafePathComponent(name, "name");
    const src = join(this.projectPendingToolsDir(slug), name);
    const dst = join(this.projectSkillsDir(slug), name);
    await rename(src, dst);
  }

  async rejectProjectPendingTool(slug: string, name: string): Promise<void> {
    this.assertSafePathComponent(slug, "slug");
    this.assertSafePathComponent(name, "name");
    await rm(join(this.projectPendingToolsDir(slug), name), { recursive: true, force: true });
  }
}
