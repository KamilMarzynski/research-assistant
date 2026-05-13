# Stuck Stream Recovery + Stop Button

## Problem

When the agent stream never completes (`agent_end` never fires) the renderer stays in `processing` state forever. The input stays locked, the thinking indicator runs indefinitely, and an empty assistant placeholder message remains in the DB.

We also need a way for the user to interrupt a running stream at any time.

## Goals

1. Detect stuck streams and auto-clear UI state after a timeout.
2. Provide a stop button to interrupt an active stream immediately.
3. Clean up the DB placeholder when the stream is aborted or times out.
4. Keep all changes scoped to the existing IPC/streaming architecture.

## Architecture

### Renderer: `StreamStateContext`

- Add a `setTimeout` per project when `processing` becomes `true`. Reset the timer on every `MESSAGE_CHUNK`. Clear the timer on `MESSAGE_DONE`.
- If the timer fires, set `processing: false` and `streamingContent: null` locally. Emit no IPC event — the main process is assumed dead.
- Timer duration: **300 s** (matching the backend stream timeout).

### Renderer: `MessageInput`

- When `processing` is true, show a stop square icon instead of the send arrow.
- Clicking it invokes `IPC.ABORT_MESSAGE` with the active `projectId`.

### Main: `chat-handlers.ts`

- Register a new `ABORT_MESSAGE` handler. It looks up the session and calls `session.abort()`.

### Main: `AgentSession` / `MessagePipeline`

- `AgentSession` already has `abort()` which delegates to `this.pipeline.agent.abort()`. Extend this to also handle DB cleanup.
- Add a new `MessagePipeline.abort()` method:
  1. Call `this.agent.abort()` to stop the stream.
  2. Emit `agent:done` via the eventBus.
  3. If `assistantContent === ""` and `streamingMessageId` is set, delete the placeholder message from the DB.
  4. If `assistantContent !== ""` and `streamingMessageId` is set, update the placeholder with the partial content.
  5. Reset `streamingMessageId`, `assistantContent`, and `processing`.

### Main: Repository & Service

- Add `deleteMessage(id: string): Promise<void>` to `IMessageRepository` and `DrizzleMessageRepository`.
- Expose `deleteMessage` on `MessageService`.

## Data Flow

| Event | Action |
|---|---|
| User sends message | `startStream()` starts 300 s timer, sets `processing: true`. |
| `MESSAGE_CHUNK` arrives | `StreamStateContext` appends delta and resets timer. |
| `MESSAGE_DONE` arrives | `StreamStateContext` clears timer, sets `processing: false`. |
| 300 s pass with no chunk | Timer fires: `processing: false`, `streamingContent: null`. |
| User clicks stop | `ABORT_MESSAGE` IPC → `session.abort()` → cleanup → `agent:done` → `MESSAGE_DONE` arrives → normal clear. |
| `agent.prompt()` throws | `MessagePipeline.send()` catch cleans up placeholder, emits `agent:done`, then re-throws. `chat-handlers.ts` outer catch sends `MESSAGE_DONE`. |

## Edge Cases

- **Abort during thinking (0 chunks):** `assistantContent === ""`. Delete placeholder. Thread shows only the user message.
- **Abort mid-stream:** `assistantContent !== ""`. Update placeholder with partial content.
- **Timeout vs abort race:** If `processing` is already `false`, the abort handler returns silently.
- **Multiple projects:** Timer is per-project. Aborting project A does not affect project B.
- **Follow-up turns:** `abort()` works identically for `queueFollowUp`.

## Testing

- `session.test.ts`:
  - abort during thinking deletes placeholder.
  - abort after chunks finalizes partial content.
- `StreamStateContext` test:
  - timer starts on `startStream`, resets on chunk, fires after 300 s and sets `processing: false`.
- `DrizzleMessageRepository.test.ts`: add test for `deleteMessage`.
- `MessageService.test.ts`: add test for `deleteMessage` delegation.
- `StreamStateContext`: add unit test for timer start, reset, and fire.
- `MessageList`: verify partial DB message is visible after timeout, empty placeholder is removed after abort.
