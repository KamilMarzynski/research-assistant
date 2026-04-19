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
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest requires a regular function for constructable mocks
  Agent: vi.fn(function () {
    return mockAgent;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("electron", () => ({}));

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
      projectId: "p-1",
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
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
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "First" },
      });
      await triggerEvent({ type: "agent_end", messages: [] });

      vi.clearAllMocks();

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
        beforeToolCall: () => Promise<{ block: boolean; reason: string }>;
      };
      const key = await options.getApiKey();
      expect(key).toBe("sk-or-test");
    });

    it("beforeToolCall blocks all tool calls until Run 6", async () => {
      const { Agent } = await import("@mariozechner/pi-agent-core");
      const constructorCall = vi.mocked(Agent).mock.calls[0];
      const options = constructorCall[0] as {
        getApiKey: () => Promise<string>;
        beforeToolCall: () => Promise<{ block: boolean; reason: string }>;
      };
      const result = await options.beforeToolCall();
      expect(result.block).toBe(true);
      expect(result.reason).toMatch(/Run 6/);
    });
  });
});
