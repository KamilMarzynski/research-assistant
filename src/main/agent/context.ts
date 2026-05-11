import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getScholarHome } from "../paths";
import { createDefaultSkillRouter } from "./SkillRouter";

export async function loadSkillIndexXml(projectFolderPath: string | undefined): Promise<string> {
  const router = createDefaultSkillRouter(projectFolderPath);
  await router.buildIndex();
  return router.toXml();
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

  const router = createDefaultSkillRouter(projectFolderPath);
  await router.buildIndex();
  const parts: string[] = [];
  for (const name of skillNames) {
    try {
      const content = await router.loadSkillWithExtras(name);
      parts.push(content);
    } catch (err) {
      console.error(`[context] failed to load skill "${name}":`, err);
    }
  }
  return parts.join("\n\n---\n\n");
}

export async function buildSystemContext(
  projectName: string,
  folderPath: string | undefined,
  skillIndexXml?: string,
): Promise<string> {
  const scholarHome = getScholarHome();
  const slug = toSlug(projectName);
  const parts: string[] = [];

  // 1. config.md
  try {
    const config = await readFile(join(scholarHome, "config.md"), "utf-8");
    if (config.trim()) {
      parts.push("<!-- User working style (config.md) -->", config.trim());
    }
  } catch {
    // not present yet
  }

  // 2. skills
  const skillIndex = skillIndexXml ?? (await loadSkillIndexXml(folderPath));
  if (skillIndex) parts.push(skillIndex);

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
      agentsFile = await readFile(join(scholarHome, "projects", slug, "AGENTS.md"), "utf-8");
    } catch {
      // not yet discovered
    }
  }
  if (agentsFile?.trim()) {
    parts.push("<!-- Project context (AGENTS.md) -->", agentsFile.trim());
  } else {
    const agentsPath = folderPath
      ? `${folderPath}/AGENTS.md`
      : `~/.research-assistant/projects/${slug}/AGENTS.md`;
    parts.push(
      "This project has no AGENTS.md yet. If the user already described their project in their first message, use the `write_file` tool to create the AGENTS.md file directly.",
      "If they have not yet described it, ask them one question at a time:",
      "1. What is this project about?",
      "2. How are files organized?",
      "3. Where should research outputs go?",
      "4. Any naming conventions or folder structures?",
      `After gathering answers, write the AGENTS.md file to ${agentsPath} using the write_file tool.`,
    );
  }

  // 4. App-level MEMORY.md
  try {
    const appMemory = await readFile(join(scholarHome, "app-memory", "MEMORY.md"), "utf-8");
    if (appMemory.trim()) {
      parts.push("<!-- App-level memory (MEMORY.md) -->", appMemory.trim());
    }
  } catch {
    // not present yet
  }

  // 5. Project-level MEMORY.md
  let projectMemory: string | undefined;
  if (folderPath) {
    try {
      projectMemory = await readFile(join(folderPath, "MEMORY.md"), "utf-8");
    } catch {
      // not in linked folder, try fallback
    }
  }
  if (!projectMemory) {
    try {
      projectMemory = await readFile(join(scholarHome, "projects", slug, "MEMORY.md"), "utf-8");
    } catch {
      // not yet discovered
    }
  }
  if (projectMemory?.trim()) {
    parts.push("<!-- Project memory (MEMORY.md) -->", projectMemory.trim());
  }

  return parts.join("\n\n");
}
