import { Box, Chip, Typography } from "@mui/material";
import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import ReviewDialog from "./ReviewDialog";

interface PendingPathModalProps {
  request: PathApprovalPayload;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
}

const modeColors: Record<string, string> = {
  read: "#2196f3",
  write: "#f44336",
};

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
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Chip
          label={request.mode}
          sx={{
            bgcolor: modeColors[request.mode] ?? "grey.500",
            color: "#fff",
            textTransform: "capitalize",
          }}
          size="small"
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        The agent tried to access a path outside the allowed zones. Review before approving.
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
        {request.path}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        <strong>Project:</strong> {request.projectId}
      </Typography>
    </ReviewDialog>
  );
}
