import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { PathApprovalPayload } from "../../shared/ipc-types";
import { ResolveBlockedCommandSchema, ResolvePathApprovalSchema } from "../ipc-validation";
import type { AllowlistService } from "../services/AllowlistService";
import { parseOrThrow } from "./parse-util";

const pendingPathApprovals = new Map<string, PathApprovalPayload>();

export function registerCommandHandlers(
  _win: Electron.BrowserWindow,
  allowlistService: AllowlistService,
): void {
  ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, async (_event, payload: unknown) => {
    const { commandId, action, projectId } = parseOrThrow(
      ResolveBlockedCommandSchema,
      payload,
      "RESOLVE_BLOCKED_COMMAND",
    );
    const { resolveBlockedCommand } = await import("../agent/extensions/safe-bash");
    resolveBlockedCommand(commandId, action, projectId);
  });

  ipcMain.handle(IPC.GET_PENDING_PATH_APPROVALS, async () => {
    return Array.from(pendingPathApprovals.values());
  });

  ipcMain.handle(IPC.RESOLVE_PATH_APPROVAL, async (_event, payload: unknown) => {
    const { path, mode, action, projectId } = parseOrThrow(
      ResolvePathApprovalSchema,
      payload,
      "RESOLVE_PATH_APPROVAL",
    );
    const key = `${projectId}:${path}:${mode}`;
    pendingPathApprovals.delete(key);

    if (action === "approve_once" || action === "approve_session") {
      allowlistService.approveSession(projectId, path);
    }
  });
}

export function addPendingPathApproval(payload: PathApprovalPayload): void {
  const key = `${payload.projectId}:${payload.path}:${payload.mode}`;
  pendingPathApprovals.set(key, payload);
}
