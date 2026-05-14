import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus";

describe("EventBus", () => {
  it("delivers payload to registered handler", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("research:started", handler);
    bus.emit({
      type: "research:started",
      payload: { taskId: "t1", projectId: "p1", query: "AI" },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ taskId: "t1", projectId: "p1", query: "AI" });
  });

  it("does not deliver to handler after unsubscribe", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on("research:progress", handler);
    unsubscribe();
    bus.emit({
      type: "research:progress",
      payload: { taskId: "t1", projectId: "p1", message: "Working..." },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to multiple handlers on the same event", () => {
    const bus = new EventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bus.on("research:complete", handlerA);
    bus.on("research:complete", handlerB);
    bus.emit({
      type: "research:complete",
      payload: {
        taskId: "t1",
        projectId: "p1",
        query: "Q",
        filePaths: ["/tmp/out.md"],
      },
    });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("does not cross-deliver between event types", () => {
    const bus = new EventBus();
    const startedHandler = vi.fn();
    const failedHandler = vi.fn();

    bus.on("research:started", startedHandler);
    bus.on("research:failed", failedHandler);
    bus.emit({ type: "research:started", payload: { taskId: "t1", projectId: "p1", query: "Q" } });

    expect(startedHandler).toHaveBeenCalledOnce();
    expect(failedHandler).not.toHaveBeenCalled();
  });

  it("delivers correct typed payload for each event type", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("research:failed", handler);
    bus.emit({
      type: "research:failed",
      payload: { taskId: "t2", projectId: "p1", query: "Q", error: "timeout" },
    });

    expect(handler).toHaveBeenCalledWith({
      taskId: "t2",
      projectId: "p1",
      query: "Q",
      error: "timeout",
    });
  });
});
