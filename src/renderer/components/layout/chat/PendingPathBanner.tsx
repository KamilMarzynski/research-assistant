import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { decodePathApprovalPayload } from "../../../../shared/ipc-guards";
import { IPC } from "../../../../shared/ipc-channels";
import type { PathApprovalPayload } from "../../../../shared/ipc-types";
import { glassSx } from "../../../styles/glass";
import PendingPathModal from "./PendingPathModal";

export default function PendingPathBanner() {
  const [blocked, setBlocked] = useState<PathApprovalPayload[]>([]);
  const [selected, setSelected] = useState<PathApprovalPayload | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.on(IPC.PATH_APPROVAL_REQUIRED, (data) => {
      const req = decodePathApprovalPayload(data);
      if (!req) return;
      setBlocked((prev) => {
        const key = `${req.projectId}:${req.path}:${req.mode}`;
        if (prev.some((r) => `${r.projectId}:${r.path}:${r.mode}` === key)) return prev;
        return [...prev, req];
      });
    });
    return unsub;
  }, []);

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
    const key = `${req.projectId}:${req.path}:${req.mode}`;
    setBlocked((prev) => prev.filter((r) => `${r.projectId}:${r.path}:${r.mode}` !== key));
    setSelected(null);
  };

  if (blocked.length === 0) return null;

  return (
    <>
      {blocked.map((req) => (
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
