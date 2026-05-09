import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import {
  IconEdit,
  IconFolder,
  IconLogo,
  IconPlus,
  IconSettings,
  IconTrash,
  IconX,
} from "../../components/shared/Icons";
import { useProject } from "../../contexts/ProjectContext";

interface LeftSidebarProps {
  onOpenSettings: () => void;
}

export default function LeftSidebar({ onOpenSettings }: LeftSidebarProps) {
  const { activeProjectId, setActiveProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    project: Project;
    anchor: HTMLElement;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p));
  }, []);

  const handleBrowseFolder = async () => {
    const path = await window.electronAPI.invoke(IPC.OPEN_FOLDER_DIALOG);
    setNewFolderPath(path);
  };

  const handleCreate = async () => {
    if (!newFolderPath) return;
    const name = newFolderPath.split("/").pop() || "Untitled";
    const project = await window.electronAPI.invoke(IPC.CREATE_PROJECT, {
      name,
      folderPath: newFolderPath,
    });
    setProjects((prev) => [...prev, project]);
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
      setProjects(projects);
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
      setProjects(projects);
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
    setDeleteTarget(null);
  };

  return (
    <aside
      style={{
        width: 248,
        height: "100%",
        background: "var(--surface)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "38px 16px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <IconLogo size={18} />
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.005em" }}>
          Research Assistant
        </span>
      </div>

      <div
        style={{
          padding: "14px 16px 6px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="eyebrow">Projects</span>
        <span className="t-tertiary t-mono t-num" style={{ fontSize: 10 }}>
          {projects.length}
        </span>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
        {projects.map((p) => {
          const isActive = p.id === activeProjectId;
          const itemStyle = {
            display: "flex" as const,
            alignItems: "center" as const,
            gap: 8,
            padding: "7px 10px",
            borderRadius: 8,
            cursor: "pointer" as const,
            background: isActive ? "var(--accent-soft)" : "transparent",
            color: isActive ? "oklch(0.42 0.12 45)" : "var(--ink)",
            fontWeight: isActive ? (500 as const) : (400 as const),
            fontSize: 13,
            marginBottom: 2,
            width: "100%",
            border: "none",
            textAlign: "left" as const,
          };
          return renamingId === p.id ? (
            <div key={p.id} data-testid={`project-item-${p.id}`} style={itemStyle}>
              <input
                className="input"
                value={renameValue}
                // biome-ignore lint/a11y/noAutofocus: preserve original auto-focus behavior on rename input
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSave();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={handleRenameSave}
                onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 12, padding: "4px 8px", flex: 1 }}
              />
            </div>
          ) : (
            <button
              key={p.id}
              type="button"
              data-testid={`project-item-${p.id}`}
              onClick={() => setActiveProjectId(p.id)}
              onContextMenu={(e) => handleContextMenu(e, p)}
              style={itemStyle}
            >
              <span
                className={`dot ${isActive ? "dot--accent" : "dot--idle"}`}
                style={{ flexShrink: 0 }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </span>
              {p.folderPath && (
                <IconFolder
                  size={13}
                  strokeColor={isActive ? "oklch(0.5 0.1 45)" : "var(--ink-3)"}
                />
              )}
            </button>
          );
        })}

        {contextMenu && (
          <>
            <button
              type="button"
              tabIndex={-1}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 999,
                opacity: 0,
                cursor: "default",
              }}
              onClick={handleCloseMenu}
              onKeyDown={() => {}}
            />
            <div
              style={{
                position: "fixed",
                top: contextMenu.anchor.getBoundingClientRect().bottom,
                left: contextMenu.anchor.getBoundingClientRect().right,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-md)",
                boxShadow: "var(--shadow-2)",
                zIndex: 1000,
                padding: "4px 0",
                minWidth: 140,
              }}
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ width: "100%", justifyContent: "flex-start", borderRadius: 0 }}
                onClick={handleRenameClick}
              >
                <IconEdit size={13} /> Rename
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{
                  width: "100%",
                  justifyContent: "flex-start",
                  borderRadius: 0,
                  color: "var(--danger)",
                }}
                onClick={handleDeleteClick}
              >
                <IconTrash size={13} /> Delete
              </button>
            </div>
          </>
        )}

        {creating ? (
          <div
            style={{
              padding: 8,
              marginTop: 4,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: "var(--surface-2)",
              borderRadius: 10,
              border: "1px dashed var(--accent-line)",
            }}
          >
            <button
              type="button"
              className="btn btn--outline btn--sm"
              style={{ justifyContent: "flex-start" }}
              onClick={handleBrowseFolder}
            >
              <IconFolder size={13} />
              {newFolderPath ? newFolderPath.split("/").pop() : "Select project folder *"}
            </button>
            {newFolderPath && (
              <span className="chip chip--mono" style={{ alignSelf: "flex-start" }}>
                {newFolderPath}
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  style={{ width: 16, height: 16, padding: 0, marginLeft: 4 }}
                  onClick={() => setNewFolderPath(null)}
                >
                  <IconX size={12} />
                </button>
              </span>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ flex: 1 }}
                onClick={() => {
                  setCreating(false);
                  setNewFolderPath(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                style={{ flex: 1 }}
                disabled={!newFolderPath}
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="new-project-btn"
            style={{ width: "100%", justifyContent: "flex-start", marginTop: 6 }}
            onClick={() => setCreating(true)}
          >
            <IconPlus size={13} /> New project
          </button>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--line)",
          padding: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              color: "oklch(0.42 0.12 45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            U
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>User</span>
            <span className="t-tertiary t-mono" style={{ fontSize: 10 }}>
              local
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title="Settings"
          onClick={onOpenSettings}
        >
          <IconSettings size={15} />
        </button>
      </div>

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        slotProps={{
          paper: {
            style: {
              background: "var(--surface)",
              color: "var(--ink)",
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-2)",
            },
          },
        }}
      >
        <DialogTitle style={{ fontSize: 14, fontWeight: 600, padding: "16px 16px 8px" }}>
          Delete Project: {deleteTarget?.name}
        </DialogTitle>
        <DialogContent style={{ padding: "0 16px 16px" }}>
          <DialogContentText style={{ color: "var(--ink-2)", fontSize: 13 }}>
            This will permanently delete this project and all its messages, artifacts, and research
            tasks.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: "0 16px 16px", gap: 8 }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button type="button" className="btn btn--danger btn--sm" onClick={handleDeleteConfirm}>
            Delete
          </button>
        </DialogActions>
      </Dialog>
    </aside>
  );
}
