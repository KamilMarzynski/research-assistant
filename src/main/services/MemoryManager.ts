import { join } from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";
import { MemoryCompressionService } from "./MemoryCompressionService";

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  const v2 = content as { format?: number; parts?: Array<{ type?: string; text?: string }> };
  if (v2?.format === 2 && Array.isArray(v2.parts)) {
    return v2.parts
      .filter((p): p is { type: "text"; text: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }

  return JSON.stringify(content);
}

export interface MemoryContext {
  /** Compressed summary from past sessions. Empty string on first use. */
  summary: string;
  /** Last N raw conversation turns for history injection. */
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

const WORKING_SET_MESSAGES = 100;

export interface IMemoryManager {
  buildContext(projectId: string): Promise<MemoryContext>;
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
    @inject(MemoryCompressionService) private readonly compressionService: MemoryCompressionService,
  ) {
    this.dbPath = join(userDataPath, "research-assistant.db");
  }

  private getStore(): Promise<LibSQLStore> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const store = new LibSQLStore({
            id: "research-assistant-memory",
            url: `file:${this.dbPath}`,
          });
          await store.init();
          return store;
        } catch (err) {
          this.initPromise = null; // Reset so next call retries
          throw err;
        }
      })();
    }
    return this.initPromise;
  }

  async buildContext(projectId: string): Promise<MemoryContext> {
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
        // Fetch newest-first (DESC), then slice and reverse to chronological order.
        // StorageListMessagesInput.orderBy is typed as StorageOrderBy<'createdAt'>.
        const result = await memoryStore.listMessages({
          threadId: projectId,
          perPage: WORKING_SET_MESSAGES,
          orderBy: { field: "createdAt", direction: "DESC" },
        });
        recentMessages = result.messages
          .slice(0, WORKING_SET_MESSAGES)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .reverse()
          .map((m) => ({
            role: m.role as "user" | "assistant",
            // Extract text from MastraMessageContentV2 parts
            content: extractTextContent(m.content),
          }));
      } catch {
        // No messages yet
      }

      return { summary, recentMessages };
    } catch (err) {
      console.error("[MemoryManager] buildContext failed — returning empty context:", err);
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
      void this.compressionService.compress(projectId, store);
    } catch (err) {
      console.error("[MemoryManager] save failed:", err);
    }
  }
}
