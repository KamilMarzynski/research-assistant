import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";

interface LeftSidebarProps {
  onOpenSettings: () => void;
}

export default function LeftSidebar({ onOpenSettings }: LeftSidebarProps) {
  const { activeProjectId, setActiveProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p as Project[]));
  }, []);

  const handleBrowseFolder = async () => {
    const path = await window.electronAPI.invoke(IPC.OPEN_FOLDER_DIALOG);
    setNewFolderPath(path as string | null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const project = (await window.electronAPI.invoke(IPC.CREATE_PROJECT, {
      name,
      folderPath: newFolderPath,
    })) as Project;
    setProjects((prev) => [...prev, project]);
    setNewName("");
    setNewFolderPath(null);
    setCreating(false);
    setActiveProjectId(project.id);
  };

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.paper" }}
    >
      <Box sx={{ px: 2, py: 1.5, bgcolor: "background.default" }}>
        <Typography variant="subtitle2" color="text.secondary">
          Projects
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List dense disablePadding>
          {projects.map((p) => (
            <ListItemButton
              key={p.id}
              data-testid={`project-item-${p.id}`}
              selected={p.id === activeProjectId}
              onClick={() => setActiveProjectId(p.id)}
            >
              <ListItemText
                primary={p.name}
                slotProps={{ primary: { variant: "body2", noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ px: 1, py: 0.5 }}>
          {creating ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Project name"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setNewFolderPath(null);
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) {
                    setCreating(false);
                    setNewFolderPath(null);
                  }
                }}
              />
              <Button
                size="small"
                startIcon={<FolderOpenIcon />}
                onClick={handleBrowseFolder}
                sx={{ justifyContent: "flex-start" }}
              >
                {newFolderPath ? newFolderPath.split("/").pop() : "Link folder (optional)"}
              </Button>
              {newFolderPath && (
                <Chip
                  label={newFolderPath}
                  size="small"
                  onDelete={() => setNewFolderPath(null)}
                  sx={{ maxWidth: "100%", fontSize: 10 }}
                />
              )}
            </Box>
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon />}
              data-testid="new-project-btn"
              onClick={() => setCreating(true)}
              fullWidth
              sx={{ justifyContent: "flex-start" }}
            >
              New project
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ p: 1, bgcolor: "background.default" }}>
        <IconButton size="small" onClick={onOpenSettings} title="Settings">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
