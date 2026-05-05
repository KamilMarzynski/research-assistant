import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron — safeStorage is main-process only
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

// Mock node:fs/promises
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue("");
const mockAccess = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);

vi.mock("node:fs/promises", () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  readdir: mockReaddir,
  writeFile: mockWriteFile,
}));

// ---- LibSQLStore mock ----
const mockMemoryStore = {
  getThreadById: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue({ messages: [] }),
  saveMessages: vi.fn().mockResolvedValue(undefined),
  saveThread: vi.fn().mockResolvedValue(undefined),
  updateThread: vi.fn().mockResolvedValue(undefined),
};

const mockLibSQLStoreInstance = {
  init: vi.fn().mockResolvedValue(undefined),
  getStore: vi.fn().mockResolvedValue(mockMemoryStore),
};

vi.mock("@mastra/libsql", () => ({
  LibSQLStore: vi.fn().mockImplementation(function (this: unknown) {
    return mockLibSQLStoreInstance;
  }),
}));

// ---- @mariozechner/pi-ai mock ----
const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Compressed summary." }],
});

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
  getModels: vi.fn().mockReturnValue([
    { provider: "openrouter", id: "test-model" },
    { provider: "openrouter", id: "anthropic/claude-sonnet-4-6" },
    { provider: "openrouter", id: "anthropic/claude-haiku-4.5" },
  ]),
  complete: mockComplete,
}));

const { MemoryManager } = await import("../MemoryManager");
const { MemoryCompressionService } = await import("../MemoryCompressionService");

// ---- Helpers ----

function makeSettingsService(apiKey: string | null = "sk-or-test") {
  return {
    getSettings: vi.fn().mockResolvedValue({
      activeProvider: "openrouter",
      defaultCloudProvider: "openrouter",
      providerCredentials: {
        openrouter: { apiKey, defaultModel: "anthropic/claude-sonnet-4-6" },
        openai: { apiKey: null, defaultModel: "gpt-4o" },
        anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
        ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
      },
      langfuseEnabled: false,
      webAccessEnabled: true,
    }),
  };
}

/** Build a MastraDBMessage-shaped object for use in listMessages results. */
function makeMastraMessage(role: "user" | "assistant" | "system", text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    content: { format: 2, parts: [{ type: "text", text }] },
    threadId: "proj-1",
    resourceId: "proj-1",
    createdAt: new Date(),
  };
}

/** Build a MastraDBMessage with plain string content (format-1 fast path). */
function makeMastraMessageStringContent(role: "user" | "assistant", text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    content: text,
    threadId: "proj-1",
    resourceId: "proj-1",
    createdAt: new Date(),
  };
}

/** Build a MastraDBMessage with non-format-2 content (JSON fallback path). */
function makeMastraMessageNonFormat2Content(role: "user" | "assistant", data: unknown) {
  return {
    id: crypto.randomUUID(),
    role,
    content: { format: 1, data },
    threadId: "proj-1",
    resourceId: "proj-1",
    createdAt: new Date(),
  };
}

// ---- Tests ----

