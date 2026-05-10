# Sidebar Redesign and Artifact Simplification

## Problem

The right sidebar (`DetailsPanel`) currently mixes three unrelated things:
1. **Recent outputs** — dismissible notifications backed by the `acknowledged` column
2. **File explorer** — live project-folder tree (including workspace artifacts)
3. **Research status** — a transient bar that auto-dismisses after 30 s

This creates ambiguity: the agent can create artifacts via either `write_file` or `save_artifact`, and both write to the same DB table with no way to tell which tool created the row. The user wants the sidebar to show only *project outputs* (files written into the linked project folder), not workspace scratch files or Obsidian notes, and wants a persistent research history instead of a flashing status bar.

## Goals

1. **Remove `save_artifact` tool** — one less concept for the agent to learn.
2. **Auto-capture project-folder writes** — any `write_file` that lands inside the linked project folder automatically becomes an artifact record.
3. **Sidebar = two scrollable panels** — top half for project artifacts, bottom half for research history.
4. **No more acknowledgements / notifications** — artifacts are facts, not alerts.
5. **No more file explorer in sidebar** — the tree is redundant with the OS file manager and leaks workspace internals.
6. **Research history persists** — list of all researches for the project, sorted by start date, with live status updates.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Right Sidebar (DetailsPanel)                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  WindowDragBar                                         │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  ProjectArtifactsPanel (top, 50 %, scrollable)        │  │
│  │  ┌─ rounded container ────────────────────────────────┐ │  │
│  │  │  • report.md    (title chip)                     │ │  │
│  │  │  • data.json    (title chip)                     │ │  │
│  │  │  • src/lib.ts   (title chip)                     │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  ResearchHistoryPanel (bottom, 50 %, scrollable)      │  │
│  │  ┌─ rounded container ────────────────────────────────┐ │  │
│  │  │  ● Running   "quantum computing..."   Today      │ │  │
│  │  │  ● Done      "market analysis..."     Yesterday   │ │  │
│  │  │  ● Failed    "deep web crawl..."      May 5      │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Main process changes

| What | Before | After |
|---|---|---|
| Agent tools | `write_file`, `save_artifact` | `write_file` only |
| Artifact creation | `OutputNotificationService.recordWrite` + `saveArtifactFn` | `write_file` → `onFileWrite` callback |
| Output routing | `OutputRouter.moveFinals` renames files | `OutputRouter.moveFinals` renames files **and** creates artifact records |
| Research event → IPC | `RESEARCH_STATUS_UPDATE`, `RESEARCH_COMPLETE` | Keep, plus new `RESEARCH_HISTORY_UPDATE` push |
| Artifact fetch | `GET_RECENT_OUTPUTS` (unacknowledged only) | `GET_PROJECT_ARTIFACTS` (all, date desc) |
| Research fetch | none | `GET_RESEARCHES` (all tasks for project) |
| Dead channels | `ACKNOWLEDGE_OUTPUT`, `ACKNOWLEDGE_ALL_OUTPUTS` | remove |

### Renderer changes

| Component | Before | After |
|---|---|---|
| `DetailsPanel` | `WindowDragBar` + `RecentOutputsPanel` + `FileExplorer` | `WindowDragBar` + `ProjectArtifactsPanel` + `ResearchHistoryPanel` |
| `RecentOutputsPanel` | dismissible list, ack buttons | **deleted** |
| `FileExplorer` | recursive file tree | **deleted** (or kept but moved elsewhere if needed) |
| `ProjectArtifactsPanel` | new | scrollable rounded list, no actions |
| `ResearchHistoryPanel` | new | scrollable rounded list, status chips, live updates |
| `ResearchStatusBar` | transient bar in chat | **simplified** or kept as thin status strip only |

## Data Flow

### New artifact creation (agent writes to project folder)

```
Agent calls write_file(path=/project/docs/report.md)
  → createWriteFileTool resolves path via PathJail
  → writes bytes
  → onFileWrite(resolved, relative="docs/report.md", fileName="report.md")
    → ArtifactService.saveArtifact({ projectId, title: fileName, filePath: resolved, relativePath: relative })
      → DrizzleArtifactRepository.create(...)
        → INSERT INTO artifacts (id, projectId, title, filePath, relativePath, createdAt)
```

The `acknowledged` column becomes unused (always `false`). We do not drop it in this change to keep the migration zero-cost, but the UI never references it.

### Output routing (research done, workspace → project)

```
ResearchService._runResearch
  → agent_end event
    → OutputRouter.moveFinals(workspacePath, conventions)
      → rename file into project folder
      → *new* create artifact record for each moved file
    → eventBus.emit("research:complete")
```

### Research history update

Renderer already receives `RESEARCH_STATUS_UPDATE` and `RESEARCH_COMPLETE` via `registerEventForwarders`. No new push channel needed.

```
EventBus "research:started" / "research:progress" / "research:complete" / "research:failed"
  → registerEventForwarders
    → win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, ...)   // existing
```

`ResearchHistoryPanel` subscribes to `RESEARCH_STATUS_UPDATE` and `RESEARCH_COMPLETE`. On any event for its project, it re-invokes `GET_RESEARCHES` to refresh the list. This avoids a new IPC channel and keeps the renderer state simple.

