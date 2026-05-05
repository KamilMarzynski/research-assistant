import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { decodePendingTool } from "../../../../shared/ipc-guards";
import { IPC } from "../../../../shared/ipc-channels";
import type { PendingTool } from "../../../../shared/ipc-types";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { glassSx } from "../../../styles/glass";
import PendingToolModal from "./PendingToolModal";

export default function PendingToolBanner() {
  const { items, add, remove } = usePendingItems<PendingTool>({
    channel: IPC.TOOL_PENDING,
    decode: decodePendingTool,
    getKey: (t) => t.name,
  });
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PENDING_TOOLS).then((tools) => {
      for (const tool of tools as PendingTool[]) add(tool);
    });
  }, [add]);

  const handleApprove = async (tool: PendingTool) => {
    try {
      await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    remove(tool);
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.REJECT_TOOL, { name: tool.name });
    remove(tool);
    setSelectedTool(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((tool) => (
        <Box
          key={tool.name}
          data-testid={`pending-tool-banner-${tool.name}`}
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
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </Typography>
          <Button
            size="small"
            data-testid={`review-tool-btn-${tool.name}`}
            onClick={() => setSelectedTool(tool)}
          >
            Review
          </Button>
        </Box>
      ))}
      {selectedTool && (
        <PendingToolModal
          tool={selectedTool}
          onApprove={() => handleApprove(selectedTool)}
          onReject={() => handleReject(selectedTool)}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
