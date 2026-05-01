## 1. Tasks DB Table

- [x] 1.1 Add `tasks` table to `src/main/db/schema.ts` with columns: `id`, `projectId`, `projectName`, `query`, `folderPath`, `status` (enum), `error`, `createdAt`, `updatedAt`
- [x] 1.2 Add `tasks` to Drizzle relations if needed
- [x] 1.3 Generate and run DB migration for the new table
- [x] 1.4 Rewrite `HomeService.saveTask()` to insert into `tasks` table
- [x] 1.5 Rewrite `HomeService.deleteTask()` to delete from `tasks` table
- [x] 1.6 Rewrite `HomeService.getInProgressTasks()` to query `tasks` table
- [x] 1.7 Add migration logic: on startup, read existing JSON tasks from `~/.research-assistant/tasks/`, insert into DB, delete JSON files
- [x] 1.8 Update `ResearchService._runResearch()` to update task status to `failed`/`complete` via DB instead of `HomeService.deleteTask()`

## 2. Stream Recovery

- [x] 2.1 Wrap `session.send()` in `SEND_MESSAGE` handler with 120s timeout timer
- [x] 2.2 Clear timeout on `agent_end` event (subscriber catch block already emits `MESSAGE_DONE`)
- [x] 2.3 On timeout fire: send timeout error message via `MESSAGE_CHUNK` then emit `MESSAGE_DONE`

## 3. Research Error UX

- [ ] 3.1 Add `RETRY_RESEARCH` to `IPC` constants in `src/shared/ipc-channels.ts`
- [ ] 3.2 Add `RETRY_RESEARCH` IPC handler in `src/main/ipc-handlers.ts`: validate payload, call `researchService.startResearch()`
- [ ] 3.3 Update `ResearchStatusBar.tsx`: show error string from `research:failed` event, add retry button, extend dismiss timeout to 30s
- [ ] 3.4 Wire retry button to call `window.electronAPI.invoke(IPC.RETRY_RESEARCH, ...)` with saved parameters
- [ ] 3.5 Ensure `research:failed` event payload includes full error string (already present, verify)

## 4. OS Notifications

- [ ] 4.1 Import `Notification` from `electron` in `src/main/ipc-handlers.ts`
- [ ] 4.2 In `research:complete` event bus handler, add `new Notification({ title, body }).show()` guarded by `!win.isFocused()`
- [ ] 4.3 Add `notification.onclick` handler to focus the BrowserWindow

## 5. Sub-Agent Progress

- [ ] 5.1 Verify sub-agent label propagation through `onProgress` → EventBus → ResearchStatusBar (test with orchestrated research)
- [ ] 5.2 If progress is missing, wire `EventBus` emit into `spawnAgentFn` callback chain

## 6. Tests

- [ ] 6.1 Write unit tests for `HomeService` tasks DB operations (save, delete, getInProgress, migration)
- [ ] 6.2 Write unit test for stream timeout handler (timeout fires, timeout cleared on agent_end, timeout cleared on error)
- [ ] 6.3 Write unit test for `RETRY_RESEARCH` IPC handler (valid payload, re-dispatches research)
- [ ] 6.4 Write component test for `ResearchStatusBar` error display + retry button
- [ ] 6.5 Verify `bun run typecheck` passes
- [ ] 6.6 Verify `bun run check` passes
- [ ] 6.7 Verify `bun run test` passes
