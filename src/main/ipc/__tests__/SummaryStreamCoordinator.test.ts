import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";
import { SummaryQueue } from "../SummaryQueue";
import { SummaryStreamCoordinator } from "../SummaryStreamCoordinator";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));
vi.mock("../emit-push", () => ({ emitPush: vi.fn() }));

const { emitPush } = await import("../emit-push");

function makeWin() {
  return {} as BrowserWindow;
}

function makeSessionManager(processing = false) {
  return {
    get: vi.fn().mockReturnValue({ isProcessing: () => processing }),
  };
}

describe("SummaryStreamCoordinator", () => {
  let win: BrowserWindow;
  let eventBus: EventBus;
  let queue: SummaryQueue;
  let sessionManager: ReturnType<typeof makeSessionManager>;
  let coordinator: SummaryStreamCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    win = makeWin();
    eventBus = new EventBus();
    queue = new SummaryQueue();
    sessionManager = makeSessionManager(false);
    coordinator = new SummaryStreamCoordinator(win, eventBus, queue, sessionManager as never, 0);
    coordinator.register();
  });

  it("drainQueue emits MESSAGE_CHUNK events for each chunk", async () => {
    queue.push("p1", "Hello world from research.");
    await coordinator.drainQueue("p1");
    const chunkCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_CHUNK",
    );
    const combined = chunkCalls.map(([, e]) => e.delta).join("");
    expect(combined).toBe("Hello world from research.");
  });

  it("drainQueue emits single MESSAGE_DONE after all items drained", async () => {
    queue.push("p1", "First summary.");
    queue.push("p1", "Second summary.");
    await coordinator.drainQueue("p1");
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("does not emit MESSAGE_DONE between queue items", async () => {
    queue.push("p1", "A.");
    queue.push("p1", "B.");
    await coordinator.drainQueue("p1");
    const calls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.map(([, e]) => e.type);
    const doneIndex = calls.indexOf("MESSAGE_DONE");
    const lastChunkIndex = calls.lastIndexOf("MESSAGE_CHUNK");
    expect(doneIndex).toBeGreaterThan(lastChunkIndex);
    expect(calls.filter((t) => t === "MESSAGE_DONE")).toHaveLength(1);
  });

  it("concurrent drainQueue calls for same project are no-ops", async () => {
    queue.push("p1", "Once.");
    const p1 = coordinator.drainQueue("p1");
    const p2 = coordinator.drainQueue("p1");
    await Promise.all([p1, p2]);
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("on research:summary_ready drains immediately when session is idle", async () => {
    queue.push("p1", "Result here.");
    eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: "p1", text: "Result here." },
    });
    await new Promise((r) => setTimeout(r, 10));
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("on research:summary_ready defers when session is processing", async () => {
    const busyManager = makeSessionManager(true);
    coordinator = new SummaryStreamCoordinator(win, eventBus, queue, busyManager as never, 0);
    coordinator.register();

    queue.push("p1", "Deferred.");
    eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: "p1", text: "Deferred." },
    });
    await new Promise((r) => setTimeout(r, 10));
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(0);
    eventBus.emit({ type: "agent:done", payload: { projectId: "p1" } });
    await new Promise((r) => setTimeout(r, 10));
    const doneAfter = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneAfter).toHaveLength(1);
  });

  it("on agent:done drains pending queue for that project", async () => {
    queue.push("p1", "Pending result.");
    eventBus.emit({ type: "agent:done", payload: { projectId: "p1" } });
    await new Promise((r) => setTimeout(r, 10));
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });
});
