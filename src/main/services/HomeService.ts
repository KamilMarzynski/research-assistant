import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { injectable } from "tsyringe";
import { BUILTIN_SKILLS } from "../agent/builtin-skills";
import { getHomePath } from "../paths";

@injectable()
export class HomeService {
  getHomePath(): string {
    return getHomePath();
  }

  async ensureDirectories(): Promise<void> {
    const home = this.getHomePath();

    const dirs = [home, join(home, "skills"), join(home, "projects"), join(home, "tasks")];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    await this.copyBuiltinSkillsIfNeeded();
  }

  async ensureWorkspaceForProject(slug: string): Promise<string> {
    const home = this.getHomePath();
    const workspaceDir = join(home, "projects", slug, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    return workspaceDir;
  }

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    for (const [name, files] of Object.entries(BUILTIN_SKILLS)) {
      await this.ensureSkillDir(skillsDir, name, files);
    }
  }

  private async ensureSkillDir(
    skillsDir: string,
    name: string,
    files: Record<string, string>,
  ): Promise<void> {
    const skillDir = join(skillsDir, name);
    let needsWrite = false;
    for (const fileName of Object.keys(files)) {
      try {
        await access(join(skillDir, fileName));
      } catch {
        needsWrite = true;
        break;
      }
    }
    if (needsWrite) {
      await mkdir(skillDir, { recursive: true });
      for (const [fileName, content] of Object.entries(files)) {
        await writeFile(join(skillDir, fileName), content, "utf-8");
      }
    }
    // Mark builtin skills as protected so they cannot be deleted
    const protectedPath = join(skillDir, ".protected");
    try {
      await access(protectedPath);
    } catch {
      await writeFile(protectedPath, "", "utf-8");
    }
  }
}
