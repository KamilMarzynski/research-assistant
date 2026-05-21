import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePathApprovalPayload } from "../../../../shared/ipc-guards";
import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import type { Project } from "../../../../shared/types";
import { IconShield } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { ipc } from "../../../lib/ipc-client";
import PendingPathModal from "./PendingPathModal";

interface Props {
  activeProjectId: string | null;
  projects: Project[];
}

export default function PendingPathBanner({ activeProjectId, projects }: Props) {
  const { items, remove, clearWhere } = usePendingItems<PathApprovalPayload>({
    channel: IPC.PATH_APPROVAL_REQUIRED,
    decode: decodePathApprovalPayload,
    getKey: (r) => `${r.projectId}:${r.path}:${r.mode}`,
  });
  const [selected, setSelected] = useState<PathApprovalPayload | null>(null);

  useEffect(() => {
    return ipc.on(IPC.APPROVALS_AUTO_RESOLVED, (event) => {
      clearWhere((item) => item.projectId === event.projectId);
      setSelected((current) => (current?.projectId === event.projectId ? null : current));
    });
  }, [clearWhere]);

  const handleResolve = async (
    req: PathApprovalPayload,
    action: "approve_once" | "approve_session" | "deny",
    denyReason?: string,
  ) => {
    try {
      await ipc.invoke(IPC.RESOLVE_PATH_APPROVAL, {
        path: req.path,
        mode: req.mode,
        action,
        projectId: req.projectId,
        denyReason,
      });
    } catch {
      // Handler may throw if already resolved
    }
    remove(req);
    setSelected(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((req) => (
        <div
          key={`${req.projectId}:${req.path}:${req.mode}`}
          data-testid={`pending-path-banner-${req.mode}`}
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
          <IconShield size={14} strokeColor="var(--warn)" />
          <span className="chip chip--warn">privilege</span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
            {req.projectId !== activeProjectId && (
              <span style={{ color: "var(--ink-3)", marginRight: 6 }}>
                [{projects.find((p) => p.id === req.projectId)?.name ?? "background"}]
              </span>
            )}
            Blocked path: <strong>{req.path}</strong> — {req.mode} access required
            {req.intent ? ` — ${req.intent}` : ""}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`review-path-btn-${req.mode}`}
            onClick={() => setSelected(req)}
          >
            Review
          </button>
        </div>
      ))}
      {selected && (
        <PendingPathModal
          request={selected}
          projectName={projects.find((p) => p.id === selected.projectId)?.name ?? "background"}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
