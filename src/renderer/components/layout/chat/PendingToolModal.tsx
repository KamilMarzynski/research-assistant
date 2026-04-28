import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { glassSx } from "../../../styles/glass";

interface PendingTool {
  name: string;
  skillContent: string;
}

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
    <Dialog open onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: glassSx } }}>
      <DialogTitle>Review proposed tool: {tool.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          An agent has proposed this tool for your approval. Once approved, it will be available as
          a skill in future sessions.
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
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {tool.skillContent}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onReject} color="error">
          Reject
        </Button>
        <Button onClick={onApprove} variant="contained">
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}
