import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { PathJail } from "./path-jail";

export interface OutputConvention {
  default: string;
  code?: string;
  reports?: string;
}

export class OutputRouter {
  constructor(private readonly jail: PathJail) {}

  parseConventions(agentsMdContent: string): OutputConvention | null {
    const lines = agentsMdContent.split("\n");
    let inSection = false;
    const conventions: Partial<OutputConvention> = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.startsWith("## Output location")) {
        inSection = true;
        continue;
      }

      if (inSection) {
        if (line.startsWith("## ")) break;
        if (!line.startsWith("- ")) continue;

        const content = line.slice(2).trim();
        const colonIndex = content.indexOf(":");
        if (colonIndex === -1) continue;

        const key = content.slice(0, colonIndex).trim();
        const value = content.slice(colonIndex + 1).trim();

        if (key === "default" || key === "code" || key === "reports") {
          conventions[key] = value;
        }
      }
    }

    if (!conventions.default) return null;

    return conventions as OutputConvention;
  }

  async moveFinals(
    workspacePath: string,
    conventions: OutputConvention,
  ): Promise<{ moved: string[]; skipped: string[] }> {
    const moved: string[] = [];
    const skipped: string[] = [];

    const entries = await readdir(workspacePath);

    for (const entry of entries) {
      const sourcePath = join(workspacePath, entry);
      const fileStat = await stat(sourcePath);

      if (fileStat.isDirectory()) {
        skipped.push(entry);
        continue;
      }

      const ext = extname(entry).toLowerCase();
      let destDir: string;

      if ([".py", ".js", ".ts", ".sh"].includes(ext)) {
        destDir = conventions.code ?? conventions.default;
      } else if ([".md", ".pdf"].includes(ext)) {
        destDir = conventions.reports ?? conventions.default;
      } else {
        destDir = conventions.default;
      }

      try {
        this.jail.validate(destDir, "write");
      } catch {
        skipped.push(entry);
        continue;
      }

      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, entry);
      await rename(sourcePath, destPath);
      moved.push(entry);
    }

    return { moved, skipped };
  }
}
