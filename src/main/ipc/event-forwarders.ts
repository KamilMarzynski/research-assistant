import { type BrowserWindow, Notification } from "electron";
import type { EventBus } from "../event-bus";
import { emitPush } from "./emit-push";
import type { SessionManager } from "./session-manager";

export function registerEventForwarders(
  win: BrowserWindow,
  deps: { eventBus: EventBus; sessionManager: SessionManager },
): void {
  const { eventBus } = deps;

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

  eventBus.on("bash:blocked", (payload) => {
    emitPush(win, { type: "BASH_BLOCKED", ...payload });
  });

  eventBus.on("execute_code:approval_required", (payload) => {
    emitPush(win, { type: "EXECUTE_CODE_APPROVAL_REQUIRED", ...payload });
  });

  eventBus.on("path:approval_required", (payload) => {
    emitPush(win, { type: "PATH_APPROVAL_REQUIRED", ...payload });
  });

  eventBus.on("approvals:auto_resolved", (payload) => {
    emitPush(win, { type: "APPROVALS_AUTO_RESOLVED", projectId: payload.projectId });
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

  eventBus.on("agent:tool_update", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "tool_call_update",
        projectId: payload.projectId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        partialResult: payload.partialResult,
      },
    });
  });
}
