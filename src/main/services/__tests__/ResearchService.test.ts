import "reflect-metadata";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerAgentConfig } from "../../agent/worker-agent";

vi.mock("electron", () => ({
  safeStorage: {
    encryptString: vi.fn().mockReturnValue(Buffer.from("encrypted")),
    decryptString: vi.fn().mockReturnValue("decrypted"),
  },
}));

let capturedSubscriber: ((event: unknown) => void) | null = null;

const mockAgent = {
  state: { tools: [] as never[] },
  subscribe: vi.fn((cb: (event: unknown) => void) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({
    agent: mockAgent,
    run: vi.fn(),
  }),
  ORCHESTRATOR_TOOL_NAMES: [
    "read_file",
    "write_file",
    "list_dir",
    "safe_bash",
    "run_in_docker",
    "spawn_agent",
    "spawn_agents_parallel",
    "save_artifact",
    "propose_tool",
  ],
}));

type MockFn = ReturnType<typeof vi.fn>;

const { ResearchService } = await import("../ResearchService");

function makeEventBus() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    emit: vi.fn((event: { type: string; payload: unknown }) => {
      handlers.get(event.type)?.(event.payload);
    }),
    on: vi.fn((type: string, handler: (payload: unknown) => void) => {
      handlers.set(type, handler);
      return () => {};
    }),
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      activeProvider: "openrouter",
      defaultCloudProvider: "openrouter",
      providerCredentials: {
        openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-5" },
        openai: { apiKey: null, defaultModel: "gpt-4o" },
        anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
        ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
      },
      langfuseEnabled: false,
      webAccessEnabled: true,
    }),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/home"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/home/workspace/p1"),
    saveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    savePendingTool: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ResearchService", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("returns a taskId immediately", async () => {
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(taskId).toBeTruthy();
  });

  it("emits research:started event", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls homeService.saveTask with task details", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(home.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "research X" }),
    );
  });

  it("calls updateTaskStatus with complete on research:complete", async () => {
    const home = makeHomeService();
    const bus = makeEventBus();
    const svc = new ResearchService(bus as never, makeSettingsService() as never, home as never);
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(home.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
  });

  it("throws when no API key is configured for cloud provider", async () => {
    const settingsSvc = makeSettingsService();
    settingsSvc.getSettings.mockResolvedValue({
      activeProvider: "openrouter",
      defaultCloudProvider: "openrouter",
      providerCredentials: {
        openrouter: { apiKey: null, defaultModel: "anthropic/claude-sonnet-4-5" },
        openai: { apiKey: null, defaultModel: "gpt-4o" },
        anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
        ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
      },
      langfuseEnabled: false,
      webAccessEnabled: true,
    } as never);
    const svc = new ResearchService(
      makeEventBus() as never,
      settingsSvc as never,
      makeHomeService() as never,
    );
    await expect(svc.startResearch("p1", "My Project", "research X", null)).rejects.toThrow(
      "No API key configured",
    );
  });

  it("calls updateTaskStatus with failed on research error", async () => {
    const home = makeHomeService();
    const bus = makeEventBus();
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    createWorkerAgent.mockResolvedValueOnce({
      agent: {
        ...mockAgent,
        subscribe: vi.fn((cb) => {
          capturedSubscriber = cb;
          return () => {};
        }),
        prompt: vi.fn().mockRejectedValue(new Error("worker crashed")),
      } as never,
      run: vi.fn(),
    });
    const svc = new ResearchService(bus as never, makeSettingsService() as never, home as never);
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    // Let the promise rejection propagate
    await new Promise((r) => setTimeout(r, 10));

    expect(home.updateTaskStatus).toHaveBeenCalledWith(taskId, "failed", expect.any(String));
  });

  it("emits research:progress for text_delta message_update", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    });

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:progress",
        payload: expect.objectContaining({ message: "hello" }),
      }),
    );
  });

  it("emits research:progress without label for non-text_delta message_update", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });

    // No progress event should be emitted for non-text_delta
    const progressCalls = bus.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "research:progress",
    );
    expect(progressCalls).toHaveLength(0);
  });

  it("background cleanup removes old workspace directories", async () => {
    const home = makeHomeService();
    const workspaceRoot = join(home.getHomePath(), "workspace");
    const oldDir = join(workspaceRoot, "old-proj");

    const { mkdir: realMkdir, utimes, access } = await import("node:fs/promises");
    await realMkdir(oldDir, { recursive: true });
    const ancient = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldDir, ancient, ancient);

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    await new Promise((r) => setTimeout(r, 200));

    await expect(access(oldDir)).rejects.toThrow();
  });

  it("background cleanup skips entries where stat throws", async () => {
    const home = makeHomeService();
    const workspaceRoot = join(home.getHomePath(), "workspace");
    const badLink = join(workspaceRoot, "bad-link");

    const { mkdir: realMkdir, symlink } = await import("node:fs/promises");
    await realMkdir(workspaceRoot, { recursive: true });
    try {
      await symlink("/nonexistent/path", badLink);
    } catch {
      // Skip if symlinks not supported
      return;
    }

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    await new Promise((r) => setTimeout(r, 200));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("workspace cleanup: skipping entry"),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("emits research:complete with empty filePaths on agent_end", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:complete",
        payload: expect.objectContaining({ filePaths: [] }),
      }),
    );
  });

  it("calls savePendingTool when evaluator approves crystallization", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const home = makeHomeService();
    const evaluatorRun = vi.fn().mockResolvedValue(
      JSON.stringify({
        crystallize: true,
        skillName: "novel-research-pattern",
        skillDescription: "A reusable research pattern.",
      }),
    );
    createWorkerAgent.mockImplementation(async (config: WorkerAgentConfig) => {
      if (config.systemPromptAddition?.includes("skill evaluator")) {
        return { agent: { subscribe: vi.fn(), prompt: vi.fn() }, run: evaluatorRun };
      }
      return { agent: mockAgent, run: vi.fn() };
    });

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    await capturedSubscriber?.({ type: "agent_end" });

    expect(evaluatorRun).toHaveBeenCalled();
    expect(home.savePendingTool).toHaveBeenCalledWith(
      "novel-research-pattern",
      expect.stringContaining("A reusable research pattern."),
    );
  });

  it("does not call savePendingTool when evaluator rejects crystallization", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const home = makeHomeService();
    const evaluatorRun = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ crystallize: false, reason: "not reusable" }));
    createWorkerAgent.mockImplementation(async (config: WorkerAgentConfig) => {
      if (config.systemPromptAddition?.includes("skill evaluator")) {
        return { agent: { subscribe: vi.fn(), prompt: vi.fn() }, run: evaluatorRun };
      }
      return { agent: mockAgent, run: vi.fn() };
    });

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    await capturedSubscriber?.({ type: "agent_end" });

    expect(evaluatorRun).toHaveBeenCalled();
    expect(home.savePendingTool).not.toHaveBeenCalled();
  });

  it("does not call savePendingTool when evaluator returns invalid JSON", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const home = makeHomeService();
    const evaluatorRun = vi.fn().mockResolvedValue("not json");
    createWorkerAgent.mockImplementation(async (config: WorkerAgentConfig) => {
      if (config.systemPromptAddition?.includes("skill evaluator")) {
        return { agent: { subscribe: vi.fn(), prompt: vi.fn() }, run: evaluatorRun };
      }
      return { agent: mockAgent, run: vi.fn() };
    });

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    await capturedSubscriber?.({ type: "agent_end" });

    expect(evaluatorRun).toHaveBeenCalled();
    expect(home.savePendingTool).not.toHaveBeenCalled();
  });
});

