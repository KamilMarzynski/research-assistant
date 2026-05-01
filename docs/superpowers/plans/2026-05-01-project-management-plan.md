# Project Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename, delete, and unlink folder actions for projects via right-click context menu in LeftSidebar.

**Architecture:** Backend-first: add `rename` + `unlinkFolder` to repo and service, wire 3 new IPC handlers, then UI with context menu, inline rename text field, and delete confirmation dialog.

**Tech Stack:** Drizzle ORM, Electron IPC, MUI Menu/Dialog/TextField, React

---

### Task 1: Add `rename` and `unlinkFolder` to `IProjectRepository`

**Files:**
- Modify: `src/main/repositories/IProjectRepository.ts`

- [ ] **Step 1: Add `rename` and `unlinkFolder` signatures**

Edit `src/main/repositories/IProjectRepository.ts`:

```typescript
export interface IProjectRepository {
  create(data: CreateProjectData): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
  linkFolder(id: string, folderPath: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  unlinkFolder(id: string): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/repositories/IProjectRepository.ts
git commit -m "feat: add rename and unlinkFolder to IProjectRepository interface"
```

---

### Task 2: Implement `rename` and `unlinkFolder` in DrizzleProjectRepository

**Files:**
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`
- Test: `src/main/__tests__/ProjectService.test.ts`

- [ ] **Step 1: Implement rename**

Add to `DrizzleProjectRepository` class:

```typescript
async rename(id: string, name: string): Promise<void> {
  const result = await this.db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(eq(projects.id, id));
  if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
}
```

- [ ] **Step 2: Implement unlinkFolder**

```typescript
async unlinkFolder(id: string): Promise<void> {
  const result = await this.db
    .update(projects)
    .set({ folderPath: null, updatedAt: new Date() })
    .where(eq(projects.id, id));
  if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/repositories/drizzle/DrizzleProjectRepository.ts
git commit -m "feat: implement rename and unlinkFolder in DrizzleProjectRepository"
```

---

### Task 3: Add `renameProject` and `unlinkFolder` to ProjectService

**Files:**
- Modify: `src/main/services/ProjectService.ts`

- [ ] **Step 1: Add renameProject**

```typescript
async renameProject(id: string, name: string): Promise<void> {
  await this.getProject(id); // throws NotFoundError if missing
  await this.repo.rename(id, name);
}
```

- [ ] **Step 2: Add unlinkFolder**

```typescript
async unlinkFolder(id: string): Promise<void> {
  await this.getProject(id); // throws NotFoundError if missing
  await this.repo.unlinkFolder(id);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/ProjectService.ts
git commit -m "feat: add renameProject and unlinkFolder to ProjectService"
```

---

### Task 4: Write tests for rename and unlinkFolder

**Files:**
- Create: `src/main/__tests__/ProjectService.test.ts` (new test file)

- [ ] **Step 1: Write tests**

Create `src/main/__tests__/ProjectService.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../services/errors";

describe("ProjectService renameProject", () => {
  function makeService() {
    const repo = {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      linkFolder: vi.fn(),
      rename: vi.fn(),
      unlinkFolder: vi.fn(),
    };
    const { ProjectService } = await import("../services/ProjectService");
    return { svc: new ProjectService(repo as any), repo };
  }

  it("calls repo.rename with correct args", async () => {
    const { svc, repo } = await makeService();
    repo.get.mockResolvedValue({ id: "p1", name: "Old" });
    await svc.renameProject("p1", "New Name");
    expect(repo.rename).toHaveBeenCalledWith("p1", "New Name");
  });

  it("throws NotFoundError when project missing", async () => {
    const { svc, repo } = await makeService();
    repo.get.mockResolvedValue(null);
    await expect(svc.renameProject("missing", "X")).rejects.toThrow(NotFoundError);
    expect(repo.rename).not.toHaveBeenCalled();
  });
});

describe("ProjectService unlinkFolder", () => {
  function makeService() {
    const repo = {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      linkFolder: vi.fn(),
      rename: vi.fn(),
      unlinkFolder: vi.fn(),
    };
    const { ProjectService } = await import("../services/ProjectService");
    return { svc: new ProjectService(repo as any), repo };
  }

  it("calls repo.unlinkFolder with correct id", async () => {
    const { svc, repo } = await makeService();
    repo.get.mockResolvedValue({ id: "p1", name: "P1" });
    await svc.unlinkFolder("p1");
    expect(repo.unlinkFolder).toHaveBeenCalledWith("p1");
  });

  it("throws NotFoundError when project missing", async () => {
    const { svc, repo } = await makeService();
    repo.get.mockResolvedValue(null);
    await expect(svc.unlinkFolder("missing")).rejects.toThrow(NotFoundError);
    expect(repo.unlinkFolder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test -- src/main/__tests__/ProjectService.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/__tests__/ProjectService.test.ts
git commit -m "test: add renameProject and unlinkFolder service tests"
```

---

### Task 5: Add 3 new IPC channels

**Files:**
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add channels**

Add after existing project-related channels:

```typescript
// renderer → main (project management)
RENAME_PROJECT: "RENAME_PROJECT",
DELETE_PROJECT: "DELETE_PROJECT",
UNLINK_FOLDER: "UNLINK_FOLDER",
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat: add RENAME_PROJECT, DELETE_PROJECT, UNLINK_FOLDER IPC channels"
```

---

### Task 6: Add 3 new IPC handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Add handlers**

Add after the `LINK_FOLDER` handler (after line ~190):

```typescript
  ipcMain.handle(IPC.RENAME_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { id?: unknown }).id !== "string" ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { id: string, name: string }");
    }
    const { id, name } = payload as { id: string; name: string };
    if (!name.trim()) throw new Error("Name cannot be empty");
    await projectService.renameProject(id, name.trim());
  });

  ipcMain.handle(IPC.DELETE_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { id?: unknown }).id !== "string"
    ) {
      throw new Error("Invalid payload: expected { id: string }");
    }
    const { id } = payload as { id: string };
    await projectService.deleteProject(id);
  });

  ipcMain.handle(IPC.UNLINK_FOLDER, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { id?: unknown }).id !== "string"
    ) {
      throw new Error("Invalid payload: expected { id: string }");
    }
    const { id } = payload as { id: string };
    await projectService.unlinkFolder(id);
  });
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: add RENAME_PROJECT, DELETE_PROJECT, UNLINK_FOLDER IPC handlers"
```

---

### Task 7: Update LeftSidebar with context menu, inline rename, delete confirm, unlink

**Files:**
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`

