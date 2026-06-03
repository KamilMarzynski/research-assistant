import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared capture for agent events across the mock boundary
const captured = { current: null as ((event: unknown) => void) | null };

const mockRun = vi.fn();
const mockAgent = {
  subscribe: vi.fn((cb: (event: unknown) => void) => {
    captured.current = cb;
    return () => {};
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

const researcherSpy = vi
  .fn()
  .mockImplementation((base: Record<string, unknown>, _outputPath: string, _depth: number) => ({
    ...base,
    toolNames: ["read_file", "write_file", "web_search"],
    systemPromptAddition: `researcher: ${base.brief ?? ""}`,
    remainingDepth: 0,
  }));

const finisherSpy = vi
  .fn()
  .mockImplementation((base: Record<string, unknown>, _outputPath: string, _depth: number) => ({
    ...base,
    toolNames: ["read_file", "list_dir"],
    systemPromptAddition: `finisher: ${base.brief ?? ""}`,
    remainingDepth: 0,
  }));

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    researcher: researcherSpy,
    finisher: finisherSpy,
  },
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi.fn().mockReturnValue({ type: "openrouter", apiKey: "k", model: "m" }),
}));

vi.mock("electron", () => ({
  safeStorage: {
    encryptString: vi.fn().mockReturnValue(Buffer.from("encrypted")),
    decryptString: vi.fn().mockReturnValue("decrypted"),
  },
  dialog: { showErrorBox: vi.fn() },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const { ResearchService } = await import("../ResearchService");
const { ResearchFinisherService } = await import("../ResearchFinisherService");

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

function makeCheckpointService() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMessageService() {
  return {
    addMessage: vi.fn().mockResolvedValue({
      id: "msg-1",
      projectId: "p1",
      role: "assistant",
      content: "",
      createdAt: new Date(),
    }),
  };
}

function makeAllowlistService() {
  return {};
}

function makeProjectService() {
  return {
    getProject: vi.fn().mockResolvedValue({
      modelOverride: "openrouter:anthropic/claude_sonnet-4-5",
      slug: "p",
    }),
  };
}

describe("actionable research — persistent flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.current = null;
  });

  it("brief reaches researcher and finisher unchanged", async () => {
    const brief = `<research_brief>
  <user_request>from now on, all outputs as PDF</user_request>
  <durability>persistent</durability>
  <expected_outcomes>update FILES.md; create md-to-pdf skill</expected_outcomes>
</research_brief>`;

    // Mock the researcher's response to include the new handoff format.
    mockRun.mockResolvedValueOnce(`Research done.

## Handoff
### Summary
Picked pandoc. Updated FILES.md, created skill.
### Files changed
/h/.scholar/skills/md-to-pdf/SKILL.md
/h/.scholar/projects/p/FILES.md
`);
    mockRun.mockResolvedValueOnce("Set up PDF-only outputs.");

    const bus = makeEventBus();
    const settingsService = makeSettingsService();
    const homeService = makeHomeService();
    const allowlistService = makeAllowlistService();
    const projectService = makeProjectService();
    const observabilityService = makeObservabilityService();
    const taskPersistence = makeTaskPersistenceService();
    const checkpointService = makeCheckpointService();
    const messageService = makeMessageService();

    const finisherService = new ResearchFinisherService(
      messageService as never,
      homeService as never,
      allowlistService as never,
      bus as never,
      { shouldBypass: vi.fn().mockResolvedValue(false) } as never,
    );

    const svc = new ResearchService(
      bus as never,
      settingsService as never,
      homeService as never,
      allowlistService as never,
      projectService as never,
      observabilityService as never,
      taskPersistence as never,
      finisherService as never,
      checkpointService as never,
      { shouldBypass: vi.fn().mockResolvedValue(false) } as never,
    );

    const { taskId } = await svc.startResearch("p1", "P", brief, null, null);

    // Trigger agent_end so ResearchService completes and hands off to finisher.
    captured.current?.({ type: "agent_end" });

    // Wait for the async finisher queue to drain.
    await new Promise((r) => setTimeout(r, 50));

    // Verify the researcher preset received the brief.
    expect(researcherSpy).toHaveBeenCalledTimes(1);
    expect(researcherSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ brief }));

    // Verify the finisher preset received the brief.
    expect(finisherSpy).toHaveBeenCalledTimes(1);
    expect(finisherSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ brief }));

    // Also verify the task was persisted with the brief.
    expect(taskPersistence.saveTask).toHaveBeenCalledWith(expect.objectContaining({ brief }));

    // Verify finisher output was saved as a message.
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", role: "assistant" }),
    );

    expect(taskId).toBeTruthy();
  });
});
