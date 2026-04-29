import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function makeArtifactService() {
  return {
    saveArtifact: vi.fn().mockResolvedValue({ id: "art-1", filePath: "/workspace/output.md" }),
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      openrouterApiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-5",
    }),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/home"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/home/workspace/p1"),
    saveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
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
      makeArtifactService() as never,
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
      makeArtifactService() as never,
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
      makeArtifactService() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(home.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "research X" }),
    );
  });

  it("calls homeService.deleteTask on research:complete", async () => {
    const home = makeHomeService();
    const artifacts = makeArtifactService();
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      artifacts as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
  });

  it("calls homeService.deleteTask on research:failed", async () => {
    const home = makeHomeService();
    const bus = makeEventBus();
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    vi.mocked(createWorkerAgent).mockResolvedValueOnce({
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
    const svc = new ResearchService(
      bus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    // Let the promise rejection propagate
    await new Promise((r) => setTimeout(r, 10));

    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
  });

  it("emits research:complete and saves artifact on agent_end", async () => {
    const bus = makeEventBus();
    const artifacts = makeArtifactService();
    const svc = new ResearchService(
      bus as never,
      artifacts as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(artifacts.saveArtifact).toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
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
      makeArtifactService() as never,
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
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(expect.objectContaining({ remainingDepth: 3 }));
  });

  it("calls createWorkerAgent with saveArtifactFn callback", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ saveArtifactFn: expect.any(Function) }),
    );
  });

  it("saveArtifactFn callback delegates to artifactService.saveArtifact", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const artifacts = makeArtifactService();
    const svc = new ResearchService(
      makeEventBus() as never,
      artifacts as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];
    await call.saveArtifactFn?.("/tmp/home/workspace/p1/output.md", "My Artifact");
    expect(artifacts.saveArtifact).toHaveBeenCalledWith({
      projectId: "p1",
      title: "My Artifact",
      filePath: "/tmp/home/workspace/p1/output.md",
    });
  });

  it("calls homeService.saveTask with task details", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
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
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls homeService.deleteTask on agent_end", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
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
    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
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

  it("two sequential startResearch calls on same project produce different output paths", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query A", null);
    const firstCall = vi.mocked(createWorkerAgent).mock.calls[0][0];

    await svc.startResearch("p1", "My Project", "query B", null);
    const secondCall = vi.mocked(createWorkerAgent).mock.calls[1][0];

    // Workspace paths differ because taskIds differ
    expect(firstCall.systemPromptAddition).not.toBe(secondCall.systemPromptAddition);
    expect(firstCall.systemPromptAddition).toContain("output.md");
    expect(secondCall.systemPromptAddition).toContain("output.md");
  });

  it("startResearch passes onProgress that emits research:progress with label", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];

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
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startOrchestratedResearch("p1", "My Project", "deep query", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];

    expect(call.remainingDepth).toBe(3);
    expect(call.onProgress).toBeTypeOf("function");
  });
});
