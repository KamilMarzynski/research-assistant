## 1. Setup

- [x] 1.1 Install `react-markdown` and `remark-gfm` with `bun add react-markdown remark-gfm`
- [x] 1.2 Add type declarations for `react-markdown` if needed (check if types ship with package)

## 2. IPC — READ_ARTIFACT_FILE

- [x] 2.1 Add `READ_ARTIFACT_FILE` to `IPC` constants in `src/shared/ipc-channels.ts`
- [x] 2.2 Add handler in `src/main/ipc-handlers.ts`: validate path (reject `..`, `~`, null bytes), resolve, check exists, read with 500KB cap, return UTF-8 string
- [x] 2.3 Verify ALLOWED_CHANNELS in preload auto-whitelists the new channel

## 3. MarkdownRenderer Shared Component

- [x] 3.1 Create `src/renderer/components/shared/MarkdownRenderer.tsx` using `react-markdown` + `remark-gfm`
- [x] 3.2 Style headings, code blocks (monospace + background), tables (borders), and links using MUI `sx` or styled components
- [x] 3.3 Handle empty content (render nothing), malformed markdown (best-effort, no crash)

## 4. Details Panel — Artifact Section

- [x] 4.1 Create `src/renderer/components/layout/ArtifactSection.tsx` with:
  - MUI Accordion, expanded by default
  - Fetches artifacts via `GET_ARTIFACTS` when `activeProjectId` changes
  - Shows list of artifact titles with creation dates
  - Empty state: "No artifacts yet" when list is empty

- [x] 4.2 Create `src/renderer/components/layout/ArtifactViewer.tsx` with:
  - Reads file content via `READ_ARTIFACT_FILE` IPC when artifact selected
  - Renders content using `MarkdownRenderer`
  - Back button to return to artifact list
  - "File not found" state when file missing
  - Loading state while fetching content

- [x] 4.3 Create `src/renderer/components/layout/DetailsPanel.tsx`:
  - Replaces `RightSidebar` + `ArtifactPanel`
  - Contains `ArtifactSection` as first collapsible section
  - Uses MUI Accordion for section layout
  - Room for future sections (placeholder comment)

## 5. Chat Markdown Upgrade

- [x] 5.1 Update `MessageList.tsx`: render assistant-role messages with `MarkdownRenderer` instead of plain `<Typography>`
- [x] 5.2 Keep user messages as plain text (no markdown rendering)
- [x] 5.3 Render streaming content as markdown too (streaming cursor stays)

## 6. Integration

- [x] 6.1 Update `AppShell.tsx`: replace `<RightSidebar />` + `<ArtifactPanel />` with `<DetailsPanel />`
- [x] 6.2 Delete `src/renderer/components/layout/RightSidebar.tsx` and `src/renderer/components/layout/artifacts/ArtifactPanel.tsx`

## 7. Tests

- [x] 7.1 Write unit test for `READ_ARTIFACT_FILE` IPC handler (valid path, traversal rejection, missing file, 500KB cap)
- [x] 7.2 Write unit test for `MarkdownRenderer` (renders headings, tables, code blocks; empty string, malformed input)
- [x] 7.3 Write component test for `ArtifactSection` (fetches artifacts, shows list, empty state)
- [x] 7.4 Write component test for `ArtifactViewer` (loads content, renders markdown, file-not-found state)
- [x] 7.5 Write integration test for `DetailsPanel` (renders sections, artifact selection flow)
- [x] 7.6 Verify `bun run typecheck` passes
- [x] 7.7 Verify `bun run check` passes
- [x] 7.8 Verify `bun run test` passes
