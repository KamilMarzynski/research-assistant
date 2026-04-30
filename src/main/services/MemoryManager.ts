import { join } from "node:path";
import { complete } from "@mariozechner/pi-ai";
import { LibSQLStore } from "@mastra/libsql";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";
import { createModel } from "../agent/model-factory";
import { isCloudProvider, resolveProvider } from "../agent/model-provider";
import type { SettingsService } from "./SettingsService";

/** Model used for Observer compression — haiku for cost. Not user-configurable in Run 7. */
const COMPRESSION_MODEL_ID = "anthropic/claude-haiku-4.5" as const;

/** Estimated tokens above which Observer fires and compresses. */
const OBSERVER_TOKEN_THRESHOLD = 30_000;

/** Rough chars-to-tokens ratio (4 chars ≈ 1 token). */
const CHARS_PER_TOKEN = 4;

export interface MemoryContext {
  /** Compressed summary from past sessions. Empty string on first use. */
  summary: string;
  /** Last N raw conversation turns for history injection. */
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface IMemoryManager {
  buildContext(projectId: string, maxRecent: number): Promise<MemoryContext>;
  save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void>;
}

@injectable()
export class MemoryManager implements IMemoryManager {
  private initPromise: Promise<LibSQLStore> | null = null;
  private readonly dbPath: string;

  constructor(
    @inject(USER_DATA_PATH_TOKEN) userDataPath: string,
    private readonly settingsService: SettingsService,
  ) {
    this.dbPath = join(userDataPath, "research-assistant.db");
  }

  private getStore(): Promise<LibSQLStore> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const store = new LibSQLStore({
          id: "research-assistant-memory",
          url: `file:${this.dbPath}`,
        });
        await store.init();
        return store;
      })();
    }
    return this.initPromise;
  }

  async buildContext(projectId: string, maxRecent: number): Promise<MemoryContext> {
    try {
      const store = await this.getStore();
      const memoryStore = await store.getStore("memory");
      if (!memoryStore) return { summary: "", recentMessages: [] };

      // Retrieve summary stored as metadata on a dedicated summary thread
      let summary = "";
      try {
        const summaryThread = await memoryStore.getThreadById({
          threadId: `${projectId}-summary`,
        });
        summary = (summaryThread?.metadata as { summary?: string } | undefined)?.summary ?? "";
      } catch {
        // No summary thread yet — first session
      }

      // Retrieve recent messages for history injection
      let recentMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      try {
        // orderBy createdAt ASC (default) returns messages oldest-first, which is
        // the correct chronological order for <conversation_history> injection.
        // StorageListMessagesInput.orderBy is typed as StorageOrderBy<'createdAt'>.
        const result = await memoryStore.listMessages({
          threadId: projectId,
          perPage: maxRecent,
          orderBy: { field: "createdAt", direction: "ASC" },
        });
        recentMessages = result.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            // Extract text from MastraMessageContentV2 parts
            content: extractTextContent(m.content),
          }));
      } catch {
        // No messages yet
      }

      return { summary, recentMessages };
    } catch {
      return { summary: "", recentMessages: [] };
    }
  }

  async save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void> {
    try {
      const store = await this.getStore();
      const memoryStore = await store.getStore("memory");
      if (!memoryStore) return;

      const messages = turns.map((t) => ({
        id: crypto.randomUUID(),
        role: t.role as "user" | "assistant",
        content: {
          format: 2 as const,
          parts: [{ type: "text" as const, text: t.content }],
        },
        threadId: projectId,
        resourceId: projectId,
        createdAt: new Date(),
      }));

      await memoryStore.saveMessages({ messages });

      // Fire Observer compression async — non-blocking
      void this.maybeCompress(projectId, store);
    } catch (err) {
      console.error("[MemoryManager] save failed:", err);
    }
  }

  /**
   * Observer: when estimated token count exceeds threshold, compress all messages
   * into a summary using haiku. Non-blocking — failures logged, not surfaced.
   */
  private async maybeCompress(projectId: string, store: LibSQLStore): Promise<void> {
    try {
      const memoryStore = await store.getStore("memory");
      if (!memoryStore) return;

      const result = await memoryStore.listMessages({
        threadId: projectId,
        perPage: false, // all messages
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
    } catch (err) {
      console.error("[MemoryManager] Observer compression failed:", err);
    }
  }
}

/**
 * Extract plain text from MastraMessageContentV2 (format 2, parts array).
 * Falls back to JSON serialization if content is not the expected format.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  const v2 = content as { format?: number; parts?: Array<{ type?: string; text?: string }> };
  if (v2?.format === 2 && Array.isArray(v2.parts)) {
    return v2.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return JSON.stringify(content);
}
