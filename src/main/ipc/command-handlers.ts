import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { PathApprovalPayload } from "../../shared/ipc-types";
import { resolvePathApprovalGate } from "../agent/extensions/path-approval";
import { resolveBlockedCommand } from "../agent/extensions/safe-bash";
import { ResolveBlockedCommandSchema, ResolvePathApprovalSchema } from "../ipc-validation";
import type { AllowlistService } from "../services/AllowlistService";
import { parseOrThrow } from "./parse-util";
import { wrapIpc } from "./wrap-ipc";

const pendingPathApprovals = new Map<string, PathApprovalPayload>();

export function registerCommandHandlers(
  _win: Electron.BrowserWindow,
  allowlistService: AllowlistService,
): void {
  ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { commandId, action, projectId } = parseOrThrow(
        ResolveBlockedCommandSchema,
        payload,
        "RESOLVE_BLOCKED_COMMAND",
      );
      resolveBlockedCommand(commandId, action, projectId);
    }),
  );

  ipcMain.handle(IPC.GET_PENDING_PATH_APPROVALS, () =>
    wrapIpc(async () => {
      return Array.from(pendingPathApprovals.values());
    }),
  );

  ipcMain.handle(IPC.RESOLVE_PATH_APPROVAL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { path, mode, action, projectId } = parseOrThrow(
        ResolvePathApprovalSchema,
        payload,
        "RESOLVE_PATH_APPROVAL",
      );
      const key = `${projectId}:${path}:${mode}`;
      pendingPathApprovals.delete(key);

      const approved = action === "approve_once" || action === "approve_session";
      if (approved) {
        allowlistService.approveSession(projectId, path);
      }
      resolvePathApprovalGate(projectId, path, mode as "read" | "write", approved);
    }),
  );
}

export function addPendingPathApproval(payload: PathApprovalPayload): void {
  const key = `${payload.projectId}:${payload.path}:${payload.mode}`;
  pendingPathApprovals.set(key, payload);
}
