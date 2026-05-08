import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { glassSx } from "../../../theme";

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
      slotProps={{ paper: { sx: glassSx } }}
      data-testid={dataTestid}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onDeny} color="error" data-testid="deny-btn">
          Deny
        </Button>
        <Button onClick={onApproveSession} variant="outlined" data-testid="approve-session-btn">
          Approve Session
        </Button>
        <Button onClick={onApproveOnce} variant="contained" data-testid="approve-once-btn">
          Approve Once
        </Button>
      </DialogActions>
    </Dialog>
  );
}
