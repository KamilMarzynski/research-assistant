import "reflect-metadata";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../db/migrate";
import * as schema from "../../db/schema";
import { projects } from "../../db/schema";
import { AllowlistService } from "../AllowlistService";

const { TaskPersistenceService } = await import("../TaskPersistenceService");

vi.mock("electron", () => ({
  safeStorage: {
    encryptString: vi.fn().mockReturnValue(Buffer.from("encrypted")),
    decryptString: vi.fn().mockReturnValue("decrypted"),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

vi.mock("../../agent/worker-agent", () => {
  const captured = { current: null as ((event: unknown) => void) | null };
  const agent = {
    state: { tools: [] as never[] },
    subscribe: vi.fn((cb: (event: unknown) => void) => {
      captured.current = cb;
    }),
    prompt: vi.fn().mockResolvedValue(undefined),
  };
  (globalThis as Record<string, unknown>).__testMockAgent = agent;
  (globalThis as Record<string, unknown>).__testCaptured = captured;
  return {
    createWorkerAgent: vi
      .fn()
      .mockResolvedValue({ agent, run: vi.fn().mockResolvedValue(undefined) }),
    ORCHESTRATOR_TOOL_NAMES: [
      "read_file",
      "write_file",
      "list_dir",
      "safe_bash",
      "run_in_docker",
      "spawn_agent",
      "spawn_agents_parallel",
    ],
  };
});

type MockFn = ReturnType<typeof vi.fn>;

const { ResearchService } = await import("../ResearchService");

function getMockAgent() {
  return (globalThis as Record<string, unknown>).__testMockAgent as {
    state: { tools: never[] };
    subscribe: MockFn;
    prompt: MockFn;
  };
}

function getCaptured() {
  return (globalThis as Record<string, unknown>).__testCaptured as {
    current: ((event: unknown) => void) | null;
  };
}

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

function makeArtifactService() {
  return {
    saveArtifact: vi.fn().mockResolvedValue(undefined),
    listArtifacts: vi.fn().mockResolvedValue([]),
    listUnacknowledged: vi.fn().mockResolvedValue([]),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    acknowledgeAll: vi.fn().mockResolvedValue(undefined),
  };
}

function makeObservabilityService() {
  return {
    getTraceId: vi.fn().mockResolvedValue(null),
    startObservation: vi.fn().mockResolvedValue({
      traceId: "t",
      spanId: "s",
      update: vi.fn(),
      end: vi.fn(),
    }),
    observe: vi
      .fn()
      .mockImplementation((_name: string, fn: (span: unknown) => Promise<unknown>) =>
        fn({ update: () => {}, end: () => {} }),
      ),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/home"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/home/workspace/p1"),
  };
}

function makeTaskPersistenceService() {
  return {
    saveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    getInProgressTasks: vi.fn().mockResolvedValue([]),
    getTasksByProject: vi.fn().mockResolvedValue([]),
    migrateTasksFromJson: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ResearchService", () => {
  beforeEach(() => {
    getCaptured().current = null;
    vi.clearAllMocks();
    getMockAgent().subscribe.mockImplementation((cb: (event: unknown) => void) => {
      getCaptured().current = cb;
    });
    getMockAgent().prompt.mockResolvedValue(undefined);
  });

  it("returns a taskId immediately", async () => {
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls taskPersistence.saveTask with task details", async () => {
    const taskPersistence = makeTaskPersistenceService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      taskPersistence as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(taskPersistence.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "research X" }),
    );
  });

  it("calls updateTaskStatus with complete on research:complete", async () => {
    const taskPersistence = makeTaskPersistenceService();
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      taskPersistence as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "agent_end" });

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await expect(svc.startResearch("p1", "My Project", "research X", null)).rejects.toThrow(
      "No API key configured",
    );
  });

  it("calls updateTaskStatus with failed on research error", async () => {
    const taskPersistence = makeTaskPersistenceService();
    const bus = makeEventBus();
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    createWorkerAgent.mockResolvedValueOnce({
      agent: {
        ...getMockAgent(),
        subscribe: vi.fn((cb) => {
          getCaptured().current = cb;
          return () => {};
        }),
        prompt: vi.fn().mockResolvedValue(undefined),
      } as never,
      run: vi.fn().mockRejectedValue(new Error("worker crashed")),
    });
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      taskPersistence as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    // Let the promise rejection propagate
    await new Promise((r) => setTimeout(r, 10));

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
      taskId,
      "failed",
      expect.any(String),
    );
  });

  it("emits research:progress for text_delta message_update", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });

    // No progress event should be emitted for non-text_delta
    const progressCalls = bus.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "research:progress",
    );
    expect(progressCalls).toHaveLength(0);
  });

  it("emits research:complete with empty filePaths on agent_end", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "agent_end" });

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:complete",
        payload: expect.objectContaining({ filePaths: [] }),
      }),
    );
  });
});

