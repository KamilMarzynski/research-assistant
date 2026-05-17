import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { parseFrontmatter } from "../../utils/frontmatter";

export interface SkillFileInfo {
  name: string;
  path: string;
}

export interface ReadSkillResult {
  name: string;
  scope: "project" | "global";
  body: string;
  files: SkillFileInfo[];
}

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;

const readSkillParameters = Type.Object({
  skillName: Type.String({
    description: "Name of the skill to read. Project skills override global skills.",
  }),
});

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]+?\r?\n---\r?\n?/, "").trim();
}

async function readSkillDirs(skillsDir: string): Promise<string[]> {
  try {
    return (await readdir(skillsDir, "utf-8")).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function findSkillDir(
  skillsDir: string,
  skillName: string,
): Promise<{ dir: string; skillMdPath: string } | null> {
  const entries = await readSkillDirs(skillsDir);
  let directoryMatch: { dir: string; skillMdPath: string } | null = null;

  for (const entry of entries) {
    if (entry.startsWith(".")) {
      continue;
    }

    const skillDir = join(skillsDir, entry);
    const skillMdPath = join(skillDir, "SKILL.md");
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name === skillName) {
        return { dir: skillDir, skillMdPath };
      }
      if (entry === skillName) {
        directoryMatch = { dir: skillDir, skillMdPath };
      }
    } catch {
      // Ignore unreadable or malformed entries.
    }
  }

  return directoryMatch;
}

async function listSkillFiles(skillDir: string): Promise<SkillFileInfo[]> {
  const files: SkillFileInfo[] = [];

  async function readDirEntries(dir: string): Promise<Dirent[]> {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  async function walk(dir: string): Promise<void> {
    const entries = await readDirEntries(dir);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (entry.isFile() && entry.name !== "SKILL.md") {
        files.push({
          name: relative(skillDir, path),
          path,
        });
      }
    }
  }

  await walk(skillDir);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function createReadSkillTool(
  projectSlug: string,
  homePath: string,
): AgentTool<typeof readSkillParameters, ReadSkillResult> {
  return {
    name: "read_skill",
    label: "Read skill",
    description:
      "Read a skill by name. Project-scoped skills take precedence over global skills. " +
      "Returns the main SKILL.md body without frontmatter and lists other files in the skill directory.",
    parameters: readSkillParameters,
    execute: async (_id, { skillName }): Promise<AgentToolResult<ReadSkillResult>> => {
      if (!skillNamePattern.test(skillName)) {
        throw new Error(
          `Invalid skillName "${skillName}": only lowercase letters, digits, and hyphens allowed`,
        );
      }

      const candidates = [
        { scope: "project" as const, dir: join(homePath, "projects", projectSlug, "skills") },
        { scope: "global" as const, dir: join(homePath, "skills") },
      ];

      for (const candidate of candidates) {
        const match = await findSkillDir(candidate.dir, skillName);
        if (!match) continue;

        const content = await readFile(match.skillMdPath, "utf-8");
        const result: ReadSkillResult = {
          name: skillName,
          scope: candidate.scope,
          body: stripFrontmatter(content),
          files: await listSkillFiles(match.dir),
        };

        const fileList =
          result.files.length === 0
            ? "No additional files."
            : result.files.map((file) => `- ${file.name}: ${file.path}`).join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Skill: ${skillName}`,
                `Scope: ${candidate.scope}`,
                "",
                result.body,
                "",
                "Additional files:",
                fileList,
              ].join("\n"),
            },
          ],
          details: result,
        };
      }

      throw new Error(`Skill "${skillName}" not found`);
    },
  };
}
