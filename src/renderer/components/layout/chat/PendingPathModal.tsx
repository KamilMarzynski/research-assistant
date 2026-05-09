import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import ReviewDialog from "./ReviewDialog";

function modeChipClass(mode: string): string {
  if (mode === "write") return "chip chip--danger";
  if (mode === "read") return "chip chip--warn";
  return "chip";
}

interface PendingPathModalProps {
  request: PathApprovalPayload;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
}

export default function PendingPathModal({
  request,
  onApproveOnce,
  onApproveSession,
  onDeny,
  onClose,
}: PendingPathModalProps) {
  return (
    <ReviewDialog
      title="Review Path Access Request"
      onApproveOnce={onApproveOnce}
      onApproveSession={onApproveSession}
      onDeny={onDeny}
      onClose={onClose}
      dataTestid="pending-path-modal"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className={modeChipClass(request.mode)}>{request.mode}</span>
      </div>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 8 }}>
        The agent tried to access a path outside the allowed zones. Review before approving.
      </p>
      <pre
        className="thin-scroll"
        style={{
          padding: 12,
          background: "var(--surface-2)",
          borderRadius: "var(--r-md)",
          fontSize: 12,
          maxHeight: 200,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginBottom: 12,
        }}
      >
        {request.path}
      </pre>
      <span className="t-mono t-tertiary" style={{ fontSize: 12, marginTop: 8, display: "block" }}>
        <strong>Project:</strong> {request.projectId}
      </span>
    </ReviewDialog>
  );
}
