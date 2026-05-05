import { Box, Chip, Typography } from "@mui/material";
import type { BlockedCommandPayload } from "../../../../shared/ipc-types";
import ReviewDialog from "./ReviewDialog";

interface PendingCommandModalProps {
  command: BlockedCommandPayload;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
}

const categoryColors: Record<string, string> = {
  destructive: "#f44336",
  privilege_escalation: "#ff9800",
  exfiltration: "#ffc107",
  persistence: "#9c27b0",
};

export default function PendingCommandModal({
  command,
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Chip
          label={command.category.replace("_", " ")}
          sx={{
            bgcolor: categoryColors[command.category] ?? "grey.500",
            color: "#fff",
            textTransform: "capitalize",
          }}
          size="small"
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        The agent tried to run this command. Review before approving.
      </Typography>
      <Box
        component="pre"
        sx={{
          p: 2,
          bgcolor: "grey.900",
          color: "grey.100",
          borderRadius: 1,
          overflow: "auto",
          fontSize: 12,
          maxHeight: 200,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          mb: 2,
        }}
      >
        {command.command}
      </Box>
      <Typography variant="body2" color="text.secondary">
        <strong>Reason:</strong> {command.reason}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        <strong>Intent:</strong> {command.intent} · <strong>Project:</strong> {command.projectId}
      </Typography>
    </ReviewDialog>
  );
}
