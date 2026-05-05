import { Box, Button, Typography } from "@mui/material";
import { useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodeBlockedCommandPayload } from "../../../../shared/ipc-guards";
import type { BlockedCommandPayload } from "../../../../shared/ipc-types";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { glassSx } from "../../../styles/glass";
import PendingCommandModal from "./PendingCommandModal";

export default function PendingCommandBanner() {
  const { items, remove } = usePendingItems<BlockedCommandPayload>({
    channel: IPC.BASH_BLOCKED,
    decode: decodeBlockedCommandPayload,
    getKey: (c) => c.commandId,
  });
  const [selected, setSelected] = useState<BlockedCommandPayload | null>(null);

  const handleResolve = async (
    cmd: BlockedCommandPayload,
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
    remove(cmd);
    setSelected(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((cmd) => (
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
