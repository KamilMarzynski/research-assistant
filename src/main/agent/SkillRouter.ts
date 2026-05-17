import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { watch } from "chokidar";
import { getScholarHome } from "../paths";
import { parseFrontmatter } from "../utils/frontmatter";
export interface SkillMeta {
  name: string;
  description: string;
  location: string;
}

export interface SkillIndex {
  skills: SkillMeta[];
  lastScan: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class SkillRouter {
  private index: SkillIndex = { skills: [], lastScan: 0 };
  private watchers: ReturnType<typeof watch>[] = [];

  constructor(
    private readonly skillDirs: string[],
    private readonly onChange?: (skillName: string, summary: string) => void,
  ) {}

  async buildIndex(): Promise<SkillIndex> {
    const byName = new Map<string, SkillMeta>();
    for (const dir of this.skillDirs) {
      const skills = await this.readSkillsFromDir(dir);
      for (const skill of skills) {
        byName.set(skill.name, skill);
      }
    }
    this.index = {
      skills: Array.from(byName.values()),
      lastScan: Date.now(),
    };
    return this.index;
  }

  getIndex(): SkillIndex {
    return this.index;
  }

  toXml(): string {
    if (this.index.skills.length === 0) return "";
    const lines = [
      "<available_skills>",
      "  To use a skill, call the read_skill tool with the skill name.",
    ];
    for (const skill of this.index.skills) {
      lines.push(
        `  <skill name="${escapeXml(skill.name)}" description="${escapeXml(skill.description)}" />`,
      );
    }
    lines.push("</available_skills>");
    return lines.join("\n");
  }

  async loadSkill(name: string): Promise<string> {
    const skill = this.index.skills.find((s) => s.name === name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found in index`);
    }
    return readFile(skill.location, "utf-8");
  }

  async loadSkillWithExtras(name: string): Promise<string> {
    const skill = this.index.skills.find((s) => s.name === name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found in index`);
    }
    const skillDir = dirname(skill.location);
    const entries = await readdir(skillDir);
    const mdFiles = entries
      .filter((e) => e.endsWith(".md"))
      .sort((a, b) => {
        if (a === "SKILL.md") return -1;
        if (b === "SKILL.md") return 1;
        return a.localeCompare(b);
      });
    const contents: string[] = [];
    for (const file of mdFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      contents.push(content.trim());
    }
    return contents.join("\n\n---\n\n");
  }

  startWatching(): void {
    this.stopWatching();
    for (const dir of this.skillDirs) {
      try {
        const watcher = watch(dir, {
          ignored: /(^|[/\\])\../,
          persistent: true,
          depth: 2,
        });

        const onSkillFileEvent = async (filePath: string) => {
          if (!filePath.endsWith("SKILL.md")) return;
          await this.buildIndex();
          const changedSkill = this.index.skills.find((s) => s.location === filePath);
          if (changedSkill && this.onChange) {
            this.onChange(changedSkill.name, `Description: ${changedSkill.description}`);
          }
        };

        watcher.on("add", onSkillFileEvent);
        watcher.on("change", onSkillFileEvent);
        watcher.on("unlink", onSkillFileEvent);
        this.watchers.push(watcher);
      } catch (err) {
        console.error(`[SkillRouter] Failed to watch ${dir}:`, err);
      }
    }
  }

  stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  private async readSkillsFromDir(dir: string): Promise<SkillMeta[]> {
    const skillsDir = join(dir, "skills");
    let targetDir = dir;
    try {
      await access(skillsDir);
      targetDir = skillsDir;
    } catch {
      // no skills subdir — read from dir directly (global dirs already end in /skills)
    }

    let entries: string[] = [];
    try {
      entries = await readdir(targetDir);
    } catch {
      return [];
    }

    const skills: SkillMeta[] = [];
    for (const entry of entries) {
      const skillDirPath = join(targetDir, entry);
      const skillMdPath = join(skillDirPath, "SKILL.md");
      try {
        try {
          await access(join(skillDirPath, ".disabled"));
          continue;
        } catch {
          // not disabled, proceed
        }
        const content = await readFile(skillMdPath, "utf-8");
        const meta = parseFrontmatter(content);
        if (
          meta.name &&
          typeof meta.name === "string" &&
          meta.description &&
          typeof meta.description === "string"
        ) {
          skills.push({
            name: meta.name,
            description: meta.description,
            location: skillMdPath,
          });
        }
      } catch {
        // Ignore malformed entries (no SKILL.md, unreadable, etc.)
      }
    }
    return skills;
  }
}

export function createDefaultSkillRouter(
  projectPath: string | undefined,
  onChange?: (skillName: string, summary: string) => void,
): SkillRouter {
  const dirs = [join(getScholarHome(), "skills")];
  if (projectPath) {
    dirs.push(join(projectPath, "skills"));
  }
  return new SkillRouter(dirs, onChange);
}
