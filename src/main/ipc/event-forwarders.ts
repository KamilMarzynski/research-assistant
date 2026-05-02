import { type BrowserWindow, Notification } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { EventBus } from "../event-bus";
import type { SessionManager } from "./session-manager";

export function registerEventForwarders(
  win: BrowserWindow,
  deps: {
    eventBus: EventBus;
    sessionManager: SessionManager;
  },
): void {
  const { eventBus, sessionManager } = deps;

  eventBus.on("research:started", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "started",
      ...payload,
    });
  });

  eventBus.on("research:progress", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "progress",
      ...payload,
    });
  });

  eventBus.on("research:complete", (payload) => {
    win.webContents.send(IPC.RESEARCH_COMPLETE, payload);

    // OS notification when window not focused
    if (!win.isFocused()) {
      const body =
        typeof payload === "object" && payload !== null && "query" in payload
          ? String((payload as { query: string }).query).slice(0, 80)
          : "Research completed";
      const notification = new Notification({
        title: "Research Complete",
        body,
      });
      notification.show();

      notification.on("click", () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
    }

    const session = sessionManager.get(payload.projectId);
    if (session) {
      session
        .queueFollowUp(
          `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${payload.filePath}. Please briefly summarise the findings for the user.`,
        )
        .catch((err) => {
          console.error("[event-forwarders] queueFollowUp failed:", err);
        });
    }
  });

  eventBus.on("research:failed", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "failed",
      ...payload,
    });
  });

  eventBus.on("tool:pending", (payload) => {
    win.webContents.send(IPC.TOOL_PENDING, payload);
  });

  eventBus.on("bash:blocked", (payload) => {
    win.webContents.send(IPC.BASH_BLOCKED, payload);
  });

  eventBus.on("model:fallback", (payload) => {
    win.webContents.send(IPC.MODEL_FALLBACK, payload);
  });
}
