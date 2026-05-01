## Why

Background research runs silently in the app. If the LLM stream errors, the UI gets stuck with a forever-animating cursor. If a research task fails, there's no error detail and no way to retry. There are no OS notifications when research completes. The app feels unreliable — failures are invisible and unrecoverable.

## What Changes

- **Stream error recovery**: detect stalled LLM streams via timeout, emit `MESSAGE_DONE` with error message so the UI never gets stuck
- **Research error UX**: show error detail in `ResearchStatusBar`, add retry button that re-queues a failed task
- **OS notifications**: fire Electron `Notification` when research completes and window is not focused
- **Sub-agent event bubbling**: thread `EventBus` events into sub-agent progress so tokens appear in `ResearchStatusBar`
- **Tasks in DB**: move task persistence from filesystem JSON to a `tasks` DB table with `status` enum (`pending | in_progress | complete | failed`)

## Capabilities

### New Capabilities
- `stream-recovery`: Timeout and error handling for LLM streaming — never get stuck cursor
- `research-error-ux`: Error display and retry for failed research tasks
- `os-notifications`: Electron Notification API integration for background research completion
- `sub-agent-progress`: Sub-agent status events surfaced in the UI
- `tasks-db`: Move task persistence from filesystem JSON to Drizzle SQLite table

### Modified Capabilities
- *(none — no existing specs change behavior, only new capabilities)*

## Impact

- `src/main/agent/` — task persistence changes from JSON to DB; sub-agent event wiring
- `src/main/ipc-handlers.ts` — new IPC for retry, possibly new channels
- `src/main/index.ts` — Notification API calls on research complete
- `src/renderer/components/layout/ResearchStatusBar.tsx` — error detail + retry button
- `src/renderer/contexts/ChatContext.tsx` — stream timeout handling
- `src/main/db/schema.ts` — new `tasks` table
- `src/shared/ipc-channels.ts` — new channels if needed for retry/notification
