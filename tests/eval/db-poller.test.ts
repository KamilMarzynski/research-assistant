// tests/eval/db-poller.test.ts
import { describe, expect, it } from "vitest";
import { pollForCompletion } from "./db-poller";

describe("pollForCompletion", () => {
  it("returns completed when task is done", async () => {
    let callCount = 0;
    const deps = {
      getMessages: async () => [],
      getTasks: async () => {
        callCount++;
        if (callCount >= 2) return [{ id: "task-1", status: "complete" }];
        return [{ id: "task-1", status: "in_progress" }];
      },
      getArtifacts: async () => [],
      now: () => Date.now(),
      sleep: async () => {},
    };

    const result = await pollForCompletion(
      { projectId: "p1", timeoutMs: 10000 },
      deps,
    );
    expect(result.completed).toBe(true);
    expect(result.taskId).toBe("task-1");
  });

  it("returns failed when task fails", async () => {
    const deps = {
      getMessages: async () => [],
      getTasks: async () => [{ id: "task-1", status: "failed" }],
      getArtifacts: async () => [],
      now: () => Date.now(),
      sleep: async () => {},
    };

    const result = await pollForCompletion(
      { projectId: "p1", timeoutMs: 10000 },
      deps,
    );
    expect(result.completed).toBe(false);
  });

  it("times out if no completion", async () => {
    const deps = {
      getMessages: async () => [],
      getTasks: async () => [{ id: "task-1", status: "in_progress" }],
      getArtifacts: async () => [],
      now: () => Date.now(),
      sleep: async () => {},
    };

    const result = await pollForCompletion(
      { projectId: "p1", timeoutMs: 100 },
      deps,
    );
    expect(result.completed).toBe(false);
    expect(result.taskId).toBeNull();
  });
});
