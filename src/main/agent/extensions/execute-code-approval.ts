import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { AuditLogEntry, ExecuteCodeApprovalPayload } from "../../../shared/ipc-types";

type ExecuteCodeApprovalAction = "approve_once" | "deny";

interface ExecuteCodeApprovalPromise {
  payload: ExecuteCodeApprovalPayload;
  resolve: (approved: boolean) => void;
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
): Promise<{ approved: boolean; payload: ExecuteCodeApprovalPayload }> {
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
      resolve: (approved) => resolve({ approved, payload: fullPayload }),
      reject,
      timer,
    });

    emitApprovalRequired(fullPayload);
  });
}

export function resolveExecuteCodeApproval(
  executionId: string,
  action: ExecuteCodeApprovalAction,
): void {
  const pending = pendingApprovals.get(executionId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingApprovals.delete(executionId);
  pending.resolve(action === "approve_once");
}
