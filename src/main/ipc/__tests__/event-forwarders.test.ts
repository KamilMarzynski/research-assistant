import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";
import { SessionManager } from "../session-manager";

vi.mock("electron", () => ({
  Notification: vi.fn(() => ({
    show: vi.fn(),
    on: vi.fn(),
  })),
}));

function makeWin() {
  return {
    webContents: {
      send: vi.fn(),
    },
    isFocused: vi.fn().mockReturnValue(true),
    isMinimized: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

describe("registerEventForwarders", () => {
  it("forwards approvals:auto_resolved as APPROVALS_AUTO_RESOLVED", async () => {
    const { registerEventForwarders } = await import("../event-forwarders");
    const eventBus = new EventBus();
    const sessionManager = new SessionManager();
    const win = makeWin();

    registerEventForwarders(win as never, { eventBus, sessionManager });

    eventBus.emit({
      type: "approvals:auto_resolved",
      payload: { projectId: "proj-1" },
    });

    expect(win.webContents.send).toHaveBeenCalledWith("APPROVALS_AUTO_RESOLVED", {
      type: "APPROVALS_AUTO_RESOLVED",
      projectId: "proj-1",
    });
  });
});