- [ ] **Step 1: Add imports**

Add to the import block:

```typescript
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Menu,
  MenuItem,
  ListItemIcon,
} from "@mui/material";
```

- [ ] **Step 2: Add state variables**

Add inside the component:

```typescript
const [contextMenu, setContextMenu] = useState<{
  project: Project;
  anchor: HTMLElement;
} | null>(null);
const [renamingId, setRenamingId] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState("");
const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
```

- [ ] **Step 3: Add context menu handlers**

Add after `handleCreate`:

```typescript
const handleContextMenu = (e: React.MouseEvent, project: Project) => {
  e.preventDefault();
  setContextMenu({ project, anchor: e.currentTarget });
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
```

- [ ] **Step 4: Wire context menu to ListItemButton**

Replace the `<ListItemButton>` with one that has `onContextMenu`:

```typescript
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
      {p.folderPath && <FolderOpenIcon sx={{ fontSize: 14, ml: 0.5, color: "text.disabled" }} />}
    </>
  )}
</ListItemButton>
```

- [ ] **Step 5: Add the context menu component**

Add after the `<List>`:

```typescript
<Menu
  anchorEl={contextMenu?.anchor ?? null}
  open={!!contextMenu}
  onClose={handleCloseMenu}
  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
>
  <MenuItem onClick={handleRenameClick}>
    <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon>
    Rename
  </MenuItem>
  <MenuItem onClick={handleDeleteClick}>
    <ListItemIcon><DeleteIcon fontSize="small" /></ListItemIcon>
    Delete
  </MenuItem>
  {contextMenu?.project.folderPath && (
    <MenuItem onClick={handleUnlinkFolder}>
      <ListItemIcon><LinkOffIcon fontSize="small" /></ListItemIcon>
      Unlink folder
    </MenuItem>
  )}
</Menu>
```

- [ ] **Step 6: Add delete confirmation dialog**

Add after the `<Menu>`:

```typescript
<Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
  <DialogTitle>Delete Project: {deleteTarget?.name}</DialogTitle>
  <DialogContent>
    <DialogContentText>
      This will permanently delete this project and all its messages, artifacts,
      and research tasks.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
    <Button onClick={handleDeleteConfirm} color="error" variant="contained">
      Delete
    </Button>
  </DialogActions>
</Dialog>
```

Also add `Button` to the MUI imports.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 8: Run full test suite**

Run: `bun run test`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/layout/LeftSidebar.tsx
git commit -m "feat: add right-click context menu for project management"
```

---

### Self-Review Checklist

**Spec coverage:**
- Backend: `rename` + `unlinkFolder` in repo → Task 1, 2
- Service: `renameProject` + `unlinkFolder` → Task 3
- Tests: service unit tests → Task 4
- IPC: 3 channels → Task 5
- IPC: 3 handlers with validation → Task 6
- UI: context menu with 3 actions → Task 7
- UI: inline rename (TextField replaces ListItemText) → Task 7
- UI: delete confirmation dialog → Task 7
- UI: unlink folder immediate → Task 7
- UI: folder indicator icon → Task 7

**Placeholder scan:** No TBD, TODOs, or vague steps. All code blocks contain complete code.

**Type consistency:** Method names `rename`, `unlinkFolder`, `renameProject` consistent across all layers. IPC channel names match handler names. All good.
