# Streaming Scroll UX — Stick-to-Bottom

**Date:** 2026-05-21  
**Status:** Approved  
**Scope:** `src/renderer/components/layout/chat/MessageList.tsx` only

---

## Problem

`scrollIntoView({ behavior: "smooth" })` fires on every streaming chunk (every `streamingSegments` change). Competing smooth-scroll animations fight each other and produce visible "jumping" as the message grows.

---

## Solution: Stick-to-Bottom with Instant Scroll

Industry-standard pattern used by Discord, Slack, ChatGPT, Claude.ai.

### State & Refs

| Ref | Type | Purpose |
|-----|------|---------|
| `containerRef` | `RefObject<HTMLDivElement>` | Attached to the scroll container `<div>` |
| `isAtBottom` | `MutableRefObject<boolean>` | Tracks whether user is within 50px of the bottom. Ref (not state) — avoids extra re-renders. Initialised `true`. |
| `bottomRef` | `RefObject<HTMLDivElement>` | Existing sentinel `<div>` at end of list — kept as scroll target |

### Scroll Logic

Three effects replace the current single effect:

**1. Scroll listener (mount/unmount)**  
Attaches to `containerRef`. On each scroll event:
```
isAtBottom.current = scrollTop + clientHeight >= scrollHeight - 50
```
Detaches on unmount via cleanup function.

**2. Streaming effect** — `[streamingSegments]`  
Replaces the jumping `smooth` call. Only fires when `isAtBottom.current === true`:
```
container.scrollTop = container.scrollHeight  // instant, no animation
```
When user has scrolled up, this effect is a no-op — user intent respected.

**3. New-message effect** — `[messages.length]`  
Fires once per committed message (user sent / assistant response finalised). Always scrolls to bottom instantly. Sets `isAtBottom.current = true` so subsequent streaming auto-scrolls resume.

### Jump-to-Bottom Button

Shown when `!isAtBottom` state is true AND the chat has content.

- Position: `absolute`, `bottom: 16px`, `right: 16px` inside the scroll container (`position: relative`)
- Style: `var(--surface)` background, `1px solid var(--line)` border, rounded pill, `var(--ink-2)` text — matches design system, no MUI
- Content: `↓` chevron + label "Jump to bottom"
- On click: `container.scrollTop = container.scrollHeight`, `isAtBottom.current = true`, force re-render to hide button

> Note: `isAtBottom` is a ref for scroll performance but the button visibility needs React state. Use a separate `showJumpButton` boolean state that is set inside the scroll listener and the jump-click handler.

### Container Change

The outer scroll `<div>` needs:
```
position: "relative"   // anchors the absolute jump button
```
(Currently has `flex: 1, overflowY: "auto", padding: "20px 24px"` — add `position: "relative"` alongside.)

---

## What Does NOT Change

- `MessageList` props interface — unchanged
- `StreamStateContext` — unchanged  
- IPC layer — unchanged
- All other components — unchanged
- No new files

---

## Testing

- Existing tests for `MessageList` must still pass
- Add unit tests:
  - Scroll listener sets `isAtBottom` correctly at/near/above bottom
  - Jump button hidden when at bottom, visible when scrolled up
  - Clicking jump button scrolls to bottom and hides button
  - Streaming effect does not scroll when `isAtBottom` is false
