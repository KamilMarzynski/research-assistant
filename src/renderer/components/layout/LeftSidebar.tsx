import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
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
  const [contextMenu, setContextMenu] = useState<{
    project: Project;
    anchor: HTMLElement;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

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

  const handleContextMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setContextMenu({ project, anchor: e.currentTarget as HTMLElement });
  };

  const handleCloseMenu = () => setContextMenu(null);

  const handleRenameClick = () => {
    if (!contextMenu) return;
    setRenamingId(contextMenu.project.id);
    setRenameValue(contextMenu.project.name);
    handleCloseMenu();
  };

  const handleRenameSave = async () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    try {
      await window.electronAPI.invoke(IPC.RENAME_PROJECT, { id: renamingId, name });
      const projects = await window.electronAPI.invoke(IPC.GET_PROJECTS);
      setProjects(projects as Project[]);
    } catch (err) {
      console.error("Failed to rename project:", err);
    }
    setRenamingId(null);
  };

  const handleDeleteClick = () => {
    if (!contextMenu) return;
    setDeleteTarget(contextMenu.project);
    handleCloseMenu();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await window.electronAPI.invoke(IPC.DELETE_PROJECT, { id: deleteTarget.id });
      if (activeProjectId === deleteTarget.id) setActiveProjectId(null);
      const projects = await window.electronAPI.invoke(IPC.GET_PROJECTS);
      setProjects(projects as Project[]);
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
    setDeleteTarget(null);
  };

  const handleUnlinkFolder = async () => {
    if (!contextMenu) return;
    const id = contextMenu.project.id;
    handleCloseMenu();
    try {
      await window.electronAPI.invoke(IPC.UNLINK_FOLDER, { id });
      const projects = await window.electronAPI.invoke(IPC.GET_PROJECTS);
      setProjects(projects as Project[]);
    } catch (err) {
      console.error("Failed to unlink folder:", err);
    }
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
              onContextMenu={(e) => handleContextMenu(e, p)}
            >
              {renamingId === p.id ? (
                <TextField
                  size="small"
                  fullWidth
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSave();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={handleRenameSave}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ "& .MuiInputBase-input": { py: 0.5, fontSize: "0.875rem" } }}
                />
              ) : (
                <>
                  <ListItemText
                    primary={p.name}
                    slotProps={{ primary: { variant: "body2", noWrap: true } }}
                  />
                  {p.folderPath && (
                    <FolderOpenIcon sx={{ fontSize: 14, ml: 0.5, color: "text.disabled" }} />
                  )}
                </>
              )}
            </ListItemButton>
          ))}
        </List>

        <Menu
          anchorEl={contextMenu?.anchor ?? null}
          open={!!contextMenu}
          onClose={handleCloseMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <MenuItem onClick={handleRenameClick}>
            <ListItemIcon>
              <DriveFileRenameOutlineIcon fontSize="small" />
            </ListItemIcon>
            Rename
          </MenuItem>
          <MenuItem onClick={handleDeleteClick}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            Delete
          </MenuItem>
          {contextMenu?.project.folderPath && (
            <MenuItem onClick={handleUnlinkFolder}>
              <ListItemIcon>
                <LinkOffIcon fontSize="small" />
              </ListItemIcon>
              Unlink folder
            </MenuItem>
          )}
        </Menu>

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

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Project: {deleteTarget?.name}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete this project and all its messages, artifacts, and research
            tasks.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
