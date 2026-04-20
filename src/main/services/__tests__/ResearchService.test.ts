import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedSubscriber: ((event: unknown) => void) | null = null;

const mockWorker = {
  state: { tools: [] as never[] },
  subscribe: vi.fn((cb: (event: unknown) => void) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: constructor mock requires typed this
  Agent: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockWorker);
    return mockWorker;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("../../agent/context", () => ({
  buildSystemContext: vi.fn().mockResolvedValue("mock context"),
}));

vi.mock("../../agent/tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([]),
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
    saveArtifact: vi.fn().mockResolvedValue({
      id: "art-1",
      filePath: "/workspace/output.md",
    }),
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      openrouterApiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
    }),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/.research-assistant"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/.research-assistant/workspace/p1"),
  };
}

describe("ResearchService", () => {
  let service: InstanceType<typeof ResearchService>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    service = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
  });

  it("returns taskId immediately without awaiting worker", async () => {
    const { taskId } = await service.startResearch("p1", "My Project", "research query", null);
    expect(taskId).toBeTypeOf("string");
    expect(taskId).toHaveLength(36);
  });

  it("fires research:started on EventBus", async () => {
    const eventBus = makeEventBus();
    service = new ResearchService(
      eventBus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await service.startResearch("p1", "My Project", "query", null);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:started" }),
    );
  });

  it("spawns a Pi Agent with researcher system prompt", async () => {
    const { Agent } = await import("@mariozechner/pi-agent-core");
    await service.startResearch("p1", "My Project", "summarise the codebase", null);
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        initialState: expect.objectContaining({
          systemPrompt: expect.stringContaining("researcher"),
        }),
      }),
    );
  });

  it("throws when no API key configured", async () => {
    service = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      {
        getSettings: vi.fn().mockResolvedValue({ openrouterApiKey: null, model: "x" }),
      } as never,
      makeHomeService() as never,
    );
    await expect(service.startResearch("p1", "My Project", "query", null)).rejects.toThrow(
      "No API key",
    );
  });

  it("emits research:progress on text_delta events", async () => {
    const eventBus = makeEventBus();
    service = new ResearchService(
      eventBus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await service.startResearch("p1", "My Project", "query", null);

    // Drive the subscriber
    capturedSubscriber?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    });

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:progress" }),
    );
  });

  it("emits research:complete on agent_end", async () => {
    const eventBus = makeEventBus();
    service = new ResearchService(
      eventBus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await service.startResearch("p1", "My Project", "query", null);

    // Drive the subscriber
    await capturedSubscriber?.({ type: "agent_end" });

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:complete" }),
    );
  });

  it("emits research:failed when artifact save fails", async () => {
    const eventBus = makeEventBus();
    service = new ResearchService(
      eventBus as never,
      {
        saveArtifact: vi.fn().mockRejectedValue(new Error("disk full")),
      } as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await service.startResearch("p1", "My Project", "query", null);
    await capturedSubscriber?.({ type: "agent_end" });

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:failed" }),
    );
  });

  it("calls ensureWorkspaceForProject before spawning worker", async () => {
    const homeService = makeHomeService();
    service = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      homeService as never,
    );

    await service.startResearch("p1", "My Project", "query", null);

    expect(homeService.ensureWorkspaceForProject).toHaveBeenCalledWith("p1");
  });
});
