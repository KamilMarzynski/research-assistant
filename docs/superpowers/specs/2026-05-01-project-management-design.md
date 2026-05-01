# Project Management Design

**Goal:** Add rename, delete, and unlink folder actions for projects in LeftSidebar, accessed via right-click context menu.

**Architecture:** Backend changes in repository/service/IPC layers; frontend changes only in `LeftSidebar.tsx` with MUI Menu + Dialog + inline editing.

**Tech Stack:** Electron IPC, Drizzle ORM, MUI Menu/Dialog/TextField, React state

---

## Backend

### Repository (`IProjectRepository.ts`)

Add 2 new methods:

```typescript
rename(id: string, name: string): Promise<void>;
unlinkFolder(id: string): Promise<void>;
```

### DrizzleRepository (`DrizzleProjectRepository.ts`)

```typescript
async rename(id: string, name: string): Promise<void> {
  const result = await this.db.update(projects)
    .set({ name, updatedAt: new Date() })
    .where(eq(projects.id, id));
  if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
}

async unlinkFolder(id: string): Promise<void> {
  const result = await this.db.update(projects)
    .set({ folderPath: null, updatedAt: new Date() })
    .where(eq(projects.id, id));
  if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
}
```

### Service (`ProjectService.ts`)

```typescript
async renameProject(id: string, name: string): Promise<void> {
  await this.getProject(id);
  await this.repo.rename(id, name);
}

async unlinkFolder(id: string): Promise<void> {
  await this.getProject(id);
  await this.repo.unlinkFolder(id);
}
```

---

## IPC

### Channels (`ipc-channels.ts`)

```typescript
RENAME_PROJECT: "RENAME_PROJECT",
DELETE_PROJECT: "DELETE_PROJECT",
UNLINK_FOLDER: "UNLINK_FOLDER",
```

### Handlers (`ipc-handlers.ts`)

- **`RENAME_PROJECT`**: validates `{ id: string, name: string }`, rejects empty name, calls `projectService.renameProject()`
- **`DELETE_PROJECT`**: validates `{ id: string }`, calls `projectService.deleteProject()` (cascade deletes messages, artifacts, tasks)
- **`UNLINK_FOLDER`**: validates `{ id: string }`, calls `projectService.unlinkFolder()`

All three are `ipcMain.handle` (invoke pattern, request/response).

---

## UI (`LeftSidebar.tsx`)

### Right-click context menu

MUI `<Menu>` anchored at right-click position on `<ListItemButton>`. Tracked via state:

```typescript
const [contextMenu, setContextMenu] = useState<{
  project: Project;
  anchor: HTMLElement;
} | null>(null);
```

Menu items:
- **Rename** — closes menu, sets `renamingProject` state to the project ID
- **Delete** — closes menu, opens confirmation dialog
- **Unlink folder** — closes menu, calls IPC immediately (only shown if `project.folderPath !== null`)

### Inline rename

When `renamingProject` matches a project's ID, the `<ListItemText>` is replaced with a `<TextField autoFocus>` pre-filled with the current name. Behavior:
- **Enter** — call `window.electronAPI.invoke(IPC.RENAME_PROJECT, { id, name })`, refresh list, clear renaming state
- **Escape** — cancel, clear renaming state, revert name
- **Blur** — if name changed and non-empty: save and refresh; otherwise: cancel and revert

### Delete confirmation dialog

MUI `<Dialog>`:

```
Title:   Delete Project: <name>
Content: This will permanently delete this project and all its messages, artifacts, and research tasks.
Actions: [Cancel] [Delete (red)]
```

On delete:
1. Call `window.electronAPI.invoke(IPC.DELETE_PROJECT, { id })`
2. If `activeProjectId === deletedId`, clear it
3. Refresh project list
4. Close dialog

### Error handling

All IPC calls wrapped in try-catch. On failure: `console.error` with the error message. The UI does not show a snackbar/toast — silent failure with console log matches existing patterns in the codebase.

### Folder indicator

Show a small folder icon/badge next to projects that have a linked folder, so users can see which have one.

---

## Files Changed

| File | Change |
|---|---|
| `src/main/repositories/IProjectRepository.ts` | Add `rename`, `unlinkFolder` |
| `src/main/repositories/drizzle/DrizzleProjectRepository.ts` | Implement `rename`, `unlinkFolder` |
| `src/main/services/ProjectService.ts` | Add `renameProject`, `unlinkFolder` |
| `src/main/__tests__/ProjectService.test.ts` | Tests for new methods |
| `src/shared/ipc-channels.ts` | Add 3 new channels |
| `src/main/ipc-handlers.ts` | Add 3 new handlers |
| `src/renderer/components/layout/LeftSidebar.tsx` | Context menu, inline rename, delete dialog, unlink, folder indicator |
