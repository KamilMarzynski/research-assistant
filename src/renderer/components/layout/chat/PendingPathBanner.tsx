import { useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePathApprovalPayload } from "../../../../shared/ipc-guards";
import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import { IconShield } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import PendingPathModal from "./PendingPathModal";

export default function PendingPathBanner() {
  const { items, remove } = usePendingItems<PathApprovalPayload>({
    channel: IPC.PATH_APPROVAL_REQUIRED,
    decode: decodePathApprovalPayload,
    getKey: (r) => `${r.projectId}:${r.path}:${r.mode}`,
  });
  const [selected, setSelected] = useState<PathApprovalPayload | null>(null);

  const handleResolve = async (
    req: PathApprovalPayload,
    action: "approve_once" | "approve_session" | "deny",
  ) => {
    try {
      await window.electronAPI.invoke(IPC.RESOLVE_PATH_APPROVAL, {
        path: req.path,
        mode: req.mode,
        action,
        projectId: req.projectId,
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
            Blocked path: <strong>{req.path}</strong> — {req.mode} access required
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
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={() => handleResolve(selected, "deny")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
