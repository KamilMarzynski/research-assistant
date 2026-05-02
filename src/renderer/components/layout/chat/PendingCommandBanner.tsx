import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { glassSx } from "../../../styles/glass";
import PendingCommandModal from "./PendingCommandModal";

interface BlockedCommand {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  key: string;
  projectId: string;
  intent: string;
  timestamp: string;
}

export default function PendingCommandBanner() {
  const [blocked, setBlocked] = useState<BlockedCommand[]>([]);
  const [selected, setSelected] = useState<BlockedCommand | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.on(IPC.BASH_BLOCKED, (data) => {
      const cmd = data as BlockedCommand;
      setBlocked((prev) => {
        if (prev.some((c) => c.commandId === cmd.commandId)) return prev;
        return [...prev, cmd];
      });
    });
    return unsub;
  }, []);

  const handleResolve = async (
    cmd: BlockedCommand,
    action: "approve_once" | "approve_session" | "deny",
  ) => {
    try {
      await window.electronAPI.invoke(IPC.RESOLVE_BLOCKED_COMMAND, {
        commandId: cmd.commandId,
        action,
        projectId: cmd.projectId,
      });
    } catch {
      // Handler may throw if commandId already resolved
    }
    setBlocked((prev) => prev.filter((c) => c.commandId !== cmd.commandId));
    setSelected(null);
  };

  if (blocked.length === 0) return null;

  return (
    <>
      {blocked.map((cmd) => (
        <Box
          key={cmd.commandId}
          data-testid={`pending-command-banner-${cmd.key}`}
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
            Blocked command: <strong>{cmd.command}</strong> — {cmd.reason}
          </Typography>
          <Button
            size="small"
            data-testid={`review-command-btn-${cmd.key}`}
            onClick={() => setSelected(cmd)}
          >
            Review
          </Button>
        </Box>
      ))}
      {selected && (
        <PendingCommandModal
          command={selected}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={() => handleResolve(selected, "deny")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
