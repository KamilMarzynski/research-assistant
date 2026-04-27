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

const { createWorkerAgent, makeEvaluatorFn } = await import("./worker-agent");

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

describe("makeEvaluatorFn", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
  });

  it("parses valid JSON from evaluator output and returns verdict", async () => {
    const verdict = {
      pass: true,
      criteria: [{ name: "completeness", pass: true, rationale: "All sections present" }],
    };
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: JSON.stringify(verdict) },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    const fn = makeEvaluatorFn({ ...BASE_CONFIG });
    const result = await fn("/some/path/output.md", ["completeness"]);
    expect(result.pass).toBe(true);
    expect(result.criteria[0].name).toBe("completeness");
  });

  it("returns parse-error verdict when evaluator output contains no JSON", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Sorry, I cannot evaluate this." },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    const fn = makeEvaluatorFn({ ...BASE_CONFIG });
    const result = await fn("/some/path/output.md", ["completeness"]);
    expect(result.pass).toBe(false);
    expect(result.criteria[0].name).toBe("parse-error");
    expect(result.criteria[0].rationale).toContain("valid JSON");
  });

  it("returns parse-error verdict when evaluator output has malformed JSON", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: '{ "pass": true, broken }' },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    const fn = makeEvaluatorFn({ ...BASE_CONFIG });
    const result = await fn("/some/path/output.md", ["completeness"]);
    expect(result.pass).toBe(false);
    expect(result.criteria[0].name).toBe("parse-error");
    expect(result.criteria[0].rationale).toContain("malformed JSON");
  });
});
