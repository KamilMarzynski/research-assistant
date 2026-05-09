import { Dialog } from "@mui/material";

const paperSx = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
  overflow: "hidden",
} as const;

interface ReviewDialogProps {
  title: string;
  children: React.ReactNode;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
  dataTestid: string;
}

export default function ReviewDialog({
  title,
  children,
  onApproveOnce,
  onApproveSession,
  onDeny,
  onClose,
  dataTestid,
}: ReviewDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: paperSx } }}
      data-testid={dataTestid}
    >
      <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>{children}</div>
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
        <button type="button" className="btn btn--danger" onClick={onDeny} data-testid="deny-btn">
          Deny
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={onApproveSession}
          data-testid="approve-session-btn"
        >
          Approve Session
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onApproveOnce}
          data-testid="approve-once-btn"
        >
          Approve Once
        </button>
      </div>
    </Dialog>
  );
}
