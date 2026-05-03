import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { watch } from "chokidar";
import { parseFrontmatter } from "../utils/frontmatter";

interface SkillManifest {
  [skillName: string]: string;
}

export interface SkillWatcherOptions {
  skillDirs: string[];
  emit: (event: { type: "skill:changed"; payload: { skillName: string; summary: string } }) => void;
  manifestPath: string;
}

export class SkillWatcherService {
  private watcher?: ReturnType<typeof watch>;
  private manifest: SkillManifest = {};

  constructor(private readonly opts: SkillWatcherOptions) {}

  async start(): Promise<void> {
    await this.loadManifest();

    if (this.opts.skillDirs.length === 0) return;

    this.watcher = watch(this.opts.skillDirs, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      depth: 2,
    });

    this.watcher.on("change", async (filePath) => {
      if (!filePath.endsWith("SKILL.md")) return;
      await this.handleSkillChange(filePath);
    });

    this.watcher.on("add", async (filePath) => {
      if (!filePath.endsWith("SKILL.md")) return;
      await this.handleSkillChange(filePath);
    });
  }

  stop(): void {
    this.watcher?.close();
  }

  private async loadManifest(): Promise<void> {
    try {
      const raw = await readFile(this.opts.manifestPath, "utf-8");
      this.manifest = JSON.parse(raw) as SkillManifest;
    } catch {
      this.manifest = {};
    }
  }

  private async saveManifest(): Promise<void> {
    await writeFile(this.opts.manifestPath, JSON.stringify(this.manifest, null, 2), "utf-8");
  }

  private async handleSkillChange(filePath: string): Promise<void> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const meta = parseFrontmatter(raw);
      const name = meta.name || "unknown";
      const description = meta.description || "";
      const hashInput = `${name}|${description}|${raw.slice(0, 200)}`;
      const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

      if (this.manifest[name] === hash) return;

      this.manifest[name] = hash;
      await this.saveManifest();

      this.opts.emit({
        type: "skill:changed",
        payload: { skillName: name, summary: `Description: ${description}` },
      });
    } catch (err) {
      console.error("[SkillWatcherService] Failed to process skill change:", err);
    }
  }
}
