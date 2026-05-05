import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { complete } from "@mariozechner/pi-ai";
import type { LibSQLStore } from "@mastra/libsql";
import { inject, injectable } from "tsyringe";
import { createModel } from "../agent/model-factory";
import { isCloudProvider, resolveProvider } from "../agent/model-provider";
import { AGENT_HOME_PATH_TOKEN } from "../di/tokens";
import { SettingsService } from "./SettingsService";

/** Model used for Observer compression — haiku for cost. Not user-configurable in Run 7. */
const COMPRESSION_MODEL_ID = "anthropic/claude-haiku-4.5" as const;

/** Estimated tokens above which Observer fires and compresses. */
const OBSERVER_TOKEN_THRESHOLD = 30_000;

/** Rough chars-to-tokens ratio (4 chars ≈ 1 token). */
const CHARS_PER_TOKEN = 4;

@injectable()
export class MemoryCompressionService {
  private readonly compressLocks = new Map<string, Promise<void>>();

  constructor(
    @inject(SettingsService) private readonly settingsService: SettingsService,
    @inject(AGENT_HOME_PATH_TOKEN) private readonly homePath: string,
  ) {}

  async compress(projectId: string, store: LibSQLStore): Promise<void> {
    if (this.compressLocks.has(projectId)) return;

    const run = async (): Promise<void> => {
      try {
        const memoryStore = await store.getStore("memory");
        if (!memoryStore) return;

        const result = await memoryStore.listMessages({
          threadId: projectId,
          perPage: false,
        });

        const totalChars = result.messages.reduce((sum, m) => {
          const text = extractTextContent(m.content);
          return sum + text.length;
        }, 0);

        if (totalChars / CHARS_PER_TOKEN < OBSERVER_TOKEN_THRESHOLD) return;

        const settings = await this.settingsService.getSettings();
        const provider = resolveProvider({
          settings,
          forceCloud: true,
          projectModelOverride: `openrouter:${COMPRESSION_MODEL_ID}`,
        });

        if (!isCloudProvider(provider) || !provider.apiKey) return;

        const model = createModel({ provider, langfuseEnabled: false });

        const conversationText = result.messages
          .map((m) => {
            const text = extractTextContent(m.content);
            return `${m.role === "user" ? "User" : "Assistant"}: ${text}`;
          })
          .join("\n\n");

        const compressionResult = await complete(
          model,
          {
            systemPrompt:
              "You compress conversation history into a concise context summary. Preserve key facts, decisions, user preferences, and project context. Output plain text — no headers, no lists, just prose.",
            messages: [
              {
                role: "user",
                content: `Compress this conversation into a concise summary (max 500 words):\n\n${conversationText}`,
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey: provider.apiKey },
        );

        const summaryText =
          (
            compressionResult.content.find((c) => c.type === "text") as
              | { type: "text"; text: string }
              | undefined
          )?.text ?? "";
        if (!summaryText) return;

        const summaryThreadId = `${projectId}-summary`;
        const existing = await memoryStore.getThreadById({ threadId: summaryThreadId });
        if (existing) {
          await memoryStore.updateThread({
            id: summaryThreadId,
            title: "Memory Summary",
            metadata: { summary: summaryText },
          });
        } else {
          await memoryStore.saveThread({
            thread: {
              id: summaryThreadId,
              resourceId: projectId,
              title: "Memory Summary",
              metadata: { summary: summaryText },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }

        // Also write to filesystem for user visibility
        try {
          const { toSlug } = await import("../agent/context");
          const slug = toSlug(projectId);
          const memoryDir = join(this.homePath, "projects", slug, "memory");
          await mkdir(memoryDir, { recursive: true });
          const date = new Date().toISOString().split("T")[0];
          const filePath = join(memoryDir, `${date}.md`);
          const frontmatter = [
            "---",
            "type: observation",
            `date: ${new Date().toISOString()}`,
            `thread_id: ${projectId}`,
            `project_id: ${projectId}`,
            "---",
            "",
            summaryText,
          ].join("\n");
          await writeFile(filePath, frontmatter, "utf-8");
        } catch (err) {
          console.error(
            "[MemoryCompressionService] Failed to write observation to filesystem:",
            err,
          );
        }
      } catch (err) {
        console.error("[MemoryCompressionService] Observer compression failed:", err);
      } finally {
        this.compressLocks.delete(projectId);
      }
    };

    this.compressLocks.set(projectId, run());
    await this.compressLocks.get(projectId);
  }
}

interface TextPart {
  type?: string;
  text?: string;
}

interface MastraContentV2 {
  format?: number;
  parts?: TextPart[];
}

/**
 * Extract plain text from MastraMessageContentV2 (format 2, parts array).
 * Falls back to JSON serialization if content is not the expected format.
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  const v2 = content as MastraContentV2;
  if (v2?.format === 2 && Array.isArray(v2.parts)) {
    return v2.parts
      .filter((p): p is TextPart & { type: "text" } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }

  return JSON.stringify(content);
}
