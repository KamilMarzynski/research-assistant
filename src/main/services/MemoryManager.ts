import { join } from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";

export interface MemoryContext {
  summary: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

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

export interface IMemoryManager {
  buildContext(projectId: string): Promise<MemoryContext>;
  save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void>;
}

@injectable()
export class MemoryManager implements IMemoryManager {
  private initPromise: Promise<Memory> | null = null;
  private readonly dbPath: string;

  constructor(@inject(USER_DATA_PATH_TOKEN) userDataPath: string) {
    this.dbPath = join(userDataPath, "research-assistant.db");
  }

  private async getMemory(): Promise<Memory> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const storage = new LibSQLStore({
            id: "research-assistant-memory",
            url: `file:${this.dbPath}`,
          });
          await storage.init();

          const memory = new Memory({
            storage,
            options: {
              lastMessages: 25,
              observationalMemory: {
                enabled: true,
                scope: "thread",
                temporalMarkers: true,
                model: "ollama/gemma4:31b-cloud",
                observation: {
                  messageTokens: 30_000,
                  bufferTokens: 0.2,
                  bufferActivation: 0.8,
                  modelSettings: { temperature: 0.3 },
                },
                reflection: {
                  observationTokens: 60_000,
                  modelSettings: { temperature: 0 },
                },
              },
            },
          });

          void memory.omEngine;

          return memory;
        } catch (err) {
          this.initPromise = null;
          throw err;
        }
      })();
    }
    return this.initPromise;
  }

  async buildContext(projectId: string): Promise<MemoryContext> {
    try {
      const memory = await this.getMemory();
      const ctx = await memory.getContext({
        threadId: projectId,
        memoryConfig: { lastMessages: 25 },
      });

      const summary = ctx.systemMessage ?? "";

      const recentMessages = ctx.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: extractTextContent(m.content),
        }));

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
      const memory = await this.getMemory();

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

      await memory.saveMessages({ messages });

      const omEngine = await memory.omEngine;
      if (omEngine) {
        await omEngine.observe({ threadId: projectId });
      }
    } catch (err) {
      console.error("[MemoryManager] save failed:", err);
    }
  }
}
