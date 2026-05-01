## Context

Right panel currently two empty placeholders: `RightSidebar` (50% height, "Right Sidebar" text) and `ArtifactPanel` (50% height, "Artifact Panel" text). Artifact pipeline works end-to-end: agent calls `save_artifact` → PathJail validates → `ArtifactService.saveArtifact` → DB stores `(id, projectId, title, filePath, createdAt)`. But UI never fetches or displays artifacts.

Chat (`MessageList.tsx`) renders all messages as `<Typography whiteSpace: "pre-wrap">` — research outputs with headers, tables, code blocks appear as raw text.

## Goals / Non-Goals

**Goals:**
- Single right panel replacing two placeholders, with collapsible sections
- Artifact list per active project, fetched from DB
- Artifact content viewer that reads `.md` file from disk and renders markdown
- Shared `MarkdownRenderer` component usable in chat + artifact viewer
- Chat renders assistant messages as markdown
- Path validation for file reads (defense-in-depth)

**Non-Goals:**
- Skill browser in right panel (future)
- Project management UI (rename/delete) — separate change
- Notification system
- Model provider UI (Ollama settings)
- Artifact editing or deletion
- Obsidian vault integration

## Decisions

### 1. Merge RightSidebar + ArtifactPanel into DetailsPanel

**Decision:** Single `DetailsPanel` with MUI Accordion sections. First section: "Artifacts". Room for "Skills", "Project Info" sections later.

**Why:** Two stacked 50% boxes waste space. Accordion sections let user expand what matters. Single component is simpler to wire to `ProjectContext`.

### 2. Read artifact content from filePath on disk

**Decision:** Always read `.md` file from `Artifact.filePath` via new `READ_ARTIFACT_FILE` IPC. Do not store content in DB.

**Why:** File may change (agent edits, user edits). DB copy would go stale. `filePath` already stored. Trade-off: file must exist at original path — if user moves/deletes it, viewer shows error.

### 3. Path validation for READ_ARTIFACT_FILE

**Decision:** Check for path traversal sequences (`..`, `~`, null bytes). Resolve with `path.resolve`. Reject if resolved path doesn't exist or contains traversal.

**Why:** Defense-in-depth. `filePath` was produced by PathJail during agent execution, so risk is low. But IPC handler is a new surface — basic validation prevents future misuse.

### 4. react-markdown + remark-gfm

**Decision:** Use `react-markdown` with `remark-gfm` plugin for all markdown rendering.

**Why:** Most popular React markdown lib. `remark-gfm` adds tables, strikethrough, autolinks — needed for research output. Zero-config MUI styling via component overrides.

### 5. MarkdownRenderer as shared component

**Decision:** Single `MarkdownRenderer` component in `src/renderer/components/shared/`. Used by `ArtifactViewer` and `MessageList`.

**Why:** Consistent rendering. One place to update styling, plugins, theme integration.

### 6. Artifact state scoped to DetailsPanel

**Decision:** Keep artifact list + selected artifact as local React state (`useState`) inside `DetailsPanel`. No context or store.

**Why:** Only one consumer. Simple fetch-on-project-change pattern. No need for global state.

## Risks / Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| File at artifact.filePath deleted/moved | Medium | Medium | Show "File not found" in viewer, not crash |
| Large artifact files slow down IPC | Low | Low | Read up to 500KB cap; truncate with warning |
| react-markdown bundle size | Medium | Low | Tree-shakeable; only gfm extra. Acceptable for Electron app |
| Markdown in user messages looks wrong | Low | Low | Only render assistant messages as markdown. User messages stay plain text |
