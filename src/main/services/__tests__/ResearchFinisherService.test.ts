import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";

const mockRun = vi
  .fn()
  .mockResolvedValue("Research done. Files at /project/output.md. Key finding: X.");
const mockAgent = { subscribe: vi.fn(), abort: vi.fn() };

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    finisher: vi.fn().mockReturnValue({}),
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

const { ResearchFinisherService } = await import("../ResearchFinisherService");

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

function makeJob(researchOutput?: string) {
  return {
    projectId: "p1",
    projectName: "Test Project",
    query: "What is the best model?",
    researchOutput:
      researchOutput ??
      "Some research.\n\n## Handoff\nWent well.\n\n### Output Files\n/project/output.md",
    taskWorkspacePath: "/tmp/.scholar/projects/test/workspace/abc",
    projectPath: "/tmp/.scholar/projects/test",
    folderPath: null,
    slug: "test",
    provider: { type: "openrouter" as const, apiKey: "sk-test", model: "test-model" },
    filesMdContent: undefined,
  };
}

describe("ResearchFinisherService", () => {
  let service: InstanceType<typeof ResearchFinisherService>;
  let messageService: ReturnType<typeof makeMessageService>;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = makeMessageService();
    eventBus = makeEventBus();
    service = new ResearchFinisherService(
      messageService as never,
      makeHomeService() as never,
      makeAllowlistService() as never,
      eventBus,
    );
  });

  it("saves assistant message to DB after worker runs", async () => {
    await service.finish(makeJob());
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", role: "assistant" }),
    );
  });

  it("emits research:summary_ready with text and movedFiles parsed from researchOutput", async () => {
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({
          projectId: "p1",
          text: expect.any(String),
          movedFiles: ["/project/output.md"],
        }),
      }),
    );
  });

  it("movedFiles is empty when ### Output Files section absent", async () => {
    await service.finish(makeJob("Research done, no handoff section."));
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ movedFiles: [] }),
      }),
    );
  });

  it("movedFiles parses multiple paths", async () => {
    await service.finish(
      makeJob("## Handoff\nDone.\n\n### Output Files\n/project/a.md\n/project/b.md"),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ movedFiles: ["/project/a.md", "/project/b.md"] }),
      }),
    );
  });

  it("saves static fallback message when worker throws", async () => {
    mockRun.mockRejectedValueOnce(new Error("model timeout"));
    await service.finish(makeJob());
    const call = (messageService.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("Research complete");
    expect(call.content).toContain("What is the best model?");
  });

  it("emits research:summary_ready even on worker fallback", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("emits research:summary_ready even when DB save throws", async () => {
    messageService.addMessage.mockRejectedValueOnce(new Error("db down"));
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("reads FILES.md when filesMdContent not provided", async () => {
    mockReadFile.mockResolvedValueOnce("# Files\n\n- output.md");
    await service.finish(makeJob());
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("skips reading FILES.md when filesMdContent already provided", async () => {
    await service.finish({ ...makeJob(), filesMdContent: "provided" });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("uses home-based project path when projectPath is null", async () => {
    await service.finish({ ...makeJob(), projectPath: null });
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("passes researchOutput to agent task prompt", async () => {
    await service.finish(makeJob("## Handoff\nAll good.\n\n### Output Files\n/a.md"));
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("## Handoff"));
  });

  it("serialises jobs — second runs after first completes", async () => {
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

    const p1 = service.finish({ ...makeJob(), projectId: "p1" });
    const p2 = service.finish({ ...makeJob(), projectId: "p2" });

    expect(order).toEqual([]);
    resolveFirst?.();
    await p1;
    await p2;
    expect(order).toEqual(["first", "second"]);
  });
});
