import { Dialog } from "@mui/material";
import type { PendingTool } from "../../../../shared/ipc-channels";

const paperSx = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
  overflow: "hidden",
} as const;

interface PendingToolModalProps {
  tool: PendingTool;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}

export default function PendingToolModal({
  tool,
  onApprove,
  onReject,
  onClose,
}: PendingToolModalProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="pending-tool-modal"
      slotProps={{
        paper: {
          sx: paperSx,
        },
      }}
    >
      <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Review proposed tool: {tool.name}</span>
      </div>
      <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>
        <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 8 }}>
          An agent has proposed this tool for your approval. Once approved, it will be available as
          a skill in future sessions.
        </p>
        <pre
          className="thin-scroll"
          style={{
            padding: 12,
            background: "var(--surface-2)",
            borderRadius: "var(--r-md)",
            fontSize: 12,
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {tool.skillContent}
        </pre>
      </div>
      <div
        style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={onReject}
          data-testid="reject-tool-btn"
        >
          Reject
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onApprove}
          data-testid="approve-tool-btn"
        >
          Approve
        </button>
      </div>
    </Dialog>
  );
}
