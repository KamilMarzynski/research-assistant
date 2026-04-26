import { beforeEach, describe, expect, it, vi } from "vitest";

// Captured subscriber so tests can fire Pi events manually
let capturedSubscriber: ((event: unknown) => Promise<void>) | null = null;

const mockAgent = {
  state: { tools: [] as never[], systemPrompt: "" },
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest constructable mock
  Agent: vi.fn(function () {
    return mockAgent;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("./context", () => ({
  loadSkillsByContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("./tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([{ name: "read_file" }, { name: "safe_bash" }]),
}));

const { createWorkerAgent } = await import("./worker-agent");

const BASE_CONFIG = {
  toolNames: ["read_file", "safe_bash"] as const,
  systemPromptAddition: "You are a worker.",
  projectId: "proj-1",
  projectName: "Test",
  folderPath: null,
  homePath: "/tmp/home",
  apiKey: "sk-or-test",
  model: "anthropic/claude-sonnet-4-5",
};

describe("createWorkerAgent", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("creates a Pi Agent and assigns tools", async () => {
    const { agent } = await createWorkerAgent(BASE_CONFIG);
    expect(agent).toBe(mockAgent);
    expect(mockAgent.state.tools).toHaveLength(2);
  });

  it("calls loadSkillsByContent with provided skill names", async () => {
    const { loadSkillsByContent } = await import("./context");
    await createWorkerAgent({ ...BASE_CONFIG, skills: ["evaluate-research"] });
    expect(loadSkillsByContent).toHaveBeenCalledWith(["evaluate-research"], undefined);
  });

  it("run() resolves with accumulated text_delta chunks", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello " },
      });
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "world" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    const { run } = await createWorkerAgent(BASE_CONFIG);
    const result = await run("test prompt");
    expect(result).toBe("Hello world");
  });

  it("run() rejects when agent.prompt throws", async () => {
    mockAgent.prompt.mockRejectedValue(new Error("network error"));
    const { run } = await createWorkerAgent(BASE_CONFIG);
    await expect(run("test")).rejects.toThrow("network error");
  });
});
