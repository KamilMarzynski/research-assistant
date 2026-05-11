import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus";
import { AllowlistService } from "../services/AllowlistService";

// Capture the subscriber so tests can trigger Pi events manually
let capturedSubscriber: ((event: unknown) => Promise<void>) | null = null;

const mockAgent = {
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  followUp: vi.fn(),
  state: { tools: [], systemPrompt: "" },
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

function makeEventBus() {
  const bus = new EventBus();
  vi.spyOn(bus, "emit");
  return bus;
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
    startOrchestratedResearch: vi.fn().mockResolvedValue({ taskId: "task-2" }),
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
  let eventBus: EventBus;
  let session: InstanceType<typeof AgentSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    messageService = makeMessageService();
    eventBus = makeEventBus();
    session = new AgentSession({
      eventBus,
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
      allowlistService: new AllowlistService() as never,
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
        return {} as never;
      });
      mockAgent.prompt.mockImplementation(async () => {
        order.push("prompt");
      });
      await session.send("hello");
      expect(order).toEqual(["addMessage", "prompt"]);
    });

    it("rejects concurrent send() calls while processing", async () => {
      mockAgent.prompt.mockImplementation(async () => {
        // simulate a long-running prompt
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const first = session.send("first");
      // immediately try a second send while first is still processing
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

      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "assistant",
        content: "Hello world",
      });
    });

    it("sends MESSAGE_DONE on agent_end", async () => {
      await triggerEvent({ type: "agent_end", messages: [] });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
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
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const opts = lastCall?.[0] as { initialState: { tools: unknown[] } };
      expect(opts.initialState.tools).toBeDefined();
    });

    it("beforeToolCall blocks unregistered tools", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = vi.mocked(Agent).mock.calls[0];
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
      const constructorCall = vi.mocked(Agent).mock.calls[0];
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
        initialMemoryContext: { summary: "", recentMessages: [] },
        projectId: "p-1",
        projectName: "Test",
        folderPath: null,
        provider: { type: "ollama", host: "http://localhost:11434", model: "llama3" },
        isFirstRun: false,
        systemContext: "",
        langfuseEnabled: false,
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
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
        allowlistService: new AllowlistService() as never,
      });
      const opts = vi.mocked(createAgentTools).mock.calls.at(-1)?.[0] as {
        startResearchFn?: (query: string, deep?: boolean) => Promise<unknown>;
      };
      await opts?.startResearchFn?.("deep query", true);
      expect(researchService.startOrchestratedResearch).toHaveBeenCalledWith(
        "p-1",
        "Test",
        "deep query",
        null,
      );
    });
  });

  describe("first-run prompt injection", () => {
    it("includes first-run interview instructions when isFirstRun=true", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
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
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("How do you organise your projects");
    });

    it("does not include first-run instructions when isFirstRun=false", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
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
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).not.toContain("How do you organise");
    });
  });

  describe("queueFollowUp", () => {
    it("calls agent.followUp with the message", async () => {
      await session.queueFollowUp("Research complete: found 5 files.");
      expect(mockAgent.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ role: "user", content: "Research complete: found 5 files." }),
      );
    });

    it("throws when followUp fails", async () => {
      mockAgent.followUp.mockRejectedValueOnce(new Error("network error"));
      await expect(session.queueFollowUp("follow-up")).rejects.toThrow("network error");
    });

    it("defers followUp while send() is processing and runs it after send completes", async () => {
      mockAgent.prompt.mockImplementation(async () => {
        // While prompt is running, queue a follow-up
        await session.queueFollowUp("deferred follow-up");
      });

      await session.send("hello");
      // followUp should have been called after prompt resolved
      expect(mockAgent.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: "deferred follow-up" }),
      );
    });

    it("defers followUp when another followUp is in progress", async () => {
      let resolveFollowUp: (() => void) | undefined;
      mockAgent.followUp.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFollowUp = resolve;
          }),
      );

      const firstPromise = session.queueFollowUp("first");
      // immediately queue a second follow-up while first is still processing
      const secondPromise = session.queueFollowUp("second");

      expect(mockAgent.followUp).toHaveBeenCalledTimes(1);
      expect(mockAgent.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: "first" }),
      );

      // resolve the first followUp
      resolveFollowUp?.();
      await firstPromise;
      await secondPromise;

      // second should now have run too
      expect(mockAgent.followUp).toHaveBeenCalledTimes(2);
      expect(mockAgent.followUp).toHaveBeenLastCalledWith(
        expect.objectContaining({ content: "second" }),
      );
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
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
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

    it("injects recent messages as conversation history block when non-empty", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      new AgentSession({
        eventBus: makeEventBus(),
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
        allowlistService: new AllowlistService() as never,
      });
      const lastCall = vi.mocked(Agent).mock.calls.at(-1);
      const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
        ?.systemPrompt;
      expect(prompt).toContain("Hello from last session");
      expect(prompt).toContain("Hi there from last session");
      expect(prompt).toContain("<conversation_history>");
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

      expect(messageService.addMessage).toHaveBeenCalledTimes(2); // 1 user + 1 assistant
      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant",
      );
      expect(assistantCalls).toHaveLength(1);
      expect(assistantCalls[0][0].content).toBe("answer");
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

      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant",
      );
      expect(assistantCalls).toHaveLength(1);
      expect(assistantCalls[0][0].content).toBe("B");
    });
  });

  describe("system prompt refresh", () => {
    it("updates agent.state.systemPrompt on send()", async () => {
      const { buildSystemContext } = await import("./context");
      (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce("refreshed context");

      const memoryManager = makeMemoryManager();
      (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        summary: "refreshed summary",
        recentMessages: [{ role: "user", content: "hi" }],
      });

      const localSession = new AgentSession({
        eventBus: makeEventBus(),
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
        allowlistService: new AllowlistService() as never,
      });

      await localSession.send("hello");
      expect(mockAgent.state.systemPrompt).toContain("refreshed context");
      expect(mockAgent.state.systemPrompt).toContain("refreshed summary");
      expect(mockAgent.state.systemPrompt).toContain("hi");
    });
  });
});
