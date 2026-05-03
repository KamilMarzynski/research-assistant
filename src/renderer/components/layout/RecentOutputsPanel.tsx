import CheckIcon from "@mui/icons-material/Check";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { Box, Button, Chip, IconButton, List, ListItem, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";

interface RecentOutputsPanelProps {
  projectId: string;
}

export default function RecentOutputsPanel({ projectId }: RecentOutputsPanelProps) {
  const [outputs, setOutputs] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_RECENT_OUTPUTS, { projectId }).then(setOutputs);
  }, [projectId]);

  const handleAcknowledge = async (artifactId: string) => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_OUTPUT, { projectId, artifactId });
    setOutputs((prev) => prev.filter((o) => o.id !== artifactId));
  };

  const handleAcknowledgeAll = async () => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_ALL_OUTPUTS, { projectId });
    setOutputs([]);
  };

  const handleReveal = async (filePath: string) => {
    await window.electronAPI.invoke(IPC.REVEAL_IN_FOLDER, { filePath, projectId });
  };

  if (outputs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No recent outputs
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2">Recent Outputs</Typography>
        <Button size="small" startIcon={<CheckCircleOutlinedIcon />} onClick={handleAcknowledgeAll}>
          Acknowledge All
        </Button>
      </Box>

      <List dense sx={{ flex: 1, overflow: "auto" }}>
        {outputs.map((output) => (
          <ListItem
            key={output.id}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 0.5,
              py: 1,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: "0.8rem" }}>
                {output.filePath}
              </Typography>
              <IconButton
                size="small"
                onClick={() => handleReveal(output.filePath)}
                title="Show in folder"
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => handleAcknowledge(output.id)}
                title="Acknowledge"
              >
                <CheckIcon fontSize="small" />
              </IconButton>
            </Box>
            <Chip
              label={output.title}
              size="small"
              variant="outlined"
              sx={{ fontSize: "0.7rem" }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
