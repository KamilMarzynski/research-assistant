import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";

// Capture the subscriber so tests can trigger Pi events manually
let capturedSubscriber: ((event: unknown) => Promise<void>) | null = null;

const mockAgent = {
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  followUp: vi.fn(),
  state: { tools: [] },
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

vi.mock("electron", () => ({}));

vi.mock("./tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([]),
}));

vi.mock("./worker-agent", () => ({
  makeEvaluatorFn: vi.fn().mockReturnValue(vi.fn()),
}));

const { AgentSession } = await import("./session");

function triggerEvent(event: unknown) {
  expect(capturedSubscriber).not.toBeNull();
  // biome-ignore lint/style/noNonNullAssertion: expect() above narrowed the type
  return capturedSubscriber!(event);
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
    getHistory: vi.fn().mockResolvedValue([]),
    getRecentContext: vi.fn().mockResolvedValue([]),
  };
}

function makeWin() {
  return { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow;
}

function makeHomeService() {
  return {
    isFirstRun: vi.fn().mockResolvedValue(false),
    getHomePath: vi.fn().mockReturnValue("/tmp/.research-assistant"),
  };
}

function makeResearchService() {
  return {
    startResearch: vi.fn().mockResolvedValue({ taskId: "task-1" }),
  };
}

function makeMemoryManager() {
  return {
    buildContext: vi.fn().mockResolvedValue({ summary: "", recentMessages: [] }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AgentSession", () => {
  let messageService: ReturnType<typeof makeMessageService>;
  let win: Electron.BrowserWindow;
  let session: InstanceType<typeof AgentSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    messageService = makeMessageService();
    win = makeWin();
    session = new AgentSession({
      win,
      messageService: messageService as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: makeMemoryManager() as never,
      initialMemoryContext: { summary: "", recentMessages: [] },
      projectId: "p-1",
      projectName: "Test Project",
      folderPath: null,
      provider: { type: "openrouter", apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" },
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
    });
  });

  describe("send()", () => {
    it("persists user message before calling agent.prompt()", async () => {
      const sendPromise = session.send("hello");
      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "user",
        content: "hello",
      });
      await sendPromise;
      expect(mockAgent.prompt).toHaveBeenCalledWith("hello");
    });

    it("calls addMessage before prompt (order matters)", async () => {
      const order: string[] = [];
      messageService.addMessage.mockImplementation(async () => {
        order.push("addMessage");
        return {} as never;
      });
      mockAgent.prompt.mockImplementation(async () => {
        order.push("prompt");
      });
      await session.send("hello");
      expect(order).toEqual(["addMessage", "prompt"]);
    });
  });

  describe("Pi event → IPC mapping", () => {
    it("sends MESSAGE_CHUNK on text_delta", async () => {
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.MESSAGE_CHUNK, "Hello");
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

      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "assistant",
        content: "Hello world",
      });
    });

    it("sends MESSAGE_DONE on agent_end", async () => {
      await triggerEvent({ type: "agent_end", messages: [] });
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.MESSAGE_DONE);
    });

    it("does not persist empty assistant content on agent_end", async () => {
      await triggerEvent({ type: "agent_end", messages: [] });
      // addMessage should only have been called for user messages — not with assistant role
      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant",
      );
      expect(assistantCalls).toHaveLength(0);
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

      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant",
      );
      expect(assistantCalls[0][0].content).toBe("Second");
    });

    it("ignores non-text_delta message_update events", async () => {
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
      });
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe("abort()", () => {
    it("calls agent.abort()", () => {
      session.abort();
      expect(mockAgent.abort).toHaveBeenCalledOnce();
    });
  });

  describe("Agent constructor callbacks", () => {
    it("getApiKey returns the configured API key", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = vi.mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        getApiKey: () => Promise<string>;
        beforeToolCall: (ctx: {
          toolCall: { name: string };
        }) => Promise<{ block: boolean; reason: string } | undefined>;
      };
      const key = await options.getApiKey();
      expect(key).toBe("sk-or-test");
    });

    it("beforeToolCall blocks unregistered tools", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = vi.mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        getApiKey: () => Promise<string>;
        beforeToolCall: (ctx: {
          toolCall: { name: string };
        }) => Promise<{ block: boolean; reason: string } | undefined>;
      };
      const result = await options.beforeToolCall({ toolCall: { name: "unknown_tool" } });
      expect(result).toBeDefined();
      expect(result?.block).toBe(true);
    });
  });

  describe("first-run prompt injection", () => {
    it("includes first-run interview instructions when isFirstRun=true", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: true,
        systemContext: "",
        langfuseEnabled: false,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("How do you organise your projects");
    });

    it("does not include first-run instructions when isFirstRun=false", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).not.toContain("How do you organise");
    });
  });

  describe("queueFollowUp", () => {
    it("calls agent.followUp with the message", () => {
      session.queueFollowUp("Research complete: found 5 files.");
      expect(mockAgent.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ role: "user", content: "Research complete: found 5 files." }),
      );
    });
  });

  describe("memory saving", () => {
    it("calls memoryManager.save() with user + assistant content on agent_end", async () => {
      const memoryManager = makeMemoryManager();
      const localSession = new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
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
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
      });

      void localSession;
      await triggerEvent({ type: "agent_end", messages: [] });
      expect(memoryManager.save).not.toHaveBeenCalled();
    });

    it("injects memory summary into system prompt when non-empty", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: {
          summary: "Past context: user prefers TypeScript.",
          recentMessages: [],
        },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("Past context: user prefers TypeScript.");
    });

    it("does not call memoryManager.save() when lastUserContent is empty (follow-up turn)", async () => {
      const memoryManager = makeMemoryManager();
      const localSession = new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: memoryManager as never,
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
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

    it("injects recent messages as conversation history block when non-empty", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        win: makeWin() as never,
        messageService: makeMessageService() as never,
        homeService: makeHomeService() as never,
        researchService: makeResearchService() as never,
        memoryManager: makeMemoryManager() as never,
        initialMemoryContext: {
          summary: "",
          recentMessages: [
            { role: "user", content: "Hello from last session" },
            { role: "assistant", content: "Hi there from last session" },
          ],
        },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: {
          type: "openrouter",
          apiKey: "sk-or-test",
          model: "anthropic/claude-sonnet-4-6",
        },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("Hello from last session");
      expect(prompt).toContain("Hi there from last session");
      expect(prompt).toContain("<conversation_history>");
    });
  });
});
