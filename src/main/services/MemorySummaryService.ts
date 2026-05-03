import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const WORD_THRESHOLD = 1500;
const TARGET_WORDS = 500;

export interface MemorySummaryServiceOptions {
  summarizeFn: (text: string) => Promise<string>;
}

export class MemorySummaryService {
  constructor(private readonly opts: MemorySummaryServiceOptions) {}

  async maybeSummarize(filePath: string, content: string): Promise<boolean> {
    const wordCount = content.split(/\s+/).length;
    if (wordCount <= WORD_THRESHOLD) return false;

    try {
      const summary = await this.opts.summarizeFn(
        `Compress the following memory into approximately ${TARGET_WORDS} words, preserving all key facts, decisions, and conventions:\n\n${content}`,
      );

      const archiveDir = join(dirname(filePath), "archive");
      await mkdir(archiveDir, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      await writeFile(join(archiveDir, `${date}.md`), content, "utf-8");
      await writeFile(filePath, summary, "utf-8");
      return true;
    } catch (err) {
      console.error("[MemorySummaryService] Summarization failed:", err);
      return false;
    }
  }
}
