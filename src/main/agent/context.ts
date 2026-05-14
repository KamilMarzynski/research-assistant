import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getScholarHome } from "../paths";
import { createDefaultSkillRouter, type SkillRouter } from "./SkillRouter";

export async function loadSkillIndexXml(
  projectPath: string | undefined,
  router?: SkillRouter,
): Promise<string> {
  const r = router ?? createDefaultSkillRouter(projectPath);
  if (!router) await r.buildIndex();
  return r.toXml();
}

export async function loadSkillsByContent(
  skillNames: string[],
  projectName: string | undefined,
  router?: SkillRouter,
): Promise<string> {
  if (skillNames.length === 0) return "";

  const r = router ?? createDefaultSkillRouter(projectName);
  if (!router) await r.buildIndex();
  const parts: string[] = [];
  for (const name of skillNames) {
    try {
      const content = await r.loadSkillWithExtras(name);
      parts.push(content);
    } catch (err) {
      console.error(`[context] failed to load skill "${name}":`, err);
    }
  }
  return parts.join("\n\n---\n\n");
}

export async function buildSystemContext(
  projectPath: string,
  folderPath: string | null,
  skillIndexXml?: string,
): Promise<string> {
  const scholarHome = getScholarHome();
  const parts: string[] = [];

  // 0. Project directories
  parts.push(
    "<!-- Project Directories — Use these exact paths when reading or writing files -->",
    `## userProjectDir: ${folderPath ?? "not linked yet"}`,
    "This is the user's actual project directory — where their notes, documents, research materials, source files, drafts, and any work they do lives. When the user asks you to explore the project, read files, or write artifacts, use this path.",
    `## assistantDir: ${projectPath}`,
    "This is the assistant's workspace — where the assistant stores its own work: research outputs, generated reports, skills, project configuration (GOAL.md, FILES.md), and temporary workspace files.",
  );

  parts.push(
    "<!-- Tool Usage — Always fill the _description argument -->",
    'When calling any tool, always provide `_description` with a short, user-facing sentence describing what you are doing — e.g. "Searching for papers on prompt caching" or "Writing summary to research/output.md". This is shown to the user in real time.',
  );

  // 1. config.md
  try {
    const config = await readFile(join(scholarHome, "config.md"), "utf-8");
    if (config.trim()) {
      parts.push(
        "<!-- User Preferences (config.md) — Honor these in all responses -->",
        config.trim(),
      );
    }
  } catch {
    // not present yet
  }

  // 2. skills
  const skillIndex = skillIndexXml ?? (await loadSkillIndexXml(projectPath));
  if (skillIndex) {
    parts.push(
      "<!-- Available Skills — When a task matches a description, use read_file to load the full SKILL.md before applying it -->",
      skillIndex,
    );
  }

  // 3. GOAL.md
  let goalFile: string | undefined;
  try {
    goalFile = await readFile(join(projectPath, "GOAL.md"), "utf-8");
  } catch {
    // not yet discovered
  }

  // 4. FILES.md
  let filesFile: string | undefined;
  try {
    filesFile = await readFile(join(projectPath, "FILES.md"), "utf-8");
  } catch {
    // not yet discovered
  }

  if (goalFile?.trim()) {
    parts.push(
      "<!-- Project Goal (GOAL.md) — Keep all work aligned with this purpose -->",
      goalFile.trim(),
    );
  }
  if (filesFile?.trim()) {
    parts.push(
      "<!-- File Conventions (FILES.md) — Follow these when writing files -->",
      filesFile.trim(),
    );
  }

  if (!goalFile?.trim() || !filesFile?.trim()) {
    const goalPath = join(projectPath, "GOAL.md");
    const filesPath = join(projectPath, "FILES.md");
    parts.push(
      "<!-- Missing project configuration — Create GOAL.md and FILES.md to guide the assistant -->",
      "This project has no GOAL.md or FILES.md yet. If the user already described their project in their first message, use the `write_file` tool to create both files directly.",
      "If they have not yet described it, ask one question at a time:",
      "1. What is this project about? (write answer to GOAL.md)",
      "2. How are files organized? (write answer to FILES.md)",
      "3. Where should research outputs go? (add to FILES.md)",
      "4. Any naming conventions or folder structures? (add to FILES.md)",
      `After gathering answers, write GOAL.md to ${goalPath} and FILES.md to ${filesPath} using the write_file tool.`,
    );
  }

  // 5. App-level MEMORY.md
  try {
    const appMemory = await readFile(join(scholarHome, "app-memory", "MEMORY.md"), "utf-8");
    if (appMemory.trim()) {
      parts.push(
        "<!-- App Memory — Past observations worth remembering across all projects -->",
        appMemory.trim(),
      );
    }
  } catch {
    // not present yet
  }

  // 6. Project-level MEMORY.md
  let projectMemory: string | undefined;
  try {
    projectMemory = await readFile(join(projectPath, "MEMORY.md"), "utf-8");
  } catch {
    // not yet discovered
  }
  if (projectMemory?.trim()) {
    parts.push(
      "<!-- Project Memory — Past observations specific to this project -->",
      projectMemory.trim(),
    );
  }

  return parts.join("\n\n");
}

export { toSlug } from "../utils/slug";
