import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { AuditLogEntry, ExecuteCodeApprovalPayload } from "../../../shared/ipc-types";

type ExecuteCodeApprovalAction = "approve_once" | "deny";

export type ExecuteCodeGateResult =
  | { approved: true; payload: ExecuteCodeApprovalPayload }
  | { approved: false; denyReason?: string };

interface ExecuteCodeApprovalPromise {
  payload: ExecuteCodeApprovalPayload;
  resolve: (result: ExecuteCodeGateResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, ExecuteCodeApprovalPromise>();

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf-8").digest("hex");
}

export async function appendAuditEntry(auditLogPath: string, entry: AuditLogEntry): Promise<void> {
  try {
    await appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (err) {
    console.error("[execute-code] audit log append failed:", err);
  }
}

export function enterExecuteCodeApprovalGate(
  payload: Omit<ExecuteCodeApprovalPayload, "executionId" | "timestamp">,
  emitApprovalRequired: (payload: ExecuteCodeApprovalPayload) => void,
): Promise<ExecuteCodeGateResult> {
  return new Promise((resolve, reject) => {
    const executionId = randomUUID();
    const fullPayload: ExecuteCodeApprovalPayload = {
      ...payload,
      executionId,
      timestamp: new Date().toISOString(),
    };

    const timer = setTimeout(() => {
      pendingApprovals.delete(executionId);
      reject(new Error("Execute code approval timed out."));
    }, 300_000);

    pendingApprovals.set(executionId, {
      payload: fullPayload,
      resolve: (result) => resolve(result),
      reject,
      timer,
    });

    emitApprovalRequired(fullPayload);
  });
}

export function resolveExecuteCodeApproval(
  executionId: string,
  action: ExecuteCodeApprovalAction,
  denyReason?: string,
): void {
  const pending = pendingApprovals.get(executionId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingApprovals.delete(executionId);

  if (action === "approve_once") {
    pending.resolve({ approved: true, payload: pending.payload });
  } else {
    pending.resolve({ approved: false, denyReason });
  }
}

export function resolvePendingExecuteCodeApprovalsForProject(
  projectId: string,
  action: ExecuteCodeApprovalAction = "approve_once",
): number {
  const executionIds = Array.from(pendingApprovals.entries())
    .filter(([, pending]) => pending.payload.projectId === projectId)
    .map(([executionId]) => executionId);

  for (const executionId of executionIds) {
    resolveExecuteCodeApproval(executionId, action);
  }

  return executionIds.length;
}
