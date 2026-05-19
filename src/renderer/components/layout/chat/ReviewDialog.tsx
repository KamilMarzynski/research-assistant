import { Dialog } from "@mui/material";
import { useState } from "react";

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
  onApproveSession?: () => void;
  onDeny: (feedback?: string) => void;
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
  const [feedback, setFeedback] = useState("");
  const trimmed = feedback.trim();

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: paperSx } }}
      data-testid={dataTestid}
    >
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>{children}</div>
      <div
        style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onDeny(undefined)}
            data-testid="deny-btn"
          >
            Deny
          </button>
          {onApproveSession && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={onApproveSession}
              data-testid="approve-session-btn"
            >
              Approve Session
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={onApproveOnce}
            data-testid="approve-once-btn"
          >
            Approve Once
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell agent what to do instead…"
            aria-label="Tell agent what to do instead"
            rows={2}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 13,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              color: "var(--ink)",
              outline: "none",
              resize: "none",
            }}
          />
          <button
            type="button"
            className="btn btn--outline"
            disabled={!trimmed}
            onClick={() => onDeny(trimmed)}
            data-testid="redirect-btn"
          >
            Redirect
          </button>
        </div>
      </div>
    </Dialog>
  );
}