describe("ResearchService – startOrchestratedResearch", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("returns a taskId immediately", async () => {
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    expect(taskId).toBeTruthy();
  });

  it("calls createWorkerAgent with remainingDepth: 3", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(expect.objectContaining({ remainingDepth: 3 }));
  });

  it("does not pass saveArtifactFn or proposeToolFn to createWorkerAgent", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    const call = createWorkerAgent.mock.calls[0][0];
    expect(call.saveArtifactFn).toBeUndefined();
    expect(call.proposeToolFn).toBeUndefined();
  });

  it("calls homeService.saveTask with task details", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    expect(home.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "deep research" }),
    );
  });

  it("emits research:started event", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls updateTaskStatus with complete on agent_end", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    await capturedSubscriber?.({ type: "agent_end" });
    expect(home.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
  });
});

describe("ResearchService – _runResearch internals", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("two sequential startResearch calls on same project produce identical system prompts", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query A", null);
    const firstCall = createWorkerAgent.mock.calls[0][0];

    await svc.startResearch("p1", "My Project", "query B", null);
    const secondCall = createWorkerAgent.mock.calls[1][0];

    // System prompts are identical (no task-specific path), but that's fine
    expect(firstCall.systemPromptAddition).toBe(secondCall.systemPromptAddition);
    expect(firstCall.systemPromptAddition).toContain("Name files meaningfully");
  });

  it("startResearch passes onProgress that emits research:progress with label", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];

    // Fire onProgress with a label
    call.onProgress?.("[researcher-1]", "some delta");

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:progress",
        payload: expect.objectContaining({ label: "[researcher-1]", message: "some delta" }),
      }),
    );
  });

  it("startOrchestratedResearch passes remainingDepth: 3 and onProgress", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startOrchestratedResearch("p1", "My Project", "deep query", null);
    const call = createWorkerAgent.mock.calls[0][0];

    expect(call.remainingDepth).toBe(3);
    expect(call.onProgress).toBeTypeOf("function");
  });

  it("onProgress does not emit research:progress when label is empty", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    vi.clearAllMocks();
    call.onProgress?.("", "some delta");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("logs workspace cleanup failure when getHomePath throws", async () => {
    const home = makeHomeService();
    home.getHomePath.mockReturnValueOnce("/tmp/home").mockImplementationOnce(() => {
      throw new Error("home path gone");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      home as never,
    );
    await svc.startResearch("p1", "My Project", "query", null);
    await new Promise((r) => setTimeout(r, 50));
    expect(consoleSpy).toHaveBeenCalledWith(
      "[ResearchService] workspace cleanup failed:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
