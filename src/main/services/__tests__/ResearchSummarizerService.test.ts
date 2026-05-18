import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";

const mockRun = vi
  .fn()
  .mockResolvedValue("Research complete. Files found at /path/to/output.md. Key finding: X.");
const mockAgent = { subscribe: vi.fn(), abort: vi.fn() };

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    summarizer: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi
    .fn()
    .mockReturnValue({ type: "openrouter", apiKey: "sk-test", model: "test" }),
}));

const mockReadFile = vi.fn().mockRejectedValue(new Error("ENOENT"));
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

const { ResearchSummarizerService } = await import("../ResearchSummarizerService");

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

function makeHomeService() {
  return { getHomePath: vi.fn().mockReturnValue("/tmp/.scholar") };
}

function makeAllowlistService() {
  return {};
}

function makeEventBus() {
  const bus = new EventBus();
  vi.spyOn(bus, "emit");
  return bus;
}

function makeJob() {
  return {
    projectId: "p1",
    projectName: "Test Project",
    query: "What is the best model?",
    filePaths: ["/tmp/.scholar/projects/test/output.md"],
    taskWorkspacePath: "/tmp/.scholar/projects/test/workspace/abc",
    projectPath: "/tmp/.scholar/projects/test",
    folderPath: null,
    slug: "test",
    provider: { type: "openrouter" as const, apiKey: "sk-test", model: "test-model" },
    filesMdContent: undefined,
  };
}

describe("ResearchSummarizerService", () => {
  let service: InstanceType<typeof ResearchSummarizerService>;
  let messageService: ReturnType<typeof makeMessageService>;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = makeMessageService();
    eventBus = makeEventBus();
    service = new ResearchSummarizerService(
      messageService as never,
      makeHomeService() as never,
      makeAllowlistService() as never,
      eventBus,
    );
  });

  it("saves assistant message to DB after worker runs", async () => {
    await service.summarize(makeJob());
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", role: "assistant" }),
    );
  });

  it("emits research:summary_ready with the generated text", async () => {
    await service.summarize(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ projectId: "p1", text: expect.any(String) }),
      }),
    );
  });

  it("saves static fallback message when worker throws", async () => {
    mockRun.mockRejectedValueOnce(new Error("model timeout"));
    await service.summarize(makeJob());
    const call = (messageService.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("Research complete");
    expect(call.content).toContain("What is the best model?");
  });

  it("emits research:summary_ready even on fallback", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await service.summarize(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("emits research:summary_ready even when DB save throws", async () => {
    messageService.addMessage.mockRejectedValueOnce(new Error("db down"));
    await service.summarize(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("reads FILES.md when filesMdContent is not provided", async () => {
    mockReadFile.mockResolvedValueOnce("# Files\n\n- output.md");
    await service.summarize(makeJob());
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("skips reading FILES.md when filesMdContent is already provided", async () => {
    await service.summarize({ ...makeJob(), filesMdContent: "provided" });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("uses home-based project path when projectPath is null", async () => {
    await service.summarize({ ...makeJob(), projectPath: null });
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("handles empty filePaths in success path", async () => {
    await service.summarize({ ...makeJob(), filePaths: [] });
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("Files reportedly saved to: none"),
    );
  });

  it("handles empty filePaths in fallback path", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await service.summarize({ ...makeJob(), filePaths: [] });
    const call = (messageService.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("workspace");
  });

  it("serialises jobs — second job runs after first completes", async () => {
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = () => {
        order.push("first");
        resolve("first done");
      };
    });
    mockRun
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(async () => {
        order.push("second");
        return "second done";
      });

    const p1 = service.summarize({ ...makeJob(), projectId: "p1" });
    const p2 = service.summarize({ ...makeJob(), projectId: "p2" });

    // first hasn't finished yet — second should not have started
    expect(order).toEqual([]);
    resolveFirst?.();
    await p1;
    await p2;
    expect(order).toEqual(["first", "second"]);
  });
});
