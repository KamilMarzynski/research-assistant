import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron — safeStorage and dialog are main-process only
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
}));

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
  readdir: vi.fn().mockResolvedValue([]),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ---- @mastra/libsql mock ----
const mockLibSQLStoreInstance = {
  init: vi.fn().mockResolvedValue(undefined),
  getStore: vi.fn().mockResolvedValue({
    saveMessages: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue({ messages: [] }),
    getThreadById: vi.fn().mockResolvedValue(null),
    listThreads: vi.fn().mockResolvedValue({ threads: [], total: 0 }),
    saveThread: vi.fn().mockResolvedValue(undefined),
    updateThread: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    cloneThread: vi.fn().mockResolvedValue({ thread: {}, clonedMessages: [] }),
    supportsObservationalMemory: true,
  }),
};

vi.mock("@mastra/libsql", () => ({
  LibSQLStore: vi.fn().mockImplementation(function (this: unknown) {
    return mockLibSQLStoreInstance;
  }),
}));

// ---- @mastra/memory mock ----
const mockOmEngine = {
  observe: vi.fn().mockResolvedValue({ observed: false, reflected: false, record: {} }),
};

const mockMemory = {
  getContext: vi.fn().mockResolvedValue({
    systemMessage: "",
    messages: [],
    hasObservations: false,
    omRecord: null,
    continuationMessage: undefined,
    otherThreadsContext: undefined,
  }),
  saveMessages: vi.fn().mockResolvedValue({ messages: [] }),
  omEngine: Promise.resolve(mockOmEngine),
};

vi.mock("@mastra/memory", () => ({
  Memory: vi.fn().mockImplementation(function (this: unknown) {
    return mockMemory;
  }),
}));

const { MemoryManager } = await import("../MemoryManager");

// ---- Helpers ----

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

// ---- Tests ----

