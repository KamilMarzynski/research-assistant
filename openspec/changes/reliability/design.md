## Context

Research runs as background agents. When an LLM stream errors, no `MESSAGE_DONE` fires — the UI gets stuck with a forever-animating cursor. Failed research sets `doneMessage: "Research failed."` for 3 seconds, then vanishes — no detail, no retry. There are zero OS notifications when background research completes. Task persistence uses filesystem JSON (`~/.research-assistant/tasks/*.json`), loaded at startup for auto-resume.

## Goals / Non-Goals

**Goals:**

- LLM stream never leaves the UI stuck — timeout emits `MESSAGE_DONE` with error
- Failed research tasks show error detail + retry button in `ResearchStatusBar`
- Background research complete fires OS notification (when window unfocused)
- Task persistence moves from JSON files to Drizzle `tasks` SQLite table
- Migrate existing in-progress JSON tasks on first load

**Non-Goals:**

- In-app notification center or notification history
- Persistent error log (audit log already exists for blocked commands)
- Stream retry/auto-reconnect (manual retry only)

## Decisions

1. **Stream timeout in ipc-handlers.ts SEND_MESSAGE**: Wrap the `session.send()` call. Start a 60-second `setTimeout` after `send()` resolves. Clear on `agent_end`. If timeout fires, `webContents.send(MESSAGE_DONE)` with error content. Rationale: the Pi Agent fires `agent_end` on completion or error — no timeout means any case where `agent_end` never fires leaves the UI hung.

2. **Retry via new `RETRY_RESEARCH` IPC channel**: renderer sends `{ taskId, query, projectId, projectName, folderPath }`, handler re-calls `researchService.startResearch()`. Rationale: reuses existing dispatch, no new service method needed.

3. **OS Notification in EventBus handler**: In `registerIpcHandlers`, the `research:complete` event handler already exists. Add `new Notification({ title, body }).show()` guarded by `!win.isFocused()`. Import `Notification` from `electron`. Rationale: single check, minimal code, uses platform-native API.

4. **Tasks DB table with Drizzle**: New `tasks` table in `schema.ts` with columns: `id`, `projectId`, `projectName`, `query`, `folderPath`, `status` (`pending | in_progress | complete | failed`), `error`, `createdAt`, `updatedAt`. `HomeService.saveTask`/`deleteTask`/`getInProgressTasks` rewritten to use DB. Migration: on startup, read existing JSON files, insert into DB, delete JSON files.

5. **ResearchStatusBar error+retry**: Add `error` field to `research:failed` event payload (already has `error` string). Show error text + retry button in the bar. Retry button calls `window.electronAPI.invoke(IPC.RETRY_RESEARCH, ...)`.

## Risks / Trade-offs

- **Timeout too short (60s)**: some legitimate multi-turn agent interactions may exceed 60s. Mitigation: use 120s timeout, monitor for false positives.
- **Retry creates duplicate artifacts**: if the original research partially completed and wrote output, retry creates another file. Mitigation: retry uses a new taskId, research worker writes to a new workspace directory.
- **DB migration**: existing users with in-progress tasks get migrated silently on startup. If migration fails, tasks are lost. Mitigation: migration runs in a try-catch, logs errors, does not block app startup.
