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
  private readonly observeTimers = new Map<string, NodeJS.Timeout>();

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
                model: "ollama-cloud/gemma4:31b",
                observation: {
                  messageTokens: 5_000,
                  bufferTokens: false,
                  bufferActivation: 0.8,
                  modelSettings: { temperature: 0.3 },
                },
                reflection: {
                  observationTokens: 20_000,
                  modelSettings: { temperature: 0 },
                },
              },
            },
          });

          // Eagerly trigger OM engine initialization so first getContext()
          // doesn't block on the lazy getter. Log failures non-blocking.
          memory.omEngine?.catch?.((err: unknown) =>
            console.error("[MemoryManager] OM engine init failed:", err),
          );

          // [MM-DIAG] await OM engine resolution to surface init outcome
          void (async () => {
            try {
              const eng = await memory.omEngine;
              console.log(
                "[MM-DIAG] omEngine resolved:",
                eng ? `present (scope=${(eng as { scope?: string }).scope ?? "?"})` : "null",
              );
            } catch (err) {
              console.error("[MM-DIAG] omEngine resolution threw:", err);
            }
          })();

          return memory;
        } catch (err) {
          this.initPromise = null;
          throw err;
        }
      })();
    }
    return this.initPromise;
  }

  private debouncedObserve(projectId: string): void {
    const existing = this.observeTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.observeTimers.delete(projectId);
      void this.triggerObservation(projectId);
    }, 1000);

    this.observeTimers.set(projectId, timer);
  }

  private async triggerObservation(projectId: string): Promise<void> {
    try {
      const memory = await this.getMemory();
      const omEngine = await memory.omEngine;
      if (!omEngine) {
        console.warn("[MM-DIAG] observe skipped: omEngine null for", projectId);
        return;
      }

      // [MM-DIAG] status before observe — shows pending tokens vs threshold
      try {
        const om = omEngine as unknown as {
          getStatus?: (opts: {
            threadId: string;
            resourceId?: string;
          }) => Promise<Record<string, unknown>>;
        };
        if (typeof om.getStatus === "function") {
          const status = await om.getStatus({ threadId: projectId, resourceId: projectId });
          console.log("[MM-DIAG] pre-observe status:", JSON.stringify(status, null, 2));
        }
      } catch (statusErr) {
        console.warn("[MM-DIAG] getStatus failed:", statusErr);
      }

      const result = await omEngine.observe({
        threadId: projectId,
        hooks: {
          onObservationStart: () => console.log("[MM-DIAG] Observer LLM start"),
          onObservationEnd: ({ usage, error }) => {
            if (error) console.error("[MM-DIAG] Observer LLM error:", error);
            else console.log("[MM-DIAG] Observer LLM end usage:", usage);
          },
          onReflectionStart: () => console.log("[MM-DIAG] Reflector LLM start"),
          onReflectionEnd: ({ usage, error }) => {
            if (error) console.error("[MM-DIAG] Reflector LLM error:", error);
            else console.log("[MM-DIAG] Reflector LLM end usage:", usage);
          },
        },
      });
      console.log("[MM-DIAG] observe result for", projectId, ":", {
        observed: result.observed,
        reflected: result.reflected,
        activeObsLen: result.record?.activeObservations?.length ?? 0,
        activeObsPreview: result.record?.activeObservations?.slice(0, 300) ?? null,
      });
    } catch (err) {
      console.error("[MemoryManager] debounced observation failed:", err);
    }
  }

  async buildContext(projectId: string): Promise<MemoryContext> {
    try {
      const memory = await this.getMemory();
      const ctx = await memory.getContext({
        threadId: projectId,
        resourceId: projectId,
        memoryConfig: { lastMessages: 25 },
      });

      // [MM-DIAG] surface what getContext returned
      const omRecord = (ctx as { omRecord?: { activeObservations?: string } }).omRecord;
      console.log("[MM-DIAG] buildContext for", projectId, ":", {
        hasObservations: ctx.hasObservations,
        systemMessageLen: ctx.systemMessage?.length ?? 0,
        systemMessagePreview: ctx.systemMessage?.slice(0, 200) ?? null,
        activeObsLen: omRecord?.activeObservations?.length ?? 0,
        recentMessageCount: ctx.messages.length,
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
      console.log(
        "[MM-DIAG] save persisted",
        messages.length,
        "messages for",
        projectId,
        "roles=",
        messages.map((m) => m.role).join(","),
      );

      // Fire-and-forget debounced observation — avoids blocking the save path.
      this.debouncedObserve(projectId);
    } catch (err) {
      console.error("[MemoryManager] save failed:", err);
    }
  }
}
