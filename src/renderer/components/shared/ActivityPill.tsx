import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import CircularProgress from "@mui/material/CircularProgress";

export interface ActivityPillProps {
  toolCallId: string;
  toolName: string;
  description: string;
  status: "running" | "done" | "error";
}

export default function ActivityPill({ description, status }: ActivityPillProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 10,
        background: "var(--surface)",
        border: `1px solid ${status === "running" ? "var(--accent)" : "var(--line)"}`,
        maxWidth: 480,
        width: "fit-content",
      }}
    >
      {status === "running" && (
        <CircularProgress
          data-testid="activity-running"
          size={14}
          sx={{ color: "var(--accent)", flexShrink: 0 }}
        />
      )}
      {status === "done" && (
        <CheckIcon
          data-testid="activity-done"
          sx={{ fontSize: 14, color: "var(--ink-2)", flexShrink: 0 }}
        />
      )}
      {status === "error" && (
        <CloseIcon
          data-testid="activity-error"
          sx={{ fontSize: 14, color: "error.main", flexShrink: 0 }}
        />
      )}
      <span
        data-testid="activity-description"
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 440,
        }}
      >
        {description}
      </span>
    </div>
  );
}
