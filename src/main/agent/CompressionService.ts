import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CompressionRule {
  tool: string;
  thresholdChars: number;
  strategy: "summarize" | "truncate" | "head-only";
}

export const DEFAULT_RULES: CompressionRule[] = [
  { tool: "fetch_url", thresholdChars: 8000, strategy: "summarize" },
  { tool: "web_search", thresholdChars: 4000, strategy: "head-only" },
  { tool: "read_file", thresholdChars: 10000, strategy: "summarize" },
];

export interface CompressionResult {
  content: string;
  fullPath?: string;
  wasCompressed: boolean;
  strategy: string;
}

export class CompressionService {
  constructor(
    private readonly compressedDir: string,
    private readonly summarizeFn?: (text: string, maxWords: number) => Promise<string>,
  ) {}

  async compress(
    tool: string,
    rawContent: string,
    rules: CompressionRule[] = DEFAULT_RULES,
  ): Promise<CompressionResult> {
    const rule = rules.find((r) => r.tool === tool);
    if (!rule || rawContent.length <= rule.thresholdChars) {
      return { content: rawContent, wasCompressed: false, strategy: "none" };
    }

    switch (rule.strategy) {
      case "truncate":
        return await this.truncate(rawContent, rule.thresholdChars, tool);
      case "head-only":
        return await this.headOnly(rawContent, rule.thresholdChars, tool);
      case "summarize":
        return await this.summarize(rawContent, tool);
      default:
        return { content: rawContent, wasCompressed: false, strategy: "none" };
    }
  }

  private async truncate(raw: string, threshold: number, tool: string): Promise<CompressionResult> {
    const truncated = raw.slice(0, threshold);
    const fullPath = await this.saveFullContent(raw, tool);
    return {
      content: `${truncated}\n\n[truncated — full content saved to ${fullPath}]`,
      fullPath,
      wasCompressed: true,
      strategy: "truncate",
    };
  }

  private async headOnly(raw: string, threshold: number, tool: string): Promise<CompressionResult> {
    const paragraphs = raw.split("\n\n");
    let acc = "";
    for (const p of paragraphs) {
      if (acc.length + p.length > threshold) break;
      acc += `${p}\n\n`;
    }
    const fullPath = await this.saveFullContent(raw, tool);
    return {
      content: `${acc.trim()}\n\n[truncated — full content at ${fullPath}]`,
      fullPath,
      wasCompressed: true,
      strategy: "head-only",
    };
  }

  private async summarize(raw: string, tool: string): Promise<CompressionResult> {
    const fullPath = await this.saveFullContent(raw, tool);
    let summary: string;
    if (this.summarizeFn) {
      summary = await this.summarizeFn(raw, 200);
    } else {
      summary = `[Content too long (${raw.length} chars). Full content saved to ${fullPath}]`;
    }
    return {
      content: summary,
      fullPath,
      wasCompressed: true,
      strategy: "summarize",
    };
  }

  private async saveFullContent(raw: string, tool: string): Promise<string> {
    await mkdir(this.compressedDir, { recursive: true });
    const fileName = `${tool}-${Date.now()}.md`;
    const fullPath = join(this.compressedDir, fileName);
    await writeFile(fullPath, raw, "utf-8");
    return fullPath;
  }
}
