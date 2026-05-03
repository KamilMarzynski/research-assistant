import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../utils/frontmatter";

const VALID_CATEGORIES = [
  "philosophy",
  "decision",
  "finding",
  "tool_reference",
  "project_convention",
] as const;

export type MemoryCategory = (typeof VALID_CATEGORIES)[number];

export interface SaveMemoryResult {
  path: string;
}

export interface ReadMemoryOptions {
  category?: string;
  query?: string;
  scope: "app" | "project" | "both";
  projectFolderPath?: string;
}

export class MemoryFileService {
  constructor(
    private readonly appMemoryPath: string,
    private readonly projectMemoryPath: string,
  ) {}

  async saveMemory(
    category: string,
    title: string,
    content: string,
    scope: "app" | "project",
    projectFolderPath?: string,
  ): Promise<SaveMemoryResult> {
    const safeCategory = VALID_CATEGORIES.includes(category as MemoryCategory)
      ? category
      : "finding";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const fileName = `${slug || "untitled"}.md`;

    const targetDir =
      scope === "app"
        ? join(this.appMemoryPath, safeCategory)
        : projectFolderPath
          ? join(projectFolderPath, ".agents", "memory", safeCategory)
          : join(this.projectMemoryPath, ".agents", "memory", safeCategory);

    // Attempt to write; fall back to app dir on failure
    let actualDir = targetDir;
    try {
      await mkdir(actualDir, { recursive: true });
    } catch {
      actualDir = join(this.appMemoryPath, safeCategory);
      await mkdir(actualDir, { recursive: true });
    }

    const filePath = join(actualDir, fileName);
    const frontmatter = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      `category: ${safeCategory}`,
      `scope: ${scope}`,
      `created_at: ${new Date().toISOString()}`,
      "---",
      "",
      content,
    ].join("\n");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, frontmatter, "utf-8");

    return { path: filePath };
  }

  async readMemory(options: ReadMemoryOptions): Promise<string> {
    const dirs: string[] = [];
    if (options.scope === "app" || options.scope === "both") {
      dirs.push(this.appMemoryPath);
    }
    if (options.scope === "project" || options.scope === "both") {
      dirs.push(join(this.projectMemoryPath, ".agents", "memory"));
      if (options.projectFolderPath) {
        dirs.push(join(options.projectFolderPath, ".agents", "memory"));
      }
    }

    const matches: Array<{
      title: string;
      category: string;
      createdAt: string;
      excerpt: string;
    }> = [];

    for (const dir of dirs) {
      try {
        await access(dir);
      } catch {
        continue;
      }

      const categories = await readdir(dir);
      for (const cat of categories) {
        const catDir = join(dir, cat);
        let files: string[];
        try {
          files = await readdir(catDir);
        } catch {
          continue;
        }

        for (const file of files.filter((f) => f.endsWith(".md"))) {
          const filePath = join(catDir, file);
          try {
            const raw = await readFile(filePath, "utf-8");
            const meta = parseFrontmatter(raw);
            const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

            const metaCategory = typeof meta.category === "string" ? meta.category : "";
            if (options.category && metaCategory !== options.category) continue;

            const metaTitle = typeof meta.title === "string" ? meta.title : "";
            const searchable = `${metaTitle} ${body}`;
            if (options.query && !searchable.toLowerCase().includes(options.query.toLowerCase()))
              continue;

            const metaCreatedAt = typeof meta.created_at === "string" ? meta.created_at : "";
            matches.push({
              title: metaTitle || file,
              category: metaCategory || cat,
              createdAt: metaCreatedAt,
              excerpt: body.slice(0, 200),
            });
          } catch {
            // skip malformed files
          }
        }
      }
    }

    if (matches.length === 0) {
      return `No memories found in this scope (${options.scope}).`;
    }

    const lines = matches.map(
      (m) => `**${m.title}** (${m.category}) — ${m.createdAt}\n${m.excerpt}`,
    );
    return lines.join("\n\n---\n\n");
  }
}