## IPC Changes

### New channels

```ts
GET_PROJECT_ARTIFACTS: "GET_PROJECT_ARTIFACTS"  // renderer→main invoke
GET_RESEARCHES: "GET_RESEARCHES"                // renderer→main invoke
```

### Removed channels

```ts
GET_RECENT_OUTPUTS       // replaced by GET_PROJECT_ARTIFACTS
ACKNOWLEDGE_OUTPUT       // no longer needed
ACKNOWLEDGE_ALL_OUTPUTS  // no longer needed
```

### Payload types

```ts
// GET_PROJECT_ARTIFACTS
{ projectId: string }
→ Artifact[]  // all artifacts for project, newest first

// GET_RESEARCHES
{ projectId: string }
→ Array<{
    id: string;
    query: string;
    status: "pending" | "in_progress" | "complete" | "failed";
    startedAt: Date;
    error?: string | null;
  }>

```

## Component Design

### `ProjectArtifactsPanel`

- Fetch on mount + when `projectId` changes.
- Container: `border: 1px solid var(--line)`, `border-radius: var(--r-lg)`, `background: var(--surface-2)`.
- Header: `eyebrow` label "Project Artifacts" with `dot--accent`.
- List: `thin-scroll`, flex column, gap `var(--s-2)`.
- Item: filename (ellipsized) + title chip. No buttons.
- Empty state: small centered text "No artifacts yet".

### `ResearchHistoryPanel`

- Fetch on mount + when `projectId` changes.
- Subscribe to `RESEARCH_HISTORY_UPDATE` — if `projectId` matches, replace list.
- Container: same rounded style as artifacts panel.
- Header: `eyebrow` label "Researches" with `dot--accent`.
- List: `thin-scroll`, flex column, gap `var(--s-2)`.
- Item:
  - Status dot (`dot--accent dot--pulse` for running, `dot--success` for done, `dot--danger` for failed)
  - Status label chip ("Running" / "Done" / "Failed")
  - Truncated query text (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`)
  - Date (relative: "Today", "Yesterday", or absolute)
- Empty state: "No research history".

### `DetailsPanel`

```tsx
<div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
  <WindowDragBar />
  <ProjectArtifactsPanel projectId={activeProjectId} />
  <ResearchHistoryPanel projectId={activeProjectId} />
</div>
```

Both panels get `flex: 1` so they split remaining height equally (≈ 50 % each).

## Dead Code Removal

| File / export | Reason |
|---|---|
| `src/main/agent/tools/artifact-tools.ts` | `save_artifact` tool deleted |
| `OutputNotificationService` | `write_file` callback replaces it |
| `GET_RECENT_OUTPUTS`, `ACKNOWLEDGE_OUTPUT`, `ACKNOWLEDGE_ALL_OUTPUTS` | channels removed |
| `RecentOutputsPanel` | replaced by `ProjectArtifactsPanel` |
| `FileExplorer` | removed from sidebar (can be reintroduced later elsewhere) |
| `ResearchStatusBar` test | update or delete depending on final decision |

## Testing Plan

1. **Unit**: `ProjectArtifactsPanel` — renders list, empty state, handles long filenames.
2. **Unit**: `ResearchHistoryPanel` — renders statuses, formats dates, updates on push event.
3. **Unit**: `DetailsPanel` — no project → empty state; active project → both panels mount.
4. **Main**: `ArtifactService` — `listArtifacts` returns all rows date-desc.
5. **Main**: `TaskPersistenceService` — `getTasksByProject` (new query) returns correct rows.
6. **Integration**: trigger `write_file` in project folder → DB row created → renderer shows it.
7. **Integration**: finish research → `OutputRouter.moveFinals` creates artifact rows.
8. **E2E**: run agent → sidebar shows artifact + running research → completes → status changes.

## Questions & Decisions

**Q: What about `acknowledged` column?**  
A: Leave it. Always `false`. No migration. Future feature may use it for "mark as read", but not today.

**Q: What about workspace files written during research?**  
A: Not shown in sidebar. Only files that end up in the linked project folder (via direct `write_file` or `OutputRouter.moveFinals`) become artifacts.

**Q: What about Obsidian notes?**  
A: If agent writes to Obsidian vault path (outside project folder), `onFileWrite` check `resolved.startsWith(folderPath)` fails → no artifact record → not shown.

**Q: File explorer gone forever?**  
A: Only from sidebar. Can be reintroduced later as a modal, full-viewer, or separate tab if needed. Not in scope.

**Q: Research item click action?**  
A: None for now. Purely informational. Click actions (view results, retry) deferred.

## Open Items

- [x] Confirm `FileExplorer` removal — only consumed by `DetailsPanel`. Safe to remove from sidebar.
- [x] Confirm `ResearchStatusBar` simplification scope — keep in chat as thin status strip, do not touch in this change.
- [x] Decide push channel for research updates — no new channel. Renderer re-fetches `GET_RESEARCHES` on existing `RESEARCH_STATUS_UPDATE` / `RESEARCH_COMPLETE` events.
