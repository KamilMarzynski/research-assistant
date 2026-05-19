import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { PathApprovalPayload } from "../../shared/ipc-types";
import {
  resolveExecuteCodeApproval,
  resolvePendingExecuteCodeApprovalsForProject,
} from "../agent/extensions/execute-code-approval";
import { onPathApprovalTimeout, resolvePathApprovalGate } from "../agent/extensions/path-approval";
import {
  resolveBlockedCommand,
  resolvePendingBlockedCommandsForProject,
} from "../agent/extensions/safe-bash";
import {
  ResolveBlockedCommandSchema,
  ResolveExecuteCodeApprovalSchema,
  ResolvePathApprovalSchema,
} from "../ipc-validation";
import type { AllowlistService } from "../services/AllowlistService";
import type { ProjectApprovalResolver } from "../services/ProjectService";
import { parseOrThrow } from "./parse-util";
import { wrapIpc } from "./wrap-ipc";

const pendingPathApprovals = new Map<string, PathApprovalPayload>();
const pendingPathApprovalCleanup = new Map<string, () => void>();

export function registerCommandHandlers(
  _win: Electron.BrowserWindow,
  allowlistService: AllowlistService,
): ProjectApprovalResolver {
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

  ipcMain.handle(IPC.RESOLVE_EXECUTE_CODE_APPROVAL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { executionId, action } = parseOrThrow(
        ResolveExecuteCodeApprovalSchema,
        payload,
        "RESOLVE_EXECUTE_CODE_APPROVAL",
      );
      resolveExecuteCodeApproval(executionId, action);
    }),
  );

  ipcMain.handle(IPC.GET_PENDING_PATH_APPROVALS, () =>
    wrapIpc(async () => {
      return Array.from(pendingPathApprovals.values());
    }),
  );

  ipcMain.handle(IPC.RESOLVE_PATH_APPROVAL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { path, mode, action, projectId, denyReason } = parseOrThrow(
        ResolvePathApprovalSchema,
        payload,
        "RESOLVE_PATH_APPROVAL",
      );
      const key = `${projectId}:${path}:${mode}`;
      pendingPathApprovals.delete(key);
      pendingPathApprovalCleanup.get(key)?.();
      pendingPathApprovalCleanup.delete(key);

      const approved = action === "approve_once" || action === "approve_session";
      if (approved) {
        allowlistService.approveSession(projectId, path, mode);
      }
      resolvePathApprovalGate(projectId, path, mode as "read" | "write", approved, denyReason);
    }),
  );

  return {
    async resolvePendingApprovals(projectId: string) {
      try {
        const blockedCount = resolvePendingBlockedCommandsForProject(projectId, "approve_once");
        const executeCodeCount = resolvePendingExecuteCodeApprovalsForProject(
          projectId,
          "approve_once",
        );
        const pathCount = resolvePendingPathApprovalsForProject(projectId, allowlistService);
        const resolvedCount = blockedCount + executeCodeCount + pathCount;

        if (resolvedCount === 0) {
          return { status: "no_pending_approvals" } as const;
        }

        return { status: "resolved", resolvedCount } as const;
      } catch (error) {
        return {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        } as const;
      }
    },
  };
}

export function addPendingPathApproval(payload: PathApprovalPayload): void {
  const key = `${payload.projectId}:${payload.path}:${payload.mode}`;
  pendingPathApprovals.set(key, payload);
  pendingPathApprovalCleanup.get(key)?.();
  pendingPathApprovalCleanup.set(
    key,
    onPathApprovalTimeout(payload.projectId, payload.path, payload.mode, () => {
      pendingPathApprovals.delete(key);
      pendingPathApprovalCleanup.delete(key);
    }),
  );
}

function resolvePendingPathApprovalsForProject(
  projectId: string,
  allowlistService: AllowlistService,
): number {
  const approvals = Array.from(pendingPathApprovals.entries()).filter(
    ([, payload]) => payload.projectId === projectId,
  );

  for (const [key, payload] of approvals) {
    pendingPathApprovals.delete(key);
    pendingPathApprovalCleanup.get(key)?.();
    pendingPathApprovalCleanup.delete(key);
    allowlistService.approveSession(projectId, payload.path, payload.mode);
    resolvePathApprovalGate(projectId, payload.path, payload.mode, true);
  }

  return approvals.length;
}
