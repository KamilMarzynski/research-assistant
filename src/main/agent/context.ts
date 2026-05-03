import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentsHome, getResearchAssistantHome } from "../paths";
import { parseFrontmatter } from "../utils/frontmatter";

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
    const skillDirPath = join(dir, entry);
    const skillMdPath = join(skillDirPath, "SKILL.md");
    try {
      // Skip disabled skills
      try {
        await access(join(skillDirPath, ".disabled"));
        continue;
      } catch {
        // not disabled, proceed
      }
      const content = await readFile(skillMdPath, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name && meta.description) {
        skills.push({ name: meta.name, description: meta.description, location: skillMdPath });
      }
    } catch (err) {
      console.error(`[context] readSkillsFromDir: skipping malformed entry ${entry}:`, err);
    }
  }
  return skills;
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
  // Load in priority order — later entries win on name collision
  const agentsHome = getAgentsHome();
  const raHome = getResearchAssistantHome();
  const dirs = [
    join(agentsHome, "skills"),
    join(raHome, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath ? [join(projectFolderPath, ".research-assistant", "skills")] : []),
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

export async function loadSkillsByContent(
  skillNames: string[],
  projectFolderPath: string | undefined,
): Promise<string> {
  if (skillNames.length === 0) return "";

  // Same priority order as loadSkills — later dirs have higher priority
  const agentsHome = getAgentsHome();
  const raHome = getResearchAssistantHome();
  const dirs = [
    join(agentsHome, "skills"),
    join(raHome, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath ? [join(projectFolderPath, ".research-assistant", "skills")] : []),
  ];

  const parts: string[] = [];
  for (const name of skillNames) {
    // Search highest-priority dirs first
    for (const dir of [...dirs].reverse()) {
      const skillPath = join(dir, name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        parts.push(content.trim());
        break;
      } catch {
        // not in this dir, try next
      }
    }
  }

  return parts.join("\n\n---\n\n");
}

export async function buildSystemContext(
  _projectId: string,
  projectName: string,
  folderPath: string | undefined,
): Promise<string> {
  const raHome = getResearchAssistantHome();
  const slug = toSlug(projectName);
  const parts: string[] = [];

  // 1. config.md
  try {
    const config = await readFile(join(raHome, "config.md"), "utf-8");
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
  let agentsFile: string | undefined;
  if (folderPath) {
    try {
      agentsFile = await readFile(join(folderPath, "AGENTS.md"), "utf-8");
    } catch {
      // not in linked folder, try next
    }
  }
  if (!agentsFile) {
    try {
      agentsFile = await readFile(join(raHome, "projects", slug, "AGENTS.md"), "utf-8");
    } catch {
      // not yet discovered
    }
  }
  if (agentsFile?.trim()) {
    parts.push("<!-- Project context (AGENTS.md) -->", agentsFile.trim());
  } else {
    parts.push(
      "This project has no AGENTS.md yet. Ask the user to describe:",
      "1. What is this project about?",
      "2. How are files organized?",
      "3. Where should research outputs go?",
      "4. Any naming conventions or folder structures?",
      `After getting answers, write the AGENTS.md file to ~/.research-assistant/projects/${slug}/AGENTS.md using the write_file tool.`,
    );
  }

  return parts.join("\n\n");
}