describe("ResearchService – startOrchestratedResearch", () => {
  beforeEach(() => {
    getCaptured().current = null;
    vi.clearAllMocks();
    getMockAgent().subscribe.mockImplementation((cb: (event: unknown) => void) => {
      getCaptured().current = cb;
    });
    getMockAgent().prompt.mockResolvedValue(undefined);
  });

  it("returns a taskId immediately", async () => {
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(expect.objectContaining({ remainingDepth: 3 }));
  });

  it("calls taskPersistence.saveTask with task details", async () => {
    const taskPersistence = makeTaskPersistenceService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      taskPersistence as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    expect(taskPersistence.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "deep research" }),
    );
  });

  it("emits research:started event", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls updateTaskStatus with complete on agent_end", async () => {
    const taskPersistence = makeTaskPersistenceService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      taskPersistence as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    await getCaptured().current?.({ type: "agent_end" });
    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
  });
});

describe("ResearchService – _runResearch internals", () => {
  beforeEach(() => {
    getCaptured().current = null;
    vi.clearAllMocks();
    getMockAgent().subscribe.mockImplementation((cb: (event: unknown) => void) => {
      getCaptured().current = cb;
    });
    getMockAgent().prompt.mockResolvedValue(undefined);
  });

  it("two sequential startResearch calls on same project produce identical system prompts", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
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
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );

    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    vi.clearAllMocks();
    call.onProgress?.("", "some delta");
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("passes observabilityService and parentSpanContext to createWorkerAgent", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi
          .fn()
          .mockResolvedValue({ modelOverride: "openrouter:anthropic/claude_sonnet-4-5" }),
      } as never,
      makeArtifactService() as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        observabilityService: expect.any(Object),
        parentSpanContext: { traceId: "t", spanId: "s" },
      }),
    );
  });
});

async function createTestDb() {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return db;
}

describe("TaskPersistenceService", () => {
  it("getTasksByProject returns tasks sorted by createdAt desc", async () => {
    const db = await createTestDb();
    const taskPersistence = new TaskPersistenceService(db, "/tmp/home");

    // Seed projects (tasks FK references projects.id)
    await db.insert(projects).values([
      {
        id: "proj-a",
        name: "A",
        createdAt: new Date("2026-05-01"),
        updatedAt: new Date("2026-05-01"),
      },
      {
        id: "proj-b",
        name: "B",
        createdAt: new Date("2026-05-01"),
        updatedAt: new Date("2026-05-01"),
      },
    ]);

    await taskPersistence.saveTask({
      taskId: "t1",
      projectId: "proj-a",
      projectName: "A",
      query: "q1",
      folderPath: null,
      startedAt: new Date("2026-05-01").toISOString(),
    });
    await taskPersistence.saveTask({
      taskId: "t2",
      projectId: "proj-a",
      projectName: "A",
      query: "q2",
      folderPath: null,
      startedAt: new Date("2026-05-05").toISOString(),
    });
    await taskPersistence.saveTask({
      taskId: "t3",
      projectId: "proj-b",
      projectName: "B",
      query: "q3",
      folderPath: null,
      startedAt: new Date("2026-05-03").toISOString(),
    });

    const result = await taskPersistence.getTasksByProject("proj-a");
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe("t2");
    expect(result[0].status).toBe("in_progress");
    expect(result[1].taskId).toBe("t1");
    expect(result[1].status).toBe("in_progress");
  });
});
