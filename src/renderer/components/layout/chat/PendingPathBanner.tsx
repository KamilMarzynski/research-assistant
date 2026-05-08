import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePathApprovalPayload } from "../../../../shared/ipc-guards";
import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { glassSx } from "../../../theme";
import PendingPathModal from "./PendingPathModal";

export default function PendingPathBanner() {
  const { items, remove } = usePendingItems<PathApprovalPayload>({
    channel: IPC.PATH_APPROVAL_REQUIRED,
    decode: decodePathApprovalPayload,
    getKey: (r) => `${r.projectId}:${r.path}:${r.mode}`,
  });
  const [selected, setSelected] = useState<PathApprovalPayload | null>(null);

  const handleResolve = async (
    req: PathApprovalPayload,
    action: "approve_once" | "approve_session" | "deny",
  ) => {
    try {
      await window.electronAPI.invoke(IPC.RESOLVE_PATH_APPROVAL, {
        path: req.path,
        mode: req.mode,
        action,
        projectId: req.projectId,
      });
    } catch {
      // Handler may throw if already resolved
    }
    remove(req);
    setSelected(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((req) => (
        <Box
          key={`${req.projectId}:${req.path}:${req.mode}`}
          data-testid={`pending-path-banner-${req.mode}`}
          sx={{
            ...glassSx,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Blocked path: <strong>{req.path}</strong> — {req.mode} access required
          </Typography>
          <Button
            size="small"
            data-testid={`review-path-btn-${req.mode}`}
            onClick={() => setSelected(req)}
          >
            Review
          </Button>
        </Box>
      ))}
      {selected && (
        <PendingPathModal
          request={selected}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={() => handleResolve(selected, "deny")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
