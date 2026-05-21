import "reflect-metadata";
import { readFile } from "node:fs/promises";
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

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
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
      "execute_code",
      "spawn_agent",
      "spawn_agents_parallel",
    ],
    AGENT_TYPE_PRESETS: {
      researcher: (base: Record<string, unknown>, outputPath: string) => ({
        ...base,
        toolNames: ["read_file", "write_file", "web_search"],
        systemPromptAddition: `You are a background researcher. Output: ${outputPath}. Use meaningful filenames.`,
        remainingDepth: 0,
      }),
      orchestrator: (base: Record<string, unknown>, outputPath: string, depth: number) => ({
        ...base,
        toolNames: ["read_file", "write_file", "spawn_agent", "spawn_agents_parallel"],
        systemPromptAddition: `You are a research orchestrator. Output: ${outputPath}.`,
        remainingDepth: depth,
      }),
      coder: (base: Record<string, unknown>, outputPath: string) => ({
        ...base,
        toolNames: ["read_file", "execute_code"],
        systemPromptAddition: `You are a code executor. Output: ${outputPath}.`,
        remainingDepth: 0,
      }),
    },
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

function makeResearchFinisherService() {
  return {
    finish: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCheckpointService() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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

  it("passes accumulated researchOutput to finisher.finish", async () => {
    const finisher = makeResearchFinisherService();
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      finisher as never,
      makeCheckpointService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "first chunk" },
    });
    await getCaptured().current?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: " second chunk" },
    });
    await getCaptured().current?.({ type: "agent_end" });

    expect(finisher.finish).toHaveBeenCalledWith(
      expect.objectContaining({ researchOutput: "first chunk second chunk" }),
    );
  });

  it("writes checkpoint to workspacePath after turn_end fires", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };

    let capturedOnTurnEnd: ((messages: unknown[]) => void) | undefined;
    createWorkerAgent.mockImplementationOnce(
      (config: { onTurnEnd?: (msgs: unknown[]) => void }) => {
        capturedOnTurnEnd = config.onTurnEnd;
        return Promise.resolve({
          agent: {
            state: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
            subscribe: vi.fn((cb: (event: unknown) => void) => {
              getCaptured().current = cb;
              return () => {};
            }),
            prompt: vi.fn().mockResolvedValue(undefined),
          },
          run: vi.fn().mockResolvedValue(undefined),
        });
      },
    );

    const checkpointService = makeCheckpointService();

    const svc = new ResearchService(
      makeEventBus() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      {
        getProject: vi.fn().mockResolvedValue({ modelOverride: null, slug: "my-project" }),
      } as never,
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      checkpointService as never,
    );

    await svc.startResearch("p1", "My Project", "research X", null);

    // Simulate turn_end
    capturedOnTurnEnd?.([{ role: "user", content: "hi", timestamp: 1 }]);

    expect(checkpointService.write).toHaveBeenCalledWith(
      expect.stringContaining("workspace"),
      expect.objectContaining({
        agentType: "researcher",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      }),
    );
  });

  describe("resumeResearch", () => {
    function makeResearchServiceForResume() {
      const checkpointService = {
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const taskPersistence = makeTaskPersistenceService();
      const bus = makeEventBus();
      const finisherService = makeResearchFinisherService();
      const svc = new ResearchService(
        bus as never,
        makeSettingsService() as never,
        makeHomeService() as never,
        new AllowlistService() as never,
        {
          getProject: vi.fn().mockResolvedValue({
            name: "My Project",
            modelOverride: null,
            slug: "my-project-abc123",
            folderPath: null,
            projectPath: null,
          }),
        } as never,
        makeObservabilityService() as never,
        taskPersistence as never,
        finisherService as never,
        checkpointService as never,
      );
      return { svc, checkpointService, taskPersistence, bus, finisherService };
    }

    beforeEach(() => {
      vi.clearAllMocks();
      getCaptured().current = null;
    });

    it("marks task as interrupted when no checkpoint exists", async () => {
      const { svc, checkpointService, taskPersistence } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue(null);

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "interrupted",
        "No checkpoint found",
      );
    });

    it("calls agent.continue() (not prompt) when checkpoint exists", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      const continueMock = vi.fn().mockResolvedValue(undefined);
      const agentMock = {
        state: {
          messages: [] as unknown[],
        },
        subscribe: vi.fn((cb: (event: unknown) => void) => {
          getCaptured().current = cb;
          return () => {};
        }),
        prompt: vi.fn().mockResolvedValue(undefined),
        continue: continueMock,
      };
      createWorkerAgent.mockResolvedValueOnce({ agent: agentMock, run: vi.fn() });

      const savedMessages = [
        { role: "user", content: "research X", timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read_file",
          content: [{ type: "text", text: "result" }],
          details: null,
          isError: false,
          timestamp: 2,
        },
      ];

      const { svc, checkpointService } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "partial output",
        messages: savedMessages,
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(continueMock).toHaveBeenCalled();
      expect(agentMock.prompt).not.toHaveBeenCalled();
    });

    it("emits research:complete and marks task complete when resumed agent ends", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, taskPersistence, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "t",
            content: [],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({ type: "agent_end" });

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith("t1", "complete");
      expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
    });

    it("marks task as interrupted when checkpoint last message is assistant", async () => {
      const { svc, checkpointService, taskPersistence } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [{ role: "assistant", content: "done", timestamp: 1 }],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "interrupted",
        "Checkpoint ended on assistant turn",
      );
    });

    it("marks task as interrupted when no API key configured", async () => {
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

      const checkpointService = makeCheckpointService();
      const taskPersistence = makeTaskPersistenceService();
      const bus = makeEventBus();

      const svc = new ResearchService(
        bus as never,
        settingsSvc as never,
        makeHomeService() as never,
        new AllowlistService() as never,
        {
          getProject: vi.fn().mockResolvedValue({
            name: "My Project",
            modelOverride: null,
            slug: "my-project-abc123",
            folderPath: null,
            projectPath: null,
          }),
        } as never,
        makeObservabilityService() as never,
        taskPersistence as never,
        makeResearchFinisherService() as never,
        checkpointService as never,
      );

      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "interrupted",
        "No API key configured",
      );
    });

    it("emits research:started when resuming", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:started",
          payload: expect.objectContaining({ taskId: "t1", projectId: "p1", query: "research X" }),
        }),
      );
    });

    it("accumulates researchOutput on text_delta during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "previous ",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "new text" },
      });

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:progress",
          payload: expect.objectContaining({ taskId: "t1", projectId: "p1", message: "new text" }),
        }),
      );
    });

    it("deletes checkpoint and calls finisher on agent_end", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, finisherService } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "output",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({ type: "agent_end" });

      expect(checkpointService.delete).toHaveBeenCalled();
      expect(finisherService.finish).toHaveBeenCalledWith(
        expect.objectContaining({ researchOutput: "output" }),
      );
    });

    it("marks task failed when finisher throws on agent_end", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, taskPersistence, bus, finisherService } =
        makeResearchServiceForResume();
      finisherService.finish.mockRejectedValue(new Error("finisher failed"));

      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "output",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({ type: "agent_end" });
      await new Promise((r) => setTimeout(r, 10));

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "failed",
        expect.stringContaining("finisher failed"),
      );
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:failed",
          payload: expect.objectContaining({ taskId: "t1", projectId: "p1" }),
        }),
      );
    });

    it("marks task failed when agent.continue() throws", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockRejectedValue(new Error("continue crashed")),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, taskPersistence, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "failed",
        expect.stringContaining("continue crashed"),
      );
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:failed",
          payload: expect.objectContaining({ taskId: "t1", projectId: "p1" }),
        }),
      );
    });

    it("calls onProgress with label during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.onProgress?.("[researcher-1]", "some delta");

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:progress",
          payload: expect.objectContaining({ label: "[researcher-1]", message: "some delta" }),
        }),
      );
    });

    it("writes checkpoint on onTurnEnd during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "output",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.onTurnEnd?.([{ role: "user", content: "hi", timestamp: 1 }]);

      expect(checkpointService.write).toHaveBeenCalledWith(
        expect.stringContaining("workspace"),
        expect.objectContaining({
          agentType: "researcher",
          messages: [{ role: "user", content: "hi", timestamp: 1 }],
        }),
      );
    });

    it("emits bash:blocked via emitBlocked during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.emitBlocked?.({ command: "rm -rf /", reason: "blocked" });

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "bash:blocked",
          payload: { command: "rm -rf /", reason: "blocked" },
        }),
      );
    });

    it("emits path:approval_required via emitApprovalRequired during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.emitApprovalRequired?.({ path: "/etc", operation: "read" });

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "path:approval_required",
          payload: { path: "/etc", operation: "read" },
        }),
      );
    });

    it("emits execute_code:approval_required via emitExecuteCodeApprovalRequired during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.emitExecuteCodeApprovalRequired?.({ code: "print(1)", language: "python" });

      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "execute_code:approval_required",
          payload: { code: "print(1)", language: "python" },
        }),
      );
    });

    it("does not emit research:progress for non-text_delta message_update during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
      });

      const progressCalls = bus.emit.mock.calls.filter(
        (c: unknown[]) => (c[0] as { type: string }).type === "research:progress",
      );
      expect(progressCalls).toHaveLength(0);
    });

    it("handles null researchSpan during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const observabilityService = makeObservabilityService();
      observabilityService.startObservation.mockResolvedValue(null);

      const { svc, checkpointService, taskPersistence, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({ type: "agent_end" });

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith("t1", "complete");
      expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
    });

    it("logs error when checkpoint write fails on turn_end in resumeResearch", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService } = makeResearchServiceForResume();
      checkpointService.write.mockRejectedValue(new Error("write failed"));
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "output",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      call.onTurnEnd?.([{ role: "user", content: "hi", timestamp: 1 }]);
      await new Promise((r) => setTimeout(r, 10));
      expect(checkpointService.write).toHaveBeenCalled();
    });

    it("uses remainingDepth: 5 when checkpoint agentType is orchestrator", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "orchestrator",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(createWorkerAgent).toHaveBeenCalledWith(
        expect.objectContaining({ remainingDepth: 5 }),
      );
    });

    it("handles null researchSpan when agent.continue() rejects", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockRejectedValue(new Error("continue crashed")),
        },
        run: vi.fn(),
      });

      const observabilityService = makeObservabilityService();
      observabilityService.startObservation.mockResolvedValue(null);

      const { svc, checkpointService, taskPersistence, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
        "t1",
        "failed",
        expect.stringContaining("continue crashed"),
      );
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "research:failed",
          payload: expect.objectContaining({ taskId: "t1", projectId: "p1" }),
        }),
      );
    });

    it("reads FILES.md when it exists during resumeResearch", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      vi.mocked(readFile).mockResolvedValueOnce("FILES content");

      const { svc, checkpointService } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      expect(createWorkerAgent).toHaveBeenCalledWith(
        expect.objectContaining({ filesMdContent: "FILES content" }),
      );
    });

    it("does not emit research:progress when onProgress label is empty during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      const call = createWorkerAgent.mock.calls[0][0];
      vi.clearAllMocks();
      call.onProgress?.("", "some delta");

      expect(bus.emit).not.toHaveBeenCalled();
    });

    it("ignores unknown event types during resumed run", async () => {
      const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
        createWorkerAgent: MockFn;
      };

      createWorkerAgent.mockResolvedValueOnce({
        agent: {
          state: { messages: [] },
          subscribe: vi.fn((cb: (event: unknown) => void) => {
            getCaptured().current = cb;
            return () => {};
          }),
          prompt: vi.fn(),
          continue: vi.fn().mockResolvedValue(undefined),
        },
        run: vi.fn(),
      });

      const { svc, checkpointService, bus, taskPersistence } = makeResearchServiceForResume();
      checkpointService.read.mockResolvedValue({
        taskId: "t1",
        agentType: "researcher",
        researchOutput: "",
        messages: [
          {
            role: "toolResult",
            toolCallId: "tc1",
            toolName: "read_file",
            content: [{ type: "text", text: "result" }],
            details: null,
            isError: false,
            timestamp: 1,
          },
        ],
        savedAt: new Date().toISOString(),
      });

      await svc.resumeResearch({
        taskId: "t1",
        projectId: "p1",
        projectName: "My Project",
        query: "research X",
        folderPath: null,
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });

      await getCaptured().current?.({ type: "unknown_event" });

      const relevantCalls = bus.emit.mock.calls.filter((c: unknown[]) => {
        const type = (c[0] as { type: string }).type;
        return (
          type === "research:progress" || type === "research:complete" || type === "research:failed"
        );
      });
      expect(relevantCalls).toHaveLength(0);
      expect(taskPersistence.updateTaskStatus).not.toHaveBeenCalled();
    });
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    const { taskId } = await svc.startOrchestratedResearch(
      "p1",
      "My Project",
      "deep research",
      null,
    );
    expect(taskId).toBeTruthy();
  });

  it("calls createWorkerAgent with remainingDepth: 5", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(expect.objectContaining({ remainingDepth: 5 }));
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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

  it("two sequential startResearch calls both produce researcher prompts", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    await svc.startResearch("p1", "My Project", "query A", null);
    const firstCall = createWorkerAgent.mock.calls[0][0];

    await svc.startResearch("p1", "My Project", "query B", null);
    const secondCall = createWorkerAgent.mock.calls[1][0];

    // Each call gets its own task workspace path, so prompts differ in paths
    expect(firstCall.systemPromptAddition).toContain("background researcher");
    expect(secondCall.systemPromptAddition).toContain("background researcher");
    expect(firstCall.remainingDepth).toBe(0);
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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

  it("startOrchestratedResearch passes remainingDepth: 5 and onProgress", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    await svc.startOrchestratedResearch("p1", "My Project", "deep query", null);
    const call = createWorkerAgent.mock.calls[0][0];

    expect(call.remainingDepth).toBe(5);
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        observabilityService: expect.any(Object),
        parentSpanContext: { traceId: "t", spanId: "s" },
      }),
    );
  });

  it("emits bash:blocked via emitBlocked in startResearch", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    call.emitBlocked?.({ command: "rm -rf /", reason: "blocked" });
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bash:blocked",
        payload: { command: "rm -rf /", reason: "blocked" },
      }),
    );
  });

  it("emits path:approval_required via emitApprovalRequired in startResearch", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    call.emitApprovalRequired?.({ path: "/etc", operation: "read" });
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "path:approval_required",
        payload: { path: "/etc", operation: "read" },
      }),
    );
  });

  it("emits execute_code:approval_required via emitExecuteCodeApprovalRequired in startResearch", async () => {
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );
    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    call.emitExecuteCodeApprovalRequired?.({ code: "print(1)", language: "python" });
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "execute_code:approval_required",
        payload: { code: "print(1)", language: "python" },
      }),
    );
  });

  it("logs error when checkpoint write fails on turn_end", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };
    const checkpointService = makeCheckpointService();
    checkpointService.write.mockRejectedValue(new Error("write failed"));
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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      checkpointService as never,
    );
    await svc.startResearch("p1", "My Project", "query", null);
    const call = createWorkerAgent.mock.calls[0][0];
    call.onTurnEnd?.([{ role: "user", content: "hi", timestamp: 1 }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(checkpointService.write).toHaveBeenCalled();
  });

  it("handles null researchSpan in startResearch", async () => {
    const observabilityService = makeObservabilityService();
    observabilityService.startObservation.mockResolvedValue(null);

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
      run: vi.fn().mockResolvedValue(undefined),
    });

    const bus = makeEventBus();
    const taskPersistence = makeTaskPersistenceService();

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
      observabilityService as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "agent_end" });

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
  });

  it("marks task failed when updateTaskStatus throws on agent_end in startResearch", async () => {
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
      run: vi.fn().mockResolvedValue(undefined),
    });

    const taskPersistence = makeTaskPersistenceService();
    taskPersistence.updateTaskStatus.mockImplementation((_id: string, status: string) => {
      if (status === "complete") {
        return Promise.reject(new Error("db error"));
      }
      return Promise.resolve(undefined);
    });
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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "agent_end" });
    await new Promise((r) => setTimeout(r, 10));

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
      taskId,
      "failed",
      expect.any(String),
    );
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:failed" }));
  });

  it("logs error when finisher throws on agent_end in startResearch", async () => {
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
      run: vi.fn().mockResolvedValue(undefined),
    });

    const finisherService = makeResearchFinisherService();
    finisherService.finish.mockRejectedValue(new Error("finisher failed"));

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
      makeObservabilityService() as never,
      taskPersistence as never,
      finisherService as never,
      makeCheckpointService() as never,
    );

    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "agent_end" });
    await new Promise((r) => setTimeout(r, 10));

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(taskId, "complete");
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
    expect(finisherService.finish).toHaveBeenCalled();
  });

  it("handles null researchSpan when run() rejects", async () => {
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
      run: vi.fn().mockRejectedValue(new Error("run crashed")),
    });

    const observabilityService = makeObservabilityService();
    observabilityService.startObservation.mockResolvedValue(null);

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
      observabilityService as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    await new Promise((r) => setTimeout(r, 10));

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
      taskId,
      "failed",
      expect.stringContaining("run crashed"),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:failed",
        payload: expect.objectContaining({ taskId, projectId: "p1" }),
      }),
    );
  });

  it("reads FILES.md when it exists during startResearch", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };

    vi.mocked(readFile).mockResolvedValueOnce("FILES content");

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
      makeObservabilityService() as never,
      makeTaskPersistenceService() as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    await svc.startResearch("p1", "My Project", "research X", null);

    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ filesMdContent: "FILES content" }),
    );
  });

  it("ignores unknown event types during startResearch", async () => {
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
      run: vi.fn().mockResolvedValue(undefined),
    });

    const bus = makeEventBus();
    const taskPersistence = makeTaskPersistenceService();

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
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      makeCheckpointService() as never,
    );

    await svc.startResearch("p1", "My Project", "research X", null);

    await getCaptured().current?.({ type: "unknown_event" });

    const relevantCalls = bus.emit.mock.calls.filter((c: unknown[]) => {
      const type = (c[0] as { type: string }).type;
      return (
        type === "research:progress" || type === "research:complete" || type === "research:failed"
      );
    });
    expect(relevantCalls).toHaveLength(0);
    expect(taskPersistence.updateTaskStatus).not.toHaveBeenCalled();
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

  it("allows 'interrupted' status via updateTaskStatus", async () => {
    const db = await createTestDb();
    const svc = new TaskPersistenceService(db, "/tmp/home");

    await db.insert(projects).values({
      id: "proj-a",
      name: "A",
      createdAt: new Date("2026-05-01"),
      updatedAt: new Date("2026-05-01"),
    });
    await svc.saveTask({
      taskId: "t1",
      projectId: "proj-a",
      projectName: "A",
      query: "q",
      folderPath: null,
      startedAt: new Date().toISOString(),
    });

    await svc.updateTaskStatus("t1", "interrupted", "app closed");
    const rows = await svc.getTasksByProject("proj-a");
    expect(rows[0].status).toBe("interrupted");
  });

  it("markAllInProgressAsInterrupted updates all in_progress tasks", async () => {
    const db = await createTestDb();
    const svc = new TaskPersistenceService(db, "/tmp/home");

    await db.insert(projects).values({
      id: "proj-a",
      name: "A",
      createdAt: new Date("2026-05-01"),
      updatedAt: new Date("2026-05-01"),
    });
    await svc.saveTask({
      taskId: "t1",
      projectId: "proj-a",
      projectName: "A",
      query: "q1",
      folderPath: null,
      startedAt: new Date().toISOString(),
    });
    await svc.saveTask({
      taskId: "t2",
      projectId: "proj-a",
      projectName: "A",
      query: "q2",
      folderPath: null,
      startedAt: new Date().toISOString(),
    });
    await svc.updateTaskStatus("t2", "complete");

    await svc.markAllInProgressAsInterrupted();

    const rows = await svc.getTasksByProject("proj-a");
    const t1 = rows.find((r) => r.taskId === "t1");
    const t2 = rows.find((r) => r.taskId === "t2");
    expect(t1?.status).toBe("interrupted");
    expect(t2?.status).toBe("complete");
  });
});
