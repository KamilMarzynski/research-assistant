import type { BlockedCommandPayload } from "../../../../shared/ipc-types";
import ReviewDialog from "./ReviewDialog";

function categoryChipClass(category: string): string {
  // Red only for truly destructive operations — mkfs, dd, rm -rf.
  // Privilege escalation and everything else (exfiltration, persistence,
  // unsafe_operator, unknown_binary) get amber — blocked, not dangerous.
  if (category === "destructive") return "chip chip--danger";
  return "chip chip--warn";
}

interface PendingCommandModalProps {
  command: BlockedCommandPayload;
  projectName: string;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
}

export default function PendingCommandModal({
  command,
  projectName,
  onApproveOnce,
  onApproveSession,
  onDeny,
  onClose,
}: PendingCommandModalProps) {
  return (
    <ReviewDialog
      title="Review Blocked Command"
      onApproveOnce={onApproveOnce}
      onApproveSession={onApproveSession}
      onDeny={onDeny}
      onClose={onClose}
      dataTestid="pending-command-modal"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span className={categoryChipClass(command.category)}>
          {command.category.replace("_", " ")}
        </span>
      </div>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 8 }}>
        The agent tried to run this command. Review before approving.
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
        {command.command}
      </pre>
      <span className="t-mono t-tertiary" style={{ fontSize: 12, display: "block" }}>
        <strong>Reason:</strong> {command.reason}
      </span>
      <span className="t-mono t-tertiary" style={{ fontSize: 12, marginTop: 8, display: "block" }}>
        <strong>Intent:</strong> {command.intent} · <strong>Project:</strong> {projectName}
      </span>
    </ReviewDialog>
  );
}
