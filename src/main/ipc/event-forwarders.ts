import { type BrowserWindow, Notification } from "electron";
import type { EventBus } from "../event-bus";
import { emitPush } from "./emit-push";
import type { SessionManager } from "./session-manager";

export function registerEventForwarders(
  win: BrowserWindow,
  deps: { eventBus: EventBus; sessionManager: SessionManager },
): void {
  const { eventBus, sessionManager } = deps;

  eventBus.on("research:started", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "research_started",
        taskId: payload.taskId,
        projectId: payload.projectId,
        query: payload.query,
      },
    });
  });

  eventBus.on("research:progress", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "research_step",
        taskId: payload.taskId,
        projectId: payload.projectId,
        message: payload.message,
        label: payload.label,
      },
    });
  });

  eventBus.on("research:complete", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "research_complete",
        taskId: payload.taskId,
        projectId: payload.projectId,
        query: payload.query,
        filePaths: payload.filePaths,
      },
    });

    if (!win.isFocused()) {
      const notification = new Notification({
        title: "Research Complete",
        body: String(payload.query).slice(0, 80),
      });
      notification.show();
      notification.on("click", () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
    }

    const session = sessionManager.get(payload.projectId);
    if (session) {
      const filePathsStr = payload.filePaths.length > 0 ? payload.filePaths.join(", ") : "none";
      session
        .queueFollowUp(
          `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${filePathsStr}. Please briefly summarise the findings for the user.`,
        )
        .catch((err) => console.error("[event-forwarders] queueFollowUp failed:", err));
    }
  });

  eventBus.on("research:failed", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "research_failed",
        taskId: payload.taskId,
        projectId: payload.projectId,
        query: payload.query,
        error: payload.error,
      },
    });
  });

  eventBus.on("tool:pending", (payload) => {
    emitPush(win, {
      type: "TOOL_PENDING",
      name: payload.name,
      skillContent: payload.skillContent,
      scope: payload.scope,
      projectSlug: payload.projectSlug,
      update: payload.update,
    });
  });

  eventBus.on("bash:blocked", (payload) => {
    emitPush(win, { type: "BASH_BLOCKED", ...payload });
  });

  eventBus.on("path:approval_required", (payload) => {
    emitPush(win, { type: "PATH_APPROVAL_REQUIRED", ...payload });
  });

  eventBus.on("agent:tool_start", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "tool_call_start",
        projectId: payload.projectId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        description: payload.description,
      },
    });
  });

  eventBus.on("agent:tool_end", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "tool_call_end",
        projectId: payload.projectId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        isError: payload.isError,
      },
    });
  });
}
