import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import PendingToolModal from "./PendingToolModal";

interface PendingTool {
  name: string;
  skillContent: string;
}

export default function PendingToolBanner() {
  const [pendingTools, setPendingTools] = useState<PendingTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    window.electronAPI
      .invoke(IPC.GET_PENDING_TOOLS)
      .then((tools) => setPendingTools(tools as PendingTool[]));

    const unsub = window.electronAPI.on(IPC.TOOL_PENDING, (data) => {
      const tool = data as PendingTool;
      setPendingTools((prev) => {
        if (prev.some((t) => t.name === tool.name)) return prev;
        return [...prev, tool];
      });
    });

    return unsub;
  }, []);

  const handleApprove = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
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
          sx={{
            px: 2,
            py: 1,
            borderBottom: 1,
            borderColor: "warning.main",
            display: "flex",
            alignItems: "center",
            gap: 1,
            bgcolor: "warning.light",
          }}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </Typography>
          <Button size="small" onClick={() => setSelectedTool(tool)}>
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
