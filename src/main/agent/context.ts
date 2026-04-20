import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

interface SkillMeta {
  name: string;
  description: string;
  location: string;
}

async function readSkillsFromDir(dir: string): Promise<SkillMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const entry of entries) {
    const skillMdPath = join(dir, entry, "SKILL.md");
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name && meta.description) {
        skills.push({ name: meta.name, description: meta.description, location: skillMdPath });
      }
    } catch {
      // skip malformed or missing SKILL.md
    }
  }
  return skills;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!match) return {};
  try {
    return (parse(match[1]) as { name?: string; description?: string }) ?? {};
  } catch {
    return {};
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function loadSkills(projectFolderPath: string | undefined): Promise<string> {
  const home = join(homedir(), ".research-assistant");
  const agents = join(homedir(), ".agents");

  // Load in priority order — later entries win on name collision
  const dirs = [
    join(agents, "skills"),
    join(home, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath
      ? [join(projectFolderPath, ".research-assistant", "skills")]
      : []),
  ];

  const byName = new Map<string, SkillMeta>();
  for (const dir of dirs) {
    const skills = await readSkillsFromDir(dir);
    for (const skill of skills) {
      byName.set(skill.name, skill);
    }
  }

  if (byName.size === 0) return "";

  const lines = ["<available_skills>"];
  for (const skill of byName.values()) {
    lines.push(
      `  <skill>`,
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.location)}</location>`,
      `  </skill>`,
    );
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function buildSystemContext(
  _projectId: string,
  projectName: string,
  folderPath: string | undefined,
): Promise<string> {
  const home = join(homedir(), ".research-assistant");
  const slug = toSlug(projectName);
  const parts: string[] = [];

  // 1. config.md
  try {
    const config = await readFile(join(home, "config.md"), "utf-8");
    if (config.trim()) {
      parts.push("<!-- User working style (config.md) -->", config.trim());
    }
  } catch {
    // not present yet
  }

  // 2. skills
  const skillsXml = await loadSkills(folderPath);
  if (skillsXml) parts.push(skillsXml);

  // 3. AGENTS.md
  try {
    const agents = await readFile(join(home, "projects", slug, "AGENTS.md"), "utf-8");
    if (agents.trim()) {
      parts.push("<!-- Project context (AGENTS.md) -->", agents.trim());
    }
  } catch {
    // not yet discovered
  }

  return parts.join("\n\n");
}
