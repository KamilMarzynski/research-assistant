## Why

Right panel is two empty placeholder boxes. Research artifacts save to DB + filesystem but remain invisible in the app. Chat renders all messages (including structured research output) as plain text. App feels unfinished — core value prop (research results visible and browseable) is broken.

## What Changes

- Merge `RightSidebar` + `ArtifactPanel` into single `DetailsPanel` with collapsible sections
- Add artifact list that fetches + displays artifacts per active project
- Add artifact content viewer that reads file from disk and renders inline
- Add shared `MarkdownRenderer` component for artifact viewer + chat messages
- Add `READ_ARTIFACT_FILE` IPC channel (renderer requests file content, main reads from disk with path validation)
- Add `react-markdown` + `remark-gfm` dependencies
- Upgrade `MessageList` to render assistant messages as markdown

## Capabilities

### New Capabilities
- `artifact-viewer`: Browse artifacts by project, view artifact content rendered as markdown inline in the right panel
- `markdown-rendering`: Shared markdown rendering across chat messages and artifact content, with support for headings, tables, code blocks, lists, and links

### Modified Capabilities

None.

## Impact

- `src/shared/ipc-channels.ts` — new `READ_ARTIFACT_FILE` channel
- `src/main/ipc-handlers.ts` — new handler for reading artifact file from disk
- `src/renderer/components/layout/RightSidebar.tsx` — rewrite to `DetailsPanel`
- `src/renderer/components/layout/artifacts/ArtifactPanel.tsx` — delete (merged)
- `src/renderer/components/layout/AppShell.tsx` — swap components
- `src/renderer/components/layout/chat/MessageList.tsx` — use MarkdownRenderer for assistant messages
- New: shared `MarkdownRenderer`, `ArtifactSection`, `ArtifactViewer` components
- `package.json` — new deps: `react-markdown`, `remark-gfm`