describe("MemoryManager", () => {
  let manager: InstanceType<typeof MemoryManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset defaults
    mockMemoryStore.getThreadById.mockResolvedValue(null);
    mockMemoryStore.listMessages.mockResolvedValue({ messages: [] });
    mockMemoryStore.saveMessages.mockResolvedValue(undefined);
    mockMemoryStore.saveThread.mockResolvedValue(undefined);
    mockMemoryStore.updateThread.mockResolvedValue(undefined);
    mockLibSQLStoreInstance.getStore.mockResolvedValue(mockMemoryStore);
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "Compressed summary." }],
    });

    const compressionService = new MemoryCompressionService(
      makeSettingsService() as never,
      "/tmp/home",
    );
    manager = new MemoryManager("/tmp/test-userdata", compressionService as never);
  });

  // ------------------------------------------------------------------ buildContext

  describe("buildContext()", () => {
    it("returns empty context on first use (no thread, no messages)", async () => {
      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx).toEqual({ summary: "", recentMessages: [] });
    });

    it("returns summary from summary thread metadata when it exists", async () => {
      mockMemoryStore.getThreadById.mockImplementation(({ threadId }: { threadId: string }) => {
        if (threadId === "proj-1-summary") {
          return Promise.resolve({ metadata: { summary: "Prior work summary." } });
        }
        return Promise.resolve(null);
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.summary).toBe("Prior work summary.");
    });

    it("returns recent messages mapped to { role, content } strings", async () => {
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [
          makeMastraMessage("user", "Hello from user"),
          makeMastraMessage("assistant", "Hello from assistant"),
        ],
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.recentMessages).toEqual([
        { role: "user", content: "Hello from user" },
        { role: "assistant", content: "Hello from assistant" },
      ]);
    });

    it("respects maxRecent by passing it as perPage to listMessages", async () => {
      await manager.buildContext("proj-1", 5);

      expect(mockMemoryStore.listMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 5,
          orderBy: { field: "createdAt", direction: "ASC" },
        }),
      );
    });

    it("filters out non-user/assistant messages (e.g. system)", async () => {
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [
          makeMastraMessage("system", "You are an assistant"),
          makeMastraMessage("user", "Hello"),
          makeMastraMessage("assistant", "Hi"),
        ],
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.recentMessages).toHaveLength(2);
      expect(ctx.recentMessages.every((m) => m.role === "user" || m.role === "assistant")).toBe(
        true,
      );
    });

    it("returns empty context when store.getStore('memory') throws", async () => {
      mockLibSQLStoreInstance.getStore.mockRejectedValueOnce(new Error("DB unavailable"));

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx).toEqual({ summary: "", recentMessages: [] });
    });

    it("still returns messages even when summary thread lookup throws", async () => {
      mockMemoryStore.getThreadById.mockRejectedValueOnce(new Error("summary thread error"));
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", "some message")],
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.summary).toBe("");
      expect(ctx.recentMessages).toHaveLength(1);
    });

    it("still returns summary even when listMessages throws", async () => {
      mockMemoryStore.getThreadById.mockResolvedValue({
        metadata: { summary: "Existing summary." },
      });
      mockMemoryStore.listMessages.mockRejectedValueOnce(new Error("list error"));

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.summary).toBe("Existing summary.");
      expect(ctx.recentMessages).toEqual([]);
    });

    it("returns empty context when store.getStore('memory') resolves to undefined in buildContext", async () => {
      mockLibSQLStoreInstance.getStore.mockResolvedValueOnce(undefined);

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx).toEqual({ summary: "", recentMessages: [] });
    });

    it("extracts content correctly when messages have plain string content", async () => {
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [
          makeMastraMessageStringContent("user", "plain string content"),
          makeMastraMessageStringContent("assistant", "plain reply"),
        ],
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.recentMessages).toEqual([
        { role: "user", content: "plain string content" },
        { role: "assistant", content: "plain reply" },
      ]);
    });

    it("extracts content correctly when messages have non-format-2 content (JSON fallback)", async () => {
      const nonFormat2Msg = makeMastraMessageNonFormat2Content("user", "some data");

      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [nonFormat2Msg],
      });

      const ctx = await manager.buildContext("proj-1", 10);

      expect(ctx.recentMessages).toHaveLength(1);
      expect(ctx.recentMessages[0].content).toBe(JSON.stringify({ format: 1, data: "some data" }));
    });
  });

  // ------------------------------------------------------------------ save

  describe("save()", () => {
    it("calls saveMessages with correctly-shaped MastraDBMessage objects", async () => {
      await manager.save("proj-1", [
        { role: "user", content: "What is Mastra?" },
        { role: "assistant", content: "Mastra is a framework." },
      ]);

      expect(mockMemoryStore.saveMessages).toHaveBeenCalledTimes(1);
      const { messages } = mockMemoryStore.saveMessages.mock.calls[0][0] as {
        messages: Array<{
          id: string;
          role: string;
          content: { format: number; parts: Array<{ type: string; text: string }> };
          threadId: string;
          resourceId: string;
          createdAt: Date;
        }>;
      };

      expect(messages).toHaveLength(2);

      const [userMsg, assistantMsg] = messages;

      expect(userMsg.role).toBe("user");
      expect(userMsg.content).toEqual({
        format: 2,
        parts: [{ type: "text", text: "What is Mastra?" }],
      });
      expect(userMsg.threadId).toBe("proj-1");
      expect(userMsg.resourceId).toBe("proj-1");
      expect(userMsg.id).toBeTypeOf("string");
      expect(userMsg.createdAt).toBeInstanceOf(Date);

      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.content).toEqual({
        format: 2,
        parts: [{ type: "text", text: "Mastra is a framework." }],
      });
    });

    it("does not throw when saveMessages fails", async () => {
      mockMemoryStore.saveMessages.mockRejectedValueOnce(new Error("write failed"));

      await expect(
        manager.save("proj-1", [{ role: "user", content: "Hello" }]),
      ).resolves.toBeUndefined();
    });

    it("returns without error when store.getStore('memory') resolves to undefined in save", async () => {
      mockLibSQLStoreInstance.getStore.mockResolvedValueOnce(undefined);

      await expect(
        manager.save("proj-1", [{ role: "user", content: "Hello" }]),
      ).resolves.toBeUndefined();

      expect(mockMemoryStore.saveMessages).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ maybeCompress (Observer)

  describe("maybeCompress (Observer via save)", () => {
    it("does NOT call complete() when total chars are below threshold", async () => {
      // Below threshold: 120,000 chars total (30,000 tokens × 4 chars/token)
      const shortMessage = makeMastraMessage("user", "short");
      mockMemoryStore.listMessages.mockResolvedValue({ messages: [shortMessage] });

      await manager.save("proj-1", [{ role: "user", content: "short" }]);

      // Let the async void task settle
      await new Promise((r) => setTimeout(r, 10));

      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("skips compression when no API key configured", async () => {
      const compressionService = new MemoryCompressionService(
        makeSettingsService(null) as never,
        "/tmp/home",
      );
      manager = new MemoryManager("/tmp/test-userdata", compressionService as never);

      // Build messages above threshold (120,001 chars)
      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });

      await manager.save("proj-1", [{ role: "user", content: "trigger" }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("calls complete() and saves summary thread when chars exceed threshold", async () => {
      // Above threshold: 120,001 chars
      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });
      // No existing summary thread
      mockMemoryStore.getThreadById.mockResolvedValue(null);

      await manager.save("proj-1", [{ role: "user", content: "trigger" }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openrouter" }),
        expect.objectContaining({ messages: expect.any(Array) }),
        { apiKey: "sk-or-test" },
      );
      expect(mockMemoryStore.saveThread).toHaveBeenCalledWith(
        expect.objectContaining({
          thread: expect.objectContaining({
            id: "proj-1-summary",
            metadata: { summary: "Compressed summary." },
          }),
        }),
      );
    });

    it("calls updateThread when summary thread already exists", async () => {
      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });
      // Existing summary thread
      mockMemoryStore.getThreadById.mockImplementation(({ threadId }: { threadId: string }) => {
        if (threadId === "proj-1-summary") {
          return Promise.resolve({ id: "proj-1-summary", metadata: { summary: "old summary" } });
        }
        return Promise.resolve(null);
      });

      await manager.save("proj-1", [{ role: "user", content: "trigger" }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockMemoryStore.updateThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "proj-1-summary",
          title: "Memory Summary",
          metadata: { summary: "Compressed summary." },
        }),
      );
      expect(mockMemoryStore.saveThread).not.toHaveBeenCalled();
    });

    it("does NOT call saveThread when compress returns no text parts", async () => {
      // complete() returns content with no text parts
      mockComplete.mockResolvedValueOnce({ content: [] });

      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });
      mockMemoryStore.getThreadById.mockResolvedValue(null);

      await manager.save("proj-1", [{ role: "user", content: "trigger" }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockMemoryStore.saveThread).not.toHaveBeenCalled();
      expect(mockMemoryStore.updateThread).not.toHaveBeenCalled();
    });

    it("skips compression when store.getStore('memory') resolves to undefined in maybeCompress", async () => {
      const longText = "x".repeat(120_001);
      // First call (from save()) returns mockMemoryStore, second call (from maybeCompress()) returns undefined
      mockLibSQLStoreInstance.getStore
        .mockResolvedValueOnce(mockMemoryStore)
        .mockResolvedValueOnce(undefined);

      mockMemoryStore.saveMessages.mockResolvedValue(undefined);

      await manager.save("proj-1", [{ role: "user", content: longText }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("writes compressed summary to filesystem memory/YYYY-MM-DD.md", async () => {
      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });
      mockMemoryStore.getThreadById.mockResolvedValue(null);

      await manager.save("proj-1", [{ role: "user", content: "trigger" }]);
      await new Promise((r) => setTimeout(r, 10));

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining("memory"), {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/memory\/\d{4}-\d{2}-\d{2}\.md$/),
        expect.stringContaining("type: observation"),
        "utf-8",
      );
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("thread_id: proj-1");
      expect(writtenContent).toContain("project_id: proj-1");
      expect(writtenContent).toContain("Compressed summary.");
    });

    it("does NOT throw when filesystem write fails", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("disk full"));

      const longText = "x".repeat(120_001);
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [makeMastraMessage("user", longText)],
      });
      mockMemoryStore.getThreadById.mockResolvedValue(null);

      // Should resolve without throwing even though writeFile rejects
      await expect(
        manager.save("proj-1", [{ role: "user", content: "trigger" }]),
      ).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe("initPromise retry", () => {
    it("resets initPromise on store.init() failure so next call retries", async () => {
      // Make the first init() call fail
      mockLibSQLStoreInstance.init.mockRejectedValueOnce(new Error("DB locked"));

      // First call to buildContext should fail silently (returns empty context)
      const ctx1 = await manager.buildContext("proj-1", 10);
      expect(ctx1).toEqual({ summary: "", recentMessages: [] });

      // Reset init to succeed
      mockLibSQLStoreInstance.init.mockResolvedValue(undefined);

      // Second call should succeed (initPromise was reset)
      const ctx2 = await manager.buildContext("proj-1", 10);
      expect(ctx2).toEqual({ summary: "", recentMessages: [] });
    });
  });
});
