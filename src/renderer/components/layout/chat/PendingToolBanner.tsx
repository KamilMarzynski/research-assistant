import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { decodePendingTool } from "../../../../shared/ipc-guards";
import { IPC } from "../../../../shared/ipc-channels";
import type { PendingTool } from "../../../../shared/ipc-types";
import { glassSx } from "../../../styles/glass";
import PendingToolModal from "./PendingToolModal";

export default function PendingToolBanner() {
  const [pendingTools, setPendingTools] = useState<PendingTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PENDING_TOOLS).then((tools) => setPendingTools(tools));

    const unsub = window.electronAPI.on(IPC.TOOL_PENDING, (data) => {
      const tool = decodePendingTool(data);
      if (!tool) return;
      setPendingTools((prev) => {
        if (prev.some((t) => t.name === tool.name)) return prev;
        return [...prev, tool];
      });
    });

    return unsub;
  }, []);

  const handleApprove = async (tool: PendingTool) => {
    try {
      await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.REJECT_TOOL, { name: tool.name });
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  if (pendingTools.length === 0) return null;

  return (
    <>
      {pendingTools.map((tool) => (
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
