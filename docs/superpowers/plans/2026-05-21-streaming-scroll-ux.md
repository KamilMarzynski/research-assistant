# Streaming Scroll UX — Stick-to-Bottom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the jumping `scrollIntoView({ behavior: "smooth" })` with a stick-to-bottom pattern that scrolls instantly when the user is at the bottom, stops scrolling when the user scrolls up, and shows a "Jump to bottom" button to get back.

**Architecture:** All changes are isolated to `MessageList.tsx` and its test file. Add a `containerRef` on the scroll container, an `isAtBottom` ref (for perf — no re-renders on every scroll event), a `showJumpButton` boolean state, three focused effects (scroll listener, streaming scroll, new-message scroll), and a sticky jump button rendered inside the scroll container.

**Tech Stack:** React (hooks), happy-dom (vitest), @testing-library/react, Biome (lint/format)

---

## File Map

| Action | File |
|--------|------|
| Modify | `src/renderer/components/layout/chat/MessageList.tsx` |
| Modify | `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx` |

---

### Task 1: Tests for scroll listener behaviour

**Files:**
- Modify: `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`

- [ ] **Step 1: Add scroll-behaviour tests to the existing test file**

Open `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx` and add a new `describe` block after the existing `"MessageList — segments"` block. The tests fire synthetic scroll events on the scroll container and check button visibility.

```tsx
// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../../../../../shared/types";
import type { StreamSegment } from "../../../../contexts/StreamStateContext";
import MessageList from "../MessageList";

const noMessages: Message[] = [];
const someMessages: Message[] = [
  { id: "m1", projectId: "p1", role: "user", content: "Hi", createdAt: new Date() },
];

// ... existing describe block unchanged ...

describe("MessageList — jump-to-bottom button", () => {
  function getScrollContainer(container: HTMLElement) {
    // The scroll container is the first child of the rendered root with overflowY auto
    return container.firstElementChild as HTMLElement;
  }

  function simulateScrolledUp(el: HTMLElement) {
    // Fake scroll metrics: content taller than viewport, scrolled to top
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
    fireEvent.scroll(el);
  }

  function simulateScrolledToBottom(el: HTMLElement) {
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 600, writable: true, configurable: true });
    // 600 + 400 = 1000 >= 1000 - 50 → at bottom
    fireEvent.scroll(el);
  }

  it("jump button is hidden initially", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button appears when user scrolls up during content", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.getByText("↓ Jump to bottom")).toBeTruthy();
  });

  it("jump button disappears when user scrolls back to bottom", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.getByText("↓ Jump to bottom")).toBeTruthy();
    simulateScrolledToBottom(scrollEl);
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button click scrolls to bottom and hides button", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    screen.getByText("↓ Jump to bottom").click();
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button is not shown when there are no messages", () => {
    const { container } = render(
      <MessageList messages={noMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect new tests to FAIL**

```bash
bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx
```

Expected: existing tests pass, new `jump-to-bottom` tests fail with "unable to find element" or similar — the button doesn't exist yet.

---

### Task 2: Implement stick-to-bottom in MessageList

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`

- [ ] **Step 1: Replace the component with the updated implementation**

