# Streaming Tool Activity Display

**Date:** 2026-05-13
**Status:** Approved

## Problem

When the agent calls a tool mid-response, the text before and after the tool call concatenates in the streaming bubble with no visual break. Tool calls are invisible to the user. The experience is a single unbroken blinking cursor that suddenly produces text with no explanation of what happened in between.

## Goal

Make the streaming experience smooth and transparent:
- Each LLM text chunk is visually separated
- Tool calls appear as persistent activity pills in the conversation
- "Thinking" state is visible between turns
- Messages stored in DB are unchanged

## Design

### 1. `_description` Tool Argument

Every tool gets an optional `_description?: string` parameter. A shared `withDescription(schema)` helper in `src/main/agent/tools.ts` merges this into any TypeBox schema at build time.

The system prompt gets one added instruction:

> Always fill `_description` with a short, user-facing sentence describing what you are doing — e.g. "Searching for papers on prompt caching" or "Writing summary to research/output.md".

`_description` is stripped from args in `beforeToolCall` in `MessagePipeline.ts` before the tool executes. Individual tools never see it. It is extracted there and stored temporarily on `SessionState.pendingToolDescriptions: Map<string, string>` keyed by `toolCallId`, then read by `handleStreamChunk` when `tool_execution_start` fires and deleted from the map. If the LLM omits `_description`, the tool's `label` field is used as fallback.

### 2. Event & IPC Layer

`handleStreamChunk.ts` is extended to handle two new Pi event types:

| Pi event | Action |
|---|---|
| `tool_execution_start` | emit `agent:tool_start` on event bus with `{ toolCallId, toolName, description }` |
| `tool_execution_end` | emit `agent:tool_end` with `{ toolCallId, toolName, isError }` |

Two new IPC channels:

```ts
TOOL_START: "TOOL_START"   // main → renderer
TOOL_END:   "TOOL_END"     // main → renderer
```

`event-forwarders.ts` listens to both bus events and forwards them. Preload exposes both channels via `window.electronAPI.on(...)`.

`MESSAGE_CHUNK` and `MESSAGE_DONE` are unchanged.

### 3. Streaming Segment Model

`streamingContent: string | null` in `ChatPanel` is replaced with `streamingSegments: StreamSegment[]`:

```typescript
type StreamSegment =
  | { type: "text"; content: string }
  | { type: "activity"; toolCallId: string; toolName: string; description: string; status: "running" | "done" | "error" }
```

Event handlers in `ChatPanel`:

| Event | Action |
|---|---|
| `MESSAGE_CHUNK` | Append delta to last `text` segment, or push new `text` segment if last is `activity` |
| `TOOL_START` | Push new `activity` segment with `status: "running"` |
| `TOOL_END` | Find segment by `toolCallId`, update `status` to `"done"` or `"error"` |
| `MESSAGE_DONE` | Clear `streamingSegments` (DB message takes over) |

**Thinking state** is implicit: when `processing` is true and no segment has `status: "running"`, render the transient thinking spinner after the last segment. No new segment type needed — the existing `processing` prop covers it.

Completed activity segments stay in the list as a persistent record of what the agent did.

### 4. `ActivityPill` Component

New component at `src/renderer/components/shared/ActivityPill.tsx`.

Visual:
- Background: `var(--surface)`
- Border: `1px solid var(--line)`, upgrades to `1px solid var(--accent)` when `status === "running"`
- Border-radius: `10px`
- Padding: `6px 10px`
- Gap: `6px` between icon and text

Icon (14px):
| Status | Icon | Color |
|---|---|---|
| `running` | MUI `CircularProgress` size=14 | `var(--accent)` |
| `done` | MUI `Check` | `var(--ink-2)` |
| `error` | MUI `Close` | MUI `error` palette (`color="error"`) |

Text: 12.5px, `var(--ink-2)`, single line, truncated with ellipsis, `max-width: 480px`.

### 5. Renderer Changes

`MessageList` receives `streamingSegments: StreamSegment[]` (replaces `streamingContent: string | null`). The `processing` prop is unchanged.

Streaming slot renders:
1. `text` segments → `MarkdownRenderer`
2. `activity` segments → `ActivityPill`
3. Transient spinner → shown when `processing && !segments.some(s => s.type === "activity" && s.status === "running")`

Historical messages (from DB) render exactly as today via `msg.content` + `MarkdownRenderer`. No change.

## What Does Not Change

- DB `messages` table — text-only, no tool call storage
- Pi conversation context / agent history
- `MESSAGE_CHUNK` / `MESSAGE_DONE` IPC flow
- All existing tool implementations
- Langfuse observability

## File Inventory

| File | Change |
|---|---|
| `src/main/agent/tools.ts` | Add `withDescription()` helper, apply to all tool schemas |
| `src/main/agent/MessagePipeline.ts` | Strip `_description` in `beforeToolCall`, stash on state |
| `src/main/agent/handlers/stream-chunk.ts` | Handle `tool_execution_start` / `tool_execution_end` |
| `src/main/agent/handlers/types.ts` | Add `pendingToolDescriptions: Map<string, string>` to `SessionState` |
| `src/main/event-bus.ts` | Add `agent:tool_start`, `agent:tool_end` event types |
| `src/main/ipc/event-forwarders.ts` | Forward new bus events to renderer |
| `src/shared/ipc-channels.ts` | Add `TOOL_START`, `TOOL_END` |
| `src/shared/ipc-types.ts` | Add payload types for both channels |
| `src/preload/index.ts` | Expose `TOOL_START`, `TOOL_END` listeners |
| `src/renderer/components/shared/ActivityPill.tsx` | New component |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Replace `streamingContent` with `streamingSegments` |
| `src/renderer/components/layout/chat/MessageList.tsx` | Render segments + transient spinner |
| `src/main/agent/context.ts` | Add `_description` instruction to system prompt |
