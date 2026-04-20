import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { injectable } from "tsyringe";
import { DISCOVER_PROJECT_SKILL, START_RESEARCH_SKILL } from "../agent/builtin-skills";

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

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    let entries: string[] = [];
    try {
      entries = await readdir(skillsDir);
    } catch {
      // dir doesn't exist yet — ensureDirectories just created it
    }
    if (entries.length > 0) return;

    const builtins: Array<[string, string]> = [
      ["start_research", START_RESEARCH_SKILL],
      ["discover_project", DISCOVER_PROJECT_SKILL],
    ];

    for (const [name, content] of builtins) {
      const skillDir = join(skillsDir, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
    }
  }
}
