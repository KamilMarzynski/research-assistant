import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { SkillInfo } from "../../shared/ipc-channels";
import { AGENT_HOME_PATH_TOKEN } from "../di/tokens";
import { parseFrontmatter } from "../utils/frontmatter";

@injectable()
export class SkillManagementService {
  constructor(@inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string) {}

  private get skillsDir(): string {
    return join(this.homePath, "skills");
  }

  async getSkills(): Promise<SkillInfo[]> {
    const dir = this.skillsDir;
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
        const protectedFile = join(skillDir, ".protected");
        let isProtected = false;
        try {
          await access(protectedFile);
          isProtected = true;
        } catch {
          // not protected
        }
        skills.push({
          name: meta.name ?? entry,
          description: meta.description ?? "",
          enabled,
          protected: isProtected,
          content,
        });
      } catch (err) {
        console.error(
          `[SkillManagementService] getSkills: skipping malformed entry ${entry}:`,
          err,
        );
      }
    }
    return skills;
  }

  async toggleSkill(name: string, enabled: boolean): Promise<void> {
    const dir = join(this.skillsDir, name);
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
    const dir = join(this.skillsDir, name);
    const protectedFile = join(dir, ".protected");
    let isProtected = false;
    try {
      await access(protectedFile);
      isProtected = true;
    } catch {
      // not protected
    }
    if (isProtected) {
      throw new Error(`Skill "${name}" is protected and cannot be deleted.`);
    }
    await rm(dir, { recursive: true, force: true });
  }
}
