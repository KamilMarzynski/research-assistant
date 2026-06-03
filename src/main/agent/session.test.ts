import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus";
import { AllowlistService } from "../services/AllowlistService";

// Capture subscribers so tests can trigger Pi events manually
const subscribers: Array<(event: unknown) => Promise<void>> = [];

const mockAgent = {
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    subscribers.push(cb);
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  followUp: vi.fn(),
  state: { tools: [], systemPrompt: "", messages: [], isStreaming: false },
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest requires a regular function for constructable mocks
  Agent: vi.fn(function () {
    return mockAgent;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
  getModels: vi.fn().mockReturnValue([{ provider: "openrouter", id: "test-model" }]),
}));

vi.mock("./model-factory", () => ({
  createModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("./tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([{ name: "read_file" }, { name: "write_file" }]),
}));

vi.mock("./worker-agent", () => ({
  makeEvaluatorFn: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("./context", () => ({
  buildSystemContext: vi.fn().mockResolvedValue("mocked system context"),
  toSlug: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, "-")),
}));

const { AgentSession } = await import("./session");

async function triggerEvent(event: unknown) {
  expect(subscribers.length).toBeGreaterThan(0);
  for (const subscriber of subscribers) {
    await subscriber(event);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: vitest 4 does not export vi.mocked
function mocked<T>(value: T): T & { mock: { calls: any[][]; results: any[] } } {
  return value as never;
}

function makeMessageService() {
  return {
    addMessage: vi.fn().mockResolvedValue({
      id: "msg-1",
      projectId: "p-1",
      role: "user",
      content: "hi",
      createdAt: new Date(),
    }),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
    getRecentContext: vi.fn().mockResolvedValue([]),
  };
}

function makeEventBus() {
  const bus = new EventBus();
  vi.spyOn(bus, "emit");
  return bus;
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/.scholar"),
  };
}

function makeResearchService() {
  return {
    startResearch: vi.fn().mockResolvedValue({ taskId: "task-1" }),
    startOrchestratedResearch: vi.fn().mockResolvedValue({ taskId: "task-2" }),
  };
}

function makeMemoryManager() {
  return {
    buildContext: vi
      .fn()
      .mockResolvedValue({ summary: "", historyMessages: [], hasObservations: false }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeObservabilityService() {
  return {
    getTraceId: vi.fn().mockResolvedValue(null),
    observe: vi
      .fn()
      .mockImplementation(async (_name, fn) => fn({ update: () => {}, end: () => {} })),
    startObservation: vi.fn().mockResolvedValue(null),
  };
}

describe("AgentSession", () => {
  let messageService: ReturnType<typeof makeMessageService>;
  let eventBus: EventBus;
  let session: InstanceType<typeof AgentSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    subscribers.length = 0;
    messageService = makeMessageService();
    eventBus = makeEventBus();
    session = new AgentSession({
      eventBus,
      messageService: messageService as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: makeMemoryManager() as never,
      initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
      projectId: "p-1",
      slug: "test",
      projectName: "Test Project",
      folderPath: null,
      projectPath: null,
      provider: { type: "openrouter", apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" },
      systemContext: "",
      allowlistService: new AllowlistService() as never,
      observabilityService: makeObservabilityService() as never,
    });
  });

  describe("send()", () => {
    it("persists user message before calling agent.prompt()", async () => {
      await session.send("hello");
      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "user",
        content: "hello",
      });
      expect(mockAgent.prompt).toHaveBeenCalledWith("hello");
    });

    it("calls addMessage before prompt (order matters)", async () => {
      const order: string[] = [];
      messageService.addMessage.mockImplementation(async () => {
        order.push("addMessage");
        return {
          id: "msg-" + order.length,
          projectId: "p-1",
          role: "user",
          content: "",
          createdAt: new Date(),
        } as never;
      });
      mockAgent.prompt.mockImplementation(async () => {
        order.push("prompt");
      });
      await session.send("hello");
      expect(order).toEqual(["addMessage", "addMessage", "prompt"]);
    });

    it("rejects concurrent send() calls while processing", async () => {
      mockAgent.prompt.mockImplementation(async () => {
        mockAgent.state.isStreaming = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        mockAgent.state.isStreaming = false;
      });

      const first = session.send("first");
      while (mockAgent.prompt.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }
      await expect(session.send("second")).rejects.toThrow("already processing");
      await first;
    });

    it("sends info message and skips agent.prompt for /crystallize", async () => {
      await session.send("/crystallize");
      expect(mockAgent.prompt).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent:chunk",
          payload: expect.objectContaining({
            projectId: "p-1",
            delta: expect.stringContaining("automatic"),
          }),
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("sends info message and skips agent.prompt for 'always do it this way'", async () => {
      await session.send("Please always do it this way");
      expect(mockAgent.prompt).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent:chunk",
          payload: expect.objectContaining({
            projectId: "p-1",
            delta: expect.stringContaining("automatic"),
          }),
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("works without observabilityService", async () => {
      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: { type: "openrouter", apiKey: "sk-test", model: "test" },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
        // no observabilityService
      });
      await localSession.send("hello");
      expect(mockAgent.prompt).toHaveBeenCalledWith("hello");
    });
  });

  describe("Pi event → IPC mapping", () => {
    it("sends MESSAGE_CHUNK on text_delta", async () => {
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent:chunk",
          payload: { projectId: "p-1", delta: "Hello" },
        }),
      );
    });

    it("accumulates deltas and persists full content on agent_end", async () => {
      await session.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: " world" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Hello world",
        undefined,
        [{ type: "text", content: "Hello world" }],
      );
    });

    it("sends MESSAGE_DONE on agent_end", async () => {
      await triggerEvent({ type: "agent_end", messages: [] });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("flushes streaming message every 5 chunks", async () => {
      await session.send("my question");
      for (let i = 0; i < 5; i++) {
        await triggerEvent({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: String(i) },
        });
      }
      await triggerEvent({ type: "agent_end", messages: [] });
      // flush at chunk 5 + final update on agent_end
      expect(messageService.updateMessage).toHaveBeenCalledTimes(2);
      expect(messageService.updateMessage).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        "01234",
        undefined,
        [{ type: "text", content: "01234" }],
      );
    });

    it("does not persist empty assistant content on agent_end", async () => {
      await triggerEvent({ type: "agent_end", messages: [] });
      // updateMessage should NOT be called when content is empty
      expect(messageService.updateMessage).not.toHaveBeenCalled();
    });

    it("resets accumulated content after agent_end so next prompt starts fresh", async () => {
      await session.send("first question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "First" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      vi.clearAllMocks();

      await session.send("second question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Second" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Second",
        undefined,
        [{ type: "text", content: "Second" }],
      );
    });

    it("ignores non-text_delta message_update events", async () => {
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
      });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("logs subscriber error when eventBus.emit throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      (eventBus.emit as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("IPC broken");
      });
      await session.send("hello");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "x" },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        "[AgentSession] subscriber error:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("injectAssistantMessage", () => {
    it("pushes an assistant message into agent state", () => {
      session.injectAssistantMessage("injected content");
      const lastMsg = mockAgent.state.messages.at(-1);
      expect(lastMsg).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "injected content" }],
      });
      expect(lastMsg).toHaveProperty("timestamp");
    });
  });

  describe("abort()", () => {
    it("calls agent.abort()", () => {
      session.abort();
      expect(mockAgent.abort).toHaveBeenCalledOnce();
    });
  });

  describe("isProcessing()", () => {
    it("returns false when idle", () => {
      mockAgent.state.isStreaming = false;
      expect(session.isProcessing()).toBe(false);
    });

    it("returns true while agent is streaming", () => {
      mockAgent.state.isStreaming = true;
      expect(session.isProcessing()).toBe(true);
      mockAgent.state.isStreaming = false;
    });

    it("returns true while send() is running", async () => {
      let resolvePrompt: (() => void) | undefined;
      mockAgent.prompt.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            mockAgent.state.isStreaming = true;
            resolvePrompt = resolve;
          }),
      );
      const sendPromise = session.send("hello");
      while (mockAgent.prompt.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(session.isProcessing()).toBe(true);
      resolvePrompt?.();
      mockAgent.state.isStreaming = false;
      await sendPromise;
      expect(session.isProcessing()).toBe(false);
    });
  });

  describe("Agent constructor callbacks", () => {
    it("getApiKey returns the configured API key", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        getApiKey: () => Promise<string>;
      };
      const key = await options.getApiKey();
      expect(key).toBe("sk-or-test");
    });

    it("works without eventBus (emitBlocked undefined)", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const opts = lastCall?.[0] as { initialState: { tools: unknown[] } };
      expect(opts.initialState.tools).toBeDefined();
    });

    it("beforeToolCall blocks unregistered tools", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        beforeToolCall: (ctx: {
          toolCall: { name: string };
        }) => Promise<{ block?: boolean; reason?: string } | undefined>;
      };
      const result = await options.beforeToolCall({ toolCall: { name: "malicious_tool" } });
      expect(result).toEqual({ block: true, reason: 'Tool "malicious_tool" is not registered.' });
    });

    it("beforeToolCall allows registered tools", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        beforeToolCall: (ctx: {
          toolCall: { name: string };
        }) => Promise<{ block?: boolean; reason?: string } | undefined>;
      };
      const result = await options.beforeToolCall({ toolCall: { name: "read_file" } });
      expect(result).toBeUndefined();
    });

    it("getApiKey returns ollama for ollama provider", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const { createAgentTools } = await import("./tools");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: { type: "ollama", host: "http://localhost:11434", model: "llama3" },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const opts = lastCall?.[0] as { getApiKey: () => Promise<string> };
      const key = await opts.getApiKey();
      expect(key).toBe("ollama");
      expect(createAgentTools).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "ollama" }));
    });

    it("startResearchFn delegates to startOrchestratedResearch when deep is true", async () => {
      const researchService = makeResearchService();
      const { createAgentTools } = await import("./tools");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: researchService as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const opts = mocked(createAgentTools).mock.calls.at(-1)?.[0] as {
        startResearchFn?: (query: string, deep?: boolean) => Promise<unknown>;
      };
      await opts?.startResearchFn?.("deep query", true);
      expect(researchService.startOrchestratedResearch).toHaveBeenCalledWith(
        "p-1",
        "Test",
        "deep query",
        null,
        null,
      );
    });
  });

  describe("system prompt — no first-run branch", () => {
    it("always uses basePrompt regardless of project setup state", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("You are a research coordinator");
    });
  });

  describe("queueFollowUp", () => {
    it("delegates to agent.followUp() with the message", async () => {
      await session.queueFollowUp("Research complete: found 5 files.");
      expect(mockAgent.followUp).toHaveBeenCalledWith({
        role: "user",
        content: "Research complete: found 5 files.",
        timestamp: expect.any(Number),
      });
    });

    it("does not call agent.prompt directly", async () => {
      await session.queueFollowUp("follow-up");
      expect(mockAgent.prompt).not.toHaveBeenCalled();
    });
  });

  describe("memory saving", () => {
    it("calls memoryManager.save() with user + assistant content on agent_end", async () => {
      const memoryManager = makeMemoryManager();
      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      await localSession.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "answer" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      expect(memoryManager.save).toHaveBeenCalledWith("p-1", [
        { role: "user", content: "my question" },
        { role: "assistant", content: "answer" },
      ]);
    });

    it("does not call memoryManager.save() when assistant content is empty", async () => {
      const memoryManager = makeMemoryManager();
      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      void localSession;
      await triggerEvent({ type: "agent_end", messages: [] });
      expect(memoryManager.save).not.toHaveBeenCalled();
    });

    it("injects memory summary into system prompt when non-empty", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: {
          summary: "Past context: user prefers TypeScript.",
          historyMessages: [],
          hasObservations: false,
        },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("Past context: user prefers TypeScript.");
    });

    it("does not call memoryManager.save() when lastUserContent is empty (follow-up turn)", async () => {
      const memoryManager = makeMemoryManager();
      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      // Simulate a follow-up turn: assistant responds but lastUserContent was never set via send()
      void localSession;
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "follow-up response" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      // lastUserContent is "" so save should NOT be called
      expect(memoryManager.save).not.toHaveBeenCalled();
    });

    it("seeds initialState.messages with recent messages from memory context", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: {
          summary: "",
          historyMessages: [
            { role: "user", content: "Hello from last session" },
            { role: "assistant", content: "Hi there from last session" },
          ],
          hasObservations: false,
        },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const messages = (
        lastCall?.[0] as {
          initialState: { messages?: Array<{ role: string; content: string }> };
        }
      )?.initialState?.messages;
      expect(messages).toHaveLength(2);
      expect(messages?.[0]).toMatchObject({ role: "user", content: "Hello from last session" });
      expect(messages?.[1]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "Hi there from last session" }],
      });
      expect(messages?.[0]).toHaveProperty("timestamp");
      expect(messages?.[1]).toHaveProperty("timestamp");
    });

    it("does not inject conversation history into system prompt", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: {
          summary: "",
          historyMessages: [
            { role: "user", content: "Hello from last session" },
            { role: "assistant", content: "Hi there from last session" },
          ],
          hasObservations: false,
        },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).not.toContain("Hello from last session");
      expect(prompt).not.toContain("Hi there from last session");
      expect(prompt).not.toContain("<conversation_history>");
    });

    it("passes transformContext that prunes messages exceeding token budget", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const transformContext = (
        lastCall?.[0] as {
          transformContext?: (
            messages: Array<{ role: string; content: string }>,
          ) => Promise<Array<{ role: string; content: string }>>;
        }
      )?.transformContext;
      expect(transformContext).toBeDefined();

      // A message large enough to exceed the Claude 200k context window budget
      const longMessage = "x".repeat(800_000); // ~200k tokens
      const messages = [
        { role: "user" as const, content: longMessage },
        { role: "assistant" as const, content: "middle" },
        { role: "user" as const, content: "latest" },
      ];
      if (!transformContext) throw new Error("transformContext expected");
      const result = await transformContext(messages);
      // The oldest oversized message is pruned; the two newest are kept
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("middle");
      expect(result[1].content).toBe("latest");
    });
  });

  describe("turn deduplication", () => {
    it("saves only once when agent_end fires twice", async () => {
      await session.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "answer" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });
      await triggerEvent({ type: "agent_end", messages: [] });

      expect(messageService.addMessage).toHaveBeenCalledTimes(2); // 1 user + 1 assistant placeholder
      expect(messageService.updateMessage).toHaveBeenCalledTimes(1);
      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "answer",
        undefined,
        [{ type: "text", content: "answer" }],
      );
    });

    it("resets dedup guard for the next turn", async () => {
      await session.send("first");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "A" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      vi.clearAllMocks();

      await session.send("second");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "B" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      expect(messageService.updateMessage).toHaveBeenCalledTimes(1);
      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "B",
        undefined,
        [{ type: "text", content: "B" }],
      );
    });
  });

  describe("abort()", () => {
    it("deletes empty placeholder when aborted during thinking", async () => {
      let resolvePrompt: (() => void) | undefined;
      mockAgent.prompt.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const sendPromise = session.send("my question");
      // Wait until send() reaches agent.prompt() so the placeholder exists
      while (mockAgent.prompt.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      session.abort();
      resolvePrompt?.();
      await sendPromise.catch(() => {});

      expect(messageService.deleteMessage).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("finalizes partial content when aborted mid-stream", async () => {
      await session.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Partial" },
      });
      session.abort();

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Partial",
        undefined,
        [{ type: "text", content: "Partial" }],
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("logs error when deleteMessage throws during abort", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      messageService.deleteMessage.mockRejectedValueOnce(new Error("db locked"));
      let resolvePrompt: (() => void) | undefined;
      mockAgent.prompt.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      );

      const sendPromise = session.send("my question");
      while (mockAgent.prompt.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      session.abort();
      resolvePrompt?.();
      await sendPromise.catch(() => {});

      expect(consoleSpy).toHaveBeenCalledWith(
        "[AgentSession] failed to delete empty placeholder:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("logs error when updateMessage throws during abort", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      messageService.updateMessage.mockRejectedValueOnce(new Error("db locked"));
      await session.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Partial" },
      });
      session.abort();

      // The catch handler is fire-and-forget (void), so we need to wait a tick
      await new Promise((r) => setTimeout(r, 10));

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Partial",
        undefined,
        [{ type: "text", content: "Partial" }],
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[AgentSession] failed to finalize partial message:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("send() error handling", () => {
    it("catches and logs error when system context refresh fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { buildSystemContext } = await import("./context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("disk full"),
      );

      await session.send("hello");
      expect(consoleSpy).toHaveBeenCalledWith(
        "[AgentSession] Failed to refresh system context:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("throws when agent.prompt throws and ends tracer turn", async () => {
      mockAgent.prompt.mockRejectedValueOnce(new Error("model overload"));
      await expect(session.send("hello")).rejects.toThrow("model overload");
    });
  });

  describe("system prompt refresh", () => {
    it("does NOT change systemPrompt when summary and context are unchanged", async () => {
      const { buildSystemContext } = await import("./context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("stable context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("stable context");

      const memoryManager = makeMemoryManager();
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "stable summary",
        historyMessages: [],
        hasObservations: false,
      });
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "stable summary",
        historyMessages: [],
        hasObservations: false,
      });

      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      await localSession.send("hello");
      const firstPrompt = mockAgent.state.systemPrompt;

      await localSession.send("hello again");
      expect(mockAgent.state.systemPrompt).toBe(firstPrompt);
    });

    it("DOES change systemPrompt when summary changes", async () => {
      const { buildSystemContext } = await import("./context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("stable context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("stable context");

      const memoryManager = makeMemoryManager();
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "first summary",
        historyMessages: [],
        hasObservations: false,
      });
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "changed summary",
        historyMessages: [],
        hasObservations: false,
      });

      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      await localSession.send("hello");
      const firstPrompt = mockAgent.state.systemPrompt;

      await localSession.send("hello again");
      expect(mockAgent.state.systemPrompt).not.toBe(firstPrompt);
      expect(mockAgent.state.systemPrompt).toContain("changed summary");
    });

    it("DOES change systemPrompt when buildSystemContext returns different context", async () => {
      const { buildSystemContext } = await import("./context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("first context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("changed context");

      const memoryManager = makeMemoryManager();
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "stable summary",
        historyMessages: [],
        hasObservations: false,
      });
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "stable summary",
        historyMessages: [],
        hasObservations: false,
      });

      const localSession = new AgentSession({
        eventBus: makeEventBus(),
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
        projectId: "p-1",
        slug: "test",
        projectName: "Test",
        folderPath: null,
        projectPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        systemContext: "",
        allowlistService: new AllowlistService() as never,
      });

      await localSession.send("hello");
      const firstPrompt = mockAgent.state.systemPrompt;

      await localSession.send("hello again");
      expect(mockAgent.state.systemPrompt).not.toBe(firstPrompt);
      expect(mockAgent.state.systemPrompt).toContain("changed context");
    });
  });

  it("passes resolved model metadata into createModel", async () => {
    const { createModel } = (await import("./model-factory")) as unknown as {
      createModel: ReturnType<typeof vi.fn>;
    };

    new AgentSession({
      eventBus: makeEventBus(),
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: makeMemoryManager() as never,
      initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
      projectId: "p-1",
      slug: "test",
      projectName: "Test Project",
      folderPath: null,
      projectPath: null,
      provider: { type: "openai", apiKey: "sk-openai", model: "gpt-4o" },
      resolvedModelMetadata: {
        id: "gpt-4o",
        name: "gpt-4o",
        provider: "openai",
        maxContextWindow: 128000,
        effectiveContextWindow: 128000,
        source: "pi-ai",
      },
      allowlistService: new AllowlistService() as never,
    });

    expect(createModel).toHaveBeenCalledWith({
      provider: { type: "openai", apiKey: "sk-openai", model: "gpt-4o" },
      metadata: {
        id: "gpt-4o",
        name: "gpt-4o",
        provider: "openai",
        maxContextWindow: 128000,
        effectiveContextWindow: 128000,
        source: "pi-ai",
      },
    });
  });

  describe("Agent constructor sessionId", () => {
    it("passes sessionId to Agent constructor", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const options = lastCall?.[0] as { sessionId?: string };
      expect(options.sessionId).toBeDefined();
      expect(typeof options.sessionId).toBe("string");
    });
  });

  describe("Agent constructor afterToolCall", () => {
    it("compresses large text tool outputs", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const options = lastCall?.[0] as {
        afterToolCall?: (ctx: {
          isError: boolean;
          result: { content: Array<{ type: string; text?: string }> };
        }) => Promise<{ content?: Array<{ type: string; text?: string }> } | undefined>;
      };
      expect(options.afterToolCall).toBeDefined();

      const longText = "x".repeat(25_000);
      const result = await options.afterToolCall?.({
        isError: false,
        result: { content: [{ type: "text", text: longText }] },
      });
      expect(result).toBeDefined();
      expect(result?.content?.[0]).toBeDefined();
      if (result?.content?.[0] && "text" in result.content[0]) {
        const textContent = result.content[0] as { text: string };
        expect(textContent.text.length).toBeLessThan(longText.length);
        expect(textContent.text).toContain("truncated");
      }
    });

    it("does not compress small text outputs", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const options = lastCall?.[0] as {
        afterToolCall?: (ctx: {
          isError: boolean;
          result: { content: Array<{ type: string; text?: string }> };
        }) => Promise<{ content?: Array<{ type: string; text?: string }> } | undefined>;
      };
      const shortText = "short output";
      const result = await options.afterToolCall?.({
        isError: false,
        result: { content: [{ type: "text", text: shortText }] },
      });
      expect(result).toBeUndefined();
    });

    it("does not compress error tool outputs", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const lastCall = mocked(Agent).mock.calls.at(-1);
      const options = lastCall?.[0] as {
        afterToolCall?: (ctx: {
          isError: boolean;
          result: { content: Array<{ type: string; text?: string }> };
        }) => Promise<{ content?: Array<{ type: string; text?: string }> } | undefined>;
      };
      const longText = "x".repeat(25_000);
      const result = await options.afterToolCall?.({
        isError: true,
        result: { content: [{ type: "text", text: longText }] },
      });
      expect(result).toBeUndefined();
    });
  });
});
