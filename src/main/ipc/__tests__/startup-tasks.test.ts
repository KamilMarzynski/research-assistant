import { describe, expect, it, vi } from "vitest";
import { registerStartupTasks } from "../startup-tasks";

function makeEventBus() {
  return { emit: vi.fn() };
}

function makeTaskPersistence(
  inProgressTasks: {
    taskId: string;
    projectId: string;
    projectName: string;
    query: string;
    folderPath: null;
    startedAt: string;
    status: "in_progress";
  }[] = [],
) {
  return {
    migrateTasksFromJson: vi.fn().mockResolvedValue(undefined),
    getInProgressTasks: vi.fn().mockResolvedValue(inProgressTasks),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makeResearchService() {
  return {
    startResearch: vi.fn().mockResolvedValue({ taskId: "new-task" }),
    resumeResearch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("registerStartupTasks", () => {
  it("calls resumeResearch for each in-progress task — not startResearch", async () => {
    const task = {
      taskId: "t1",
      projectId: "p1",
      projectName: "P",
      query: "q",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress" as const,
    };
    const taskPersistence = makeTaskPersistence([task]);
    const researchService = makeResearchService();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: makeEventBus() as never,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(researchService.resumeResearch).toHaveBeenCalledWith(task);
    expect(researchService.startResearch).not.toHaveBeenCalled();
  });

  it("does not call resumeResearch when no in-progress tasks", async () => {
    const taskPersistence = makeTaskPersistence([]);
    const researchService = makeResearchService();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: makeEventBus() as never,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(researchService.resumeResearch).not.toHaveBeenCalled();
  });

  it("emits startup:error when resumeResearch throws", async () => {
    const task = {
      taskId: "t1",
      projectId: "p1",
      projectName: "P",
      query: "q",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress" as const,
    };
    const taskPersistence = makeTaskPersistence([task]);
    const researchService = makeResearchService();
    researchService.resumeResearch.mockRejectedValue(new Error("resume failed"));
    const bus = makeEventBus();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: bus as never,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "startup:error" }));
  });
});
