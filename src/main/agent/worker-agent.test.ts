import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("createWorkerAgent – depth limit", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("depth defaults to 0 — orchestrator-only tools filtered from createAgentTools call", async () => {
    const { createAgentTools } = await import("./tools");
    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["read_file", "spawn_agent", "save_artifact"] as const,
    });
    expect(createAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNames: ["read_file"],
      }),
    );
  });

  it("when remainingDepth > 0, orchestrator tools pass through to createAgentTools", async () => {
    const { createAgentTools } = await import("./tools");
    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["read_file", "spawn_agent", "save_artifact"] as const,
      remainingDepth: 2,
    });
    expect(createAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNames: ["read_file", "spawn_agent", "save_artifact"],
      }),
    );
  });
});

describe("createWorkerAgent – AGENT_TYPE_PRESETS (spawn label propagation)", () => {
  beforeEach(async () => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    const { Agent } = await import("@mariozechner/pi-agent-core");
    vi.mocked(Agent).mockImplementation(function (this: unknown) {
      return mockAgent;
    } as never);
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({ type: "agent_end" });
    });
  });

  afterEach(async () => {
    // Restore Agent to return shared mockAgent after any per-call overrides
    const { Agent } = await import("@mariozechner/pi-agent-core");
    vi.mocked(Agent).mockImplementation(function (this: unknown) {
      return mockAgent;
    } as never);
  });

  it("spawnAgentFn passes [researcher] label to child createWorkerAgent", async () => {
    const { createAgentTools } = await import("./tools");
    const capturedConfigs: unknown[] = [];
    vi.mocked(createAgentTools).mockImplementation((opts) => {
      capturedConfigs.push(opts);
      return [];
    });

    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["spawn_agent"] as const,
      remainingDepth: 1,
    });

    // Parent was configured — get its spawnAgentFn
    const parentOpts = capturedConfigs[0] as {
      spawnAgentFn?: (type: string, query: string, outputPath: string) => Promise<unknown>;
    };
    expect(parentOpts.spawnAgentFn).toBeDefined();

    // Call spawnAgentFn — child createWorkerAgent will be called (second Agent instantiation)
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await parentOpts.spawnAgentFn!("researcher", "q1", "/tmp/out.md");

    // createAgentTools called twice: parent + child
    expect(capturedConfigs).toHaveLength(2);
  });

  it("spawnAgentsParallelFn assigns indexed labels [researcher-1] and [researcher-2]", async () => {
    // Each new Agent() must get its own subscribe/prompt so parallel children
    // don't clobber each other's subscriber reference.
    const { Agent } = await import("@mariozechner/pi-agent-core");
    vi.mocked(Agent).mockImplementation(function (this: unknown) {
      const sub = vi.fn();
      const prom = vi.fn();
      const childAgent = { subscribe: sub, prompt: prom, state: { tools: [] as never[] } };
      prom.mockImplementation(async () => {
        // Fire this agent's own subscriber, not the shared capturedSubscriber
        const cb = sub.mock.calls[0]?.[0] as ((e: unknown) => Promise<void>) | undefined;
        if (cb) {
          await cb({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "d" },
          });
          await cb({ type: "agent_end" });
        }
      });
      return childAgent;
    } as never);

    const onProgress = vi.fn();

    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["spawn_agents_parallel"] as const,
      remainingDepth: 1,
      onProgress,
    });

    const { createAgentTools } = await import("./tools");
    const parentOpts = vi.mocked(createAgentTools).mock.calls[0][0] as {
      spawnAgentsParallelFn?: (
        agents: Array<{ type: string; query: string; outputPath: string }>,
      ) => Promise<unknown>;
    };
    expect(parentOpts.spawnAgentsParallelFn).toBeDefined();

    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await parentOpts.spawnAgentsParallelFn!([
      { type: "researcher", query: "q1", outputPath: "/tmp/r1.md" },
      { type: "researcher", query: "q2", outputPath: "/tmp/r2.md" },
    ]);

    const labels = onProgress.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(labels).toContain("[researcher-1]");
    expect(labels).toContain("[researcher-2]");
  });
});

describe("createWorkerAgent – onProgress", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("run() calls onProgress with agentLabel and delta for each text_delta", async () => {
    const onProgress = vi.fn();
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "chunk" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent({
      ...BASE_CONFIG,
      agentLabel: "[researcher-1]",
      onProgress,
    });
    await run("test");
    expect(onProgress).toHaveBeenCalledWith("[researcher-1]", "chunk");
  });

  it("run() uses empty string label when agentLabel not set", async () => {
    const onProgress = vi.fn();
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "x" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent({ ...BASE_CONFIG, onProgress });
    await run("test");
    expect(onProgress).toHaveBeenCalledWith("", "x");
  });

  it("run() does not throw when onProgress is not provided", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "y" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent(BASE_CONFIG);
    await expect(run("test")).resolves.toBe("y");
  });
});

describe("makeEvaluatorFn", () => {
  beforeEach(async () => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    // Restore Agent mock to return shared mockAgent
    const { Agent } = await import("@mariozechner/pi-agent-core");
    vi.mocked(Agent).mockImplementation(function (this: unknown) {
      return mockAgent;
    } as never);
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
