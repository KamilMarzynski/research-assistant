# Claude-Style Title Bar and Centered Chat Design

> **For agentic workers:** Use superpowers:writing-plans to implement this spec.

**Goal:** Make the Electron app window chrome invisible on macOS (floating traffic lights over content) and center the chat conversation column like Claude/ChatGPT do.

**Architecture:** Two independent visual changes. Title bar change is platform-specific Electron config plus CSS padding adjustments. Chat centering is pure CSS layout change in MessageList.

**Tech Stack:** Electron (BrowserWindow options), React inline styles, CSS custom properties.

---

## Task 1: Hidden Title Bar with Floating Traffic Lights

### macOS

**File:** `src/main/index.ts`

Modify `BrowserWindow` constructor options:

- Add `titleBarStyle: "hidden"` — removes the native title bar entirely; traffic lights float over window content.
- Add `trafficLightPosition: { x: 12, y: 12 }` — positions traffic lights 12px from top and left edges.
- Keep existing `width`, `height`, `minWidth`, `minHeight`, `webPreferences`.

**File:** `src/renderer/components/layout/LeftSidebar.tsx`

Adjust sidebar header area so content is not obscured by floating traffic lights:

- Change top logo/header div padding from `padding: "14px 16px"` to `padding: "38px 16px 14px"` — adds 24px top clearance for traffic lights.

### Windows (fallback)

Electron does not support `titleBarStyle: "hidden"` on Windows. Use `titleBarOverlay: { color: "var(--surface)", symbolColor: "var(--ink)", height: 36 }` instead. This keeps a minimal caption bar matching the Scholar surface color. On macOS this option is ignored.

### Linux

Same fallback as Windows — `titleBarOverlay` provides a consistent minimal bar.

---

## Task 2: Centered Chat Conversation Column

**File:** `src/renderer/components/layout/chat/MessageList.tsx`

### Approach

The current `MessageList` renders messages directly in a `flex-direction: column` container with `padding: "20px 24px"`. Messages stretch left-aligned. The fix introduces a centered inner wrapper.

### Changes

1. **Add a centered content wrapper** around all message children inside the scrollable container:
   - Element: `div` inserted between the outer scroll container and the mapped messages
   - Style: `maxWidth: 768`, `width: "100%"`, `margin: "0 auto"`, `display: "flex"`, `flexDirection: "column"`, `gap: 18`

2. **Move message alignment responsibility** from individual message wrappers to the content wrapper:
   - Remove `alignItems: msg.role === "user" ? "flex-end" : "flex-start"` from individual message `div`s
   - Individual message `div`s keep `maxWidth: 640` and their bubble styling (border radius, background)
   - User message alignment is handled by the message bubble container itself: user messages use `marginLeft: "auto"` to push to the right side of the centered column; assistant messages use default left alignment

3. **Apply same pattern** to:
   - `streamingContent` block
   - `processing && !streamingContent` thinking indicator block
   - Empty state welcome message block

### Rationale for 768px max-width

Claude desktop app uses approximately 768px for its content column on typical resolutions. This is narrow enough for comfortable reading (~70 characters per line) while leaving adequate breathing room on wide monitors. It also matches the existing `maxWidth: 640` on individual message bubbles, so the column is wider than any single message, creating natural padding.

---

## Testing

- **macOS:** Verify traffic lights appear at top-left over sidebar, sidebar header text is not obscured, window can be dragged from any edge, resize handles work.
- **Windows/Linux:** Verify minimal title bar appears with surface-colored background.
- **Chat centering:** Verify messages align left (assistant) and right (user) within a centered 768px column. Verify on window resize from 900px to 2560px width. Verify empty state and streaming content also centered.
- **No regressions:** Settings modal, dialogs, context menus still render correctly over the hidden-title-bar window.

---

## Spec Self-Review

1. **Spec coverage:** Both tasks covered — title bar config + sidebar padding, chat centering with all content blocks.
2. **Placeholder scan:** No TBD/TODO/fill-in-details found.
3. **Type consistency:** Inline styles use number literals for pixels and string literals for CSS values consistently.
4. **Scope check:** Two independent visual changes. No decomposition needed.
