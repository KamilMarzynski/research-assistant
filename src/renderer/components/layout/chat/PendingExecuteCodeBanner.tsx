import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodeExecuteCodeApprovalPayload } from "../../../../shared/ipc-guards";
import type { ExecuteCodeApprovalPayload } from "../../../../shared/ipc-types";
import type { Project } from "../../../../shared/types";
import { IconAlert } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { ipc } from "../../../lib/ipc-client";
import PendingExecuteCodeModal from "./PendingExecuteCodeModal";

interface Props {
  activeProjectId: string | null;
  projects: Project[];
}

export default function PendingExecuteCodeBanner({ activeProjectId, projects }: Props) {
  const { items, remove, clearWhere } = usePendingItems<ExecuteCodeApprovalPayload>({
    channel: IPC.EXECUTE_CODE_APPROVAL_REQUIRED,
    decode: decodeExecuteCodeApprovalPayload,
    getKey: (request) => request.executionId,
  });
  const [selected, setSelected] = useState<ExecuteCodeApprovalPayload | null>(null);

  useEffect(() => {
    return ipc.on(IPC.APPROVALS_AUTO_RESOLVED, (event) => {
      clearWhere((item) => item.projectId === event.projectId);
      setSelected((current) => (current?.projectId === event.projectId ? null : current));
    });
  }, [clearWhere]);

  const handleResolve = async (
    request: ExecuteCodeApprovalPayload,
    action: "approve_once" | "deny",
    denyReason?: string,
  ) => {
    try {
      await ipc.invoke(IPC.RESOLVE_EXECUTE_CODE_APPROVAL, {
        executionId: request.executionId,
        action,
        denyReason,
      });
    } catch {
      // Handler may throw if executionId already resolved
    }
    remove(request);
    setSelected(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((request) => (
        <div
          key={request.executionId}
          data-testid={`pending-execute-code-banner-${request.language}`}
          style={{
            borderRadius: "var(--r-md)",
            background: "var(--warn-soft)",
            border: "1px solid oklch(0.82 0.06 75)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
          }}
        >
          <IconAlert size={14} strokeColor="var(--warn)" />
          <span className="chip chip--warn">code execution</span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
            {request.projectId !== activeProjectId && (
              <span style={{ color: "var(--ink-3)", marginRight: 6 }}>
                [{projects.find((p) => p.id === request.projectId)?.name ?? "background"}]
              </span>
            )}
            {request.language} · {request.intent}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`review-execute-code-btn-${request.language}`}
            onClick={() => setSelected(request)}
          >
            Review
          </button>
        </div>
      ))}
      {selected && (
        <PendingExecuteCodeModal
          request={selected}
          onApprove={() => handleResolve(selected, "approve_once")}
          onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