Full replacement of `src/renderer/components/layout/chat/MessageList.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { Message } from "../../../../shared/types";
import type { StreamSegment } from "../../../contexts/StreamStateContext";
import ActivityPill from "../../shared/ActivityPill";
import MarkdownRenderer from "../../shared/MarkdownRenderer";

interface MessageListProps {
  messages: Message[];
  streamingSegments: StreamSegment[];
  processing?: boolean;
}

export default function MessageList({ messages, streamingSegments, processing }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  // Track whether user is within 50px of the bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const atBottom =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
      isAtBottom.current = atBottom;
      setShowJumpButton(!atBottom);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Instant scroll on each chunk — only when already at the bottom
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when streaming segments change to auto-scroll
  useEffect(() => {
    if (!isAtBottom.current || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [streamingSegments]);

  // Always jump to bottom when a new message is committed
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when message count changes
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
    isAtBottom.current = true;
    setShowJumpButton(false);
  }, [messages.length]);

  const handleJumpToBottom = () => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
    isAtBottom.current = true;
    setShowJumpButton(false);
  };

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const displayMessages =
    lastUserIndex >= 0
      ? messages.filter((m, i) => {
          if (i <= lastUserIndex) return true;
          if (m.role === "assistant" && m.content.trim() === "") return false;
          if (processing && m.role === "assistant") return false;
          return true;
        })
      : messages;

  const hasRunningTool = streamingSegments.some(
    (s) => s.type === "activity" && s.status === "running",
  );
  const lastSeg = streamingSegments[streamingSegments.length - 1];
  const showThinkingSpinner =
    !!processing &&
    !hasRunningTool &&
    (streamingSegments.length === 0 || lastSeg?.type === "activity");

  const hasContent = messages.length > 0 || streamingSegments.length > 0 || !!processing;

  return (
    <div
      ref={containerRef}
      className="thin-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 24px",
        position: "relative",
      }}
    >
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
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
        {displayMessages.map((msg) => (
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
            {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {msg.toolCalls.map((tc) => (
                  <ActivityPill
                    key={tc.toolCallId}
                    toolCallId={tc.toolCallId}
                    toolName={tc.toolName}
                    description={tc.description}
                    status={tc.status}
                  />
                ))}
              </div>
            )}
            <div
              style={{
                padding: "12px 16px",
                borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
                color: msg.role === "user" ? "var(--ink-on-accent)" : "var(--ink)",
                border: msg.role === "user" ? "none" : "1px solid var(--line)",
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              {msg.role === "user" ? (
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {msg.content}
                </span>
              ) : (
                <MarkdownRenderer content={msg.content} />
              )}
            </div>
          </div>
        ))}

        {streamingSegments.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 640,
            }}
          >
            {streamingSegments.map((seg, i) =>
              seg.type === "text" ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only within a single stream
                  key={i}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  <MarkdownRenderer content={seg.content} />
                  {i === streamingSegments.length - 1 && processing && (
                    <span
                      data-testid="streaming-cursor"
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: "1em",
                        background: "var(--ink)",
                        marginLeft: 4,
                        verticalAlign: "text-bottom",
                        animation: "blink 1s step-end infinite",
                      }}
                    />
                  )}
                </div>
              ) : (
                <ActivityPill
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only within a single stream
                  key={i}
                  toolCallId={seg.toolCallId}
                  toolName={seg.toolName}
                  description={seg.description}
                  status={seg.status}
                />
              ),
            )}
          </div>
        )}

        {showThinkingSpinner && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: 640,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "14px 14px 14px 4px",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span className="dot dot--accent dot--pulse" />
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Thinking...</span>
            </div>
          </div>
        )}

        {/* empty state */}
        {displayMessages.length === 0 && streamingSegments.length === 0 && !processing && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: "85%",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              <p style={{ margin: "0 0 8px", color: "var(--ink-2)" }}>
                Welcome to your new project.
              </p>
              <p style={{ margin: 0, color: "var(--ink-2)" }}>
                Tell me about your project so I can help you best. Useful details:
              </p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
                <li>What is this project about?</li>
                <li>How are files organized?</li>
                <li>Where should research outputs go?</li>
                <li>Any naming conventions or tech stack?</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {showJumpButton && hasContent && (
        <div
          style={{
            position: "sticky",
            bottom: 16,
            display: "flex",
            justifyContent: "flex-end",
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            onClick={handleJumpToBottom}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 20,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink-2)",
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            ↓ Jump to bottom
          </button>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Run tests — all must pass**

```bash
bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx
```

Expected: all tests in both `describe` blocks pass.

- [ ] **Step 3: Run full quality checks**

```bash
bun run typecheck && bun run check
```

Expected: zero errors, zero lint/format issues.

- [ ] **Step 4: Run full test suite**

```bash
bun run test
```

Expected: all tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx \
        src/renderer/components/layout/chat/__tests__/MessageList.test.tsx \
        docs/superpowers/specs/2026-05-21-streaming-scroll-ux-design.md \
        docs/superpowers/plans/2026-05-21-streaming-scroll-ux.md
git commit -m "fix(ui): replace smooth scroll with stick-to-bottom pattern

Stops jumping during streaming by switching from scrollIntoView({ behavior: 'smooth' })
(fired on every chunk) to instant scrollTop assignment (only when already at bottom).
Adds 'Jump to bottom' sticky button when user scrolls up."
```

---

## Self-Review

**Spec coverage:**
- ✅ `containerRef` on scroll container
- ✅ `isAtBottom` ref initialised `true`
- ✅ Scroll listener: `scrollTop + clientHeight >= scrollHeight - 50`
- ✅ Streaming effect: instant scroll only when `isAtBottom`
- ✅ New-message effect: always scroll, reset `isAtBottom`
- ✅ Jump button: sticky, bottom-right, `var(--surface)` + `var(--line)` border
- ✅ Jump button: hidden when no content
- ✅ `position: relative` on container
- ✅ Tests: listener sets flag, button visible/hidden, click scrolls

**Placeholder scan:** None found.

**Type consistency:** `containerRef` is `RefObject<HTMLDivElement>` throughout. `isAtBottom` is `MutableRefObject<boolean>`. `showJumpButton` is `boolean` state. All consistent.
