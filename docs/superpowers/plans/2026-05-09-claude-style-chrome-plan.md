# Claude-Style Title Bar + Centered Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Electron app window chrome invisible on macOS and center the chat conversation column.

**Architecture:** Two independent tasks: (1) Electron BrowserWindow config change + sidebar padding bump; (2) MessageList CSS layout change to center a max-width content column.

**Tech Stack:** Electron (BrowserWindow), React inline styles, CSS custom properties.

---

### Task 1: Hidden Title Bar

**Files:**
- Modify: `src/main/index.ts:7-18`
- Modify: `src/renderer/components/layout/LeftSidebar.tsx:124-138`

- [ ] **Step 1: Add titleBarStyle and trafficLightPosition to BrowserWindow**

In `src/main/index.ts`, modify the `BrowserWindow` constructor options:

```typescript
const win = new BrowserWindow({
  width: 1280,
  height: 800,
  minWidth: 900,
  minHeight: 600,
  titleBarStyle: "hidden",
  trafficLightPosition: { x: 12, y: 12 },
  titleBarOverlay: { color: "#00000000", height: 36 },
  webPreferences: {
    preload: join(import.meta.dirname, "../preload/index.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

- `titleBarStyle: "hidden"` removes the native macOS title bar; traffic lights float over content.
- `trafficLightPosition: { x: 12, y: 12 }` positions traffic lights 12px from top-left edges.
- `titleBarOverlay` is a no-op on macOS but provides a minimal fallback on Windows/Linux.

- [ ] **Step 2: Bump sidebar header padding to clear traffic lights**

In `src/renderer/components/layout/LeftSidebar.tsx`, change the logo/header div padding:

```tsx
<div
  style={{
    padding: "38px 16px 14px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    borderBottom: "1px solid var(--line)",
  }}
>
```

Change `padding: "14px 16px"` to `padding: "38px 16px 14px"` — adds 24px top clearance so traffic lights don't overlap the "Research Assistant" header text.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/renderer/components/layout/LeftSidebar.tsx
git commit -m "feat: hidden title bar with floating traffic lights (macOS)"
```

---

### Task 2: Centered Chat Column

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageList.tsx:19-167`

- [ ] **Step 1: Wrap messages in a centered content column**

In `src/renderer/components/layout/chat/MessageList.tsx`, replace the outer scroll container's direct children with a centered inner wrapper.

**Before (outer container):**
```tsx
<div
  className="thin-scroll"
  style={{
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  }}
>
  <style>{`...`}</style>
  {messages.map((msg) => (
    <div key={msg.id} style={{ ... }} >...  // direct child
  ))}
```

**After:**

Keep the outer `div` but remove `gap: 18` (it moves to the inner wrapper). Insert an inner centered `div` with `maxWidth: 768`.

Change outer container style to:
```tsx
style={{
  flex: 1,
  overflowY: "auto",
  padding: "20px 24px",
}}
```

Add inner wrapper after the `<style>` block:
```tsx
<div
  style={{
    maxWidth: 768,
    width: "100%",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  }}
>
```

Close this inner wrapper before the `bottomRef` div:
```tsx
</div>  {/* close centered column */}
<div ref={bottomRef} />
</div>  {/* close outer scroll container */}
```

- [ ] **Step 2: Move user message alignment to right-side margin**

Each message wrapper currently uses `alignItems: "flex-end"` (user) or `"flex-start"` (assistant). Since the column is centered, change alignment to a margin-based approach:

For **user** messages, add `marginLeft: "auto"` to the message wrapper:
```tsx
<div
  key={msg.id}
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: 640,
    marginLeft: msg.role === "user" ? "auto" : undefined,
  }}
>
```

Remove the `alignItems` property entirely from this wrapper — the column is flex-start by default, and `marginLeft: "auto"` pushes user messages to the right.

Apply the same change to:
- `streamingContent` block (assistant — keep default left)
- `processing && !streamingContent` block (assistant — keep default left)
- Empty state welcome block (assistant — keep default left)

For the empty state, the wrapper is currently:
```tsx
style={{
  display: "flex",
  flexDirection: "column",
  gap: 4,
  alignItems: "flex-start",
  maxWidth: "85%",
}}
```

Remove `alignItems: "flex-start"` since the column is already flex-start.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run tests**

```bash
bun run test
```

Expected: all 568 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx
git commit -m "feat: centered chat column with max-width 768px"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| macOS hidden title bar with floating traffic lights | Task 1 |
| Windows/Linux fallback via titleBarOverlay | Task 1 |
| Sidebar header padding bumped for traffic light clearance | Task 1 |
| Chat column centered at max-width 768px | Task 2 |
| User messages aligned right via marginLeft: auto | Task 2 |
| Assistant/empty/streaming content aligned left | Task 2 |

## Placeholder Scan

No TBD, TODO, or vague steps. Every step contains exact file paths, exact code, exact commands.

## Type Consistency

- `maxWidth: 768` and `maxWidth: 640` are both `number` (px) — consistent.
- `marginLeft: "auto"` and `marginLeft: undefined` — consistent conditional pattern.
- No new types or interfaces introduced.