describe("MemoryManager", () => {
  let manager: InstanceType<typeof MemoryManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemory.getContext.mockResolvedValue({
      systemMessage: "",
      messages: [],
      hasObservations: false,
      omRecord: null,
      continuationMessage: undefined,
      otherThreadsContext: undefined,
    });
    mockMemory.saveMessages.mockResolvedValue({ messages: [] });
    mockOmEngine.observe.mockResolvedValue({ observed: false, reflected: false, record: {} });

    manager = new MemoryManager("/tmp/test-userdata");
  });

  // ------------------------------------------------------------------ buildContext

  describe("buildContext()", () => {
    it("returns empty context on first use", async () => {
      const ctx = await manager.buildContext("proj-1");

      expect(ctx).toEqual({ summary: "", historyMessages: [], hasObservations: false });
    });

    it("returns summary from getContext systemMessage", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "Prior work summary.",
        messages: [],
        hasObservations: true,
        omRecord: { activeObservations: "Prior work summary." },
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.summary).toBe("Prior work summary.");
    });

    it("returns recent messages from getContext", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "",
        messages: [
          makeMastraMessage("assistant", "Hello from assistant"),
          makeMastraMessage("user", "Hello from user"),
        ],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.historyMessages).toEqual([
        { role: "assistant", content: "Hello from assistant" },
        { role: "user", content: "Hello from user" },
      ]);
    });

    it("filters out non-user/assistant messages", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "",
        messages: [
          makeMastraMessage("system", "You are an assistant"),
          makeMastraMessage("user", "Hello"),
          makeMastraMessage("assistant", "Hi"),
        ],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.historyMessages).toHaveLength(2);
      expect(ctx.historyMessages.every((m) => m.role === "user" || m.role === "assistant")).toBe(
        true,
      );
    });

    it("calls getContext with correct threadId and lastMessages config", async () => {
      await manager.buildContext("proj-1");

      expect(mockMemory.getContext).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "proj-1",
          memoryConfig: expect.objectContaining({ lastMessages: 25 }),
        }),
      );
    });

    it("returns empty context when getContext throws", async () => {
      mockMemory.getContext.mockRejectedValueOnce(new Error("DB unavailable"));

      const ctx = await manager.buildContext("proj-1");

      expect(ctx).toEqual({ summary: "", historyMessages: [], hasObservations: false });
    });

    it("extracts content correctly when messages have plain string content", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "",
        messages: [
          {
            role: "assistant",
            content: "plain reply",
            id: "1",
            threadId: "proj-1",
            resourceId: "proj-1",
            createdAt: new Date(),
          },
          {
            role: "user",
            content: "plain string content",
            id: "2",
            threadId: "proj-1",
            resourceId: "proj-1",
            createdAt: new Date(),
          },
        ],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.historyMessages).toEqual([
        { role: "assistant", content: "plain reply" },
        { role: "user", content: "plain string content" },
      ]);
    });

    it("falls back to JSON.stringify for non-string non-v2 content", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "",
        messages: [
          {
            role: "assistant",
            content: { format: 3, parts: [] },
            id: "1",
            threadId: "proj-1",
            resourceId: "proj-1",
            createdAt: new Date(),
          },
        ],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.historyMessages[0].content).toBe('{"format":3,"parts":[]}');
    });

    it("filters out non-text parts from v2 content", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "",
        messages: [
          {
            role: "assistant",
            content: {
              format: 2,
              parts: [
                { type: "text", text: "hello " },
                { type: "image", url: "http://x" },
                null,
                { type: "text", text: "world" },
              ],
            },
            id: "1",
            threadId: "proj-1",
            resourceId: "proj-1",
            createdAt: new Date(),
          },
        ],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.historyMessages[0].content).toBe("hello world");
    });

    it("uses empty summary when systemMessage is null", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: null,
        messages: [],
        hasObservations: false,
        omRecord: null,
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.summary).toBe("");
    });

    it("returns hasObservations=true when getContext reports observations", async () => {
      mockMemory.getContext.mockResolvedValue({
        systemMessage: "Prior work summary.",
        messages: [],
        hasObservations: true,
        omRecord: { activeObservations: "Prior work summary." },
        continuationMessage: undefined,
        otherThreadsContext: undefined,
      });

      const ctx = await manager.buildContext("proj-1");

      expect(ctx.hasObservations).toBe(true);
      expect(ctx.summary).toBe("Prior work summary.");
    });

    it("returns hasObservations=false when getContext reports no observations", async () => {
      // beforeEach default already sets hasObservations: false
      const ctx = await manager.buildContext("proj-1");

      expect(ctx.hasObservations).toBe(false);
    });
  });

  // ------------------------------------------------------------------ save

  describe("save()", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls saveMessages with correctly-shaped MastraDBMessage objects", async () => {
      await manager.save("proj-1", [
        { role: "user", content: "What is Mastra?" },
        { role: "assistant", content: "Mastra is a framework." },
      ]);

      expect(mockMemory.saveMessages).toHaveBeenCalledTimes(1);
      const { messages } = mockMemory.saveMessages.mock.calls[0][0] as {
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

    it("debounces OM observation after saving messages", async () => {
      await manager.save("proj-1", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);

      expect(mockMemory.saveMessages).toHaveBeenCalled();
      // Observation is debounced — not called immediately.
      expect(mockOmEngine.observe).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockOmEngine.observe).toHaveBeenCalledTimes(1);
      expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "proj-1" });
    });

    it("does not throw when saveMessages fails", async () => {
      mockMemory.saveMessages.mockRejectedValueOnce(new Error("write failed"));

      await expect(
        manager.save("proj-1", [{ role: "user", content: "Hello" }]),
      ).resolves.toBeUndefined();
    });

    it("does not throw when OM observation fails", async () => {
      mockOmEngine.observe.mockRejectedValueOnce(new Error("OM error"));

      await manager.save("proj-1", [{ role: "user", content: "Hello" }]);

      // Advance past debounce so the fire-and-forget observation runs.
      await vi.advanceTimersByTimeAsync(1000);

      // save() itself should still resolve without throwing.
      expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "proj-1" });
    });

    it("coalesces multiple rapid saves into a single observation", async () => {
      await manager.save("proj-1", [{ role: "user", content: "First" }]);
      await manager.save("proj-1", [{ role: "assistant", content: "Second" }]);
      await manager.save("proj-1", [{ role: "user", content: "Third" }]);

      expect(mockMemory.saveMessages).toHaveBeenCalledTimes(3);
      expect(mockOmEngine.observe).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockOmEngine.observe).toHaveBeenCalledTimes(1);
      expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "proj-1" });
    });

    it("observes different projects independently", async () => {
      await manager.save("proj-a", [{ role: "user", content: "A" }]);
      await manager.save("proj-b", [{ role: "user", content: "B" }]);

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockOmEngine.observe).toHaveBeenCalledTimes(2);
      expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "proj-a" });
      expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "proj-b" });
    });

    it("does not throw when omEngine resolves to null", async () => {
      mockMemory.omEngine = Promise.resolve(null) as any;
      await manager.save("proj-1", [{ role: "user", content: "Hello" }]);
      await vi.advanceTimersByTimeAsync(1000);
      // Should not throw
    });
  });

  // ------------------------------------------------------------------ initPromise retry

  describe("initPromise retry", () => {
    it("resets initPromise on store.init() failure so next call retries", async () => {
      mockLibSQLStoreInstance.init.mockRejectedValueOnce(new Error("DB locked"));

      const ctx1 = await manager.buildContext("proj-1");
      expect(ctx1).toEqual({ summary: "", historyMessages: [], hasObservations: false });

      mockLibSQLStoreInstance.init.mockResolvedValue(undefined);

      const ctx2 = await manager.buildContext("proj-1");
      expect(ctx2).toEqual({ summary: "", historyMessages: [], hasObservations: false });
    });
  });
});
