# Streaming Tool Activity Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single opaque streaming bubble with turn-segmented rendering that shows live tool activity pills so users can see what the agent is doing as it happens.

**Architecture:** Pi `tool_execution_start`/`end` events are intercepted in `handleStreamChunk`, forwarded via two new IPC channels (`TOOL_START`/`TOOL_END`) to the renderer, and displayed as `ActivityPill` chips inline between text segments. A `withDescription` wrapper adds an optional `_description` arg to every tool schema; the LLM fills it; the wrapper strips it before execution. The DB message schema is untouched.

**Tech Stack:** TypeBox (`@sinclair/typebox`), MUI v9 (`@mui/material`, `@mui/icons-material`), React 19, Electron IPC, Vitest + `@testing-library/react`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/agent/handlers/types.ts` | Modify | Add `pendingToolDescriptions: Map<string, string>` to `SessionState` |
| `src/main/event-bus.ts` | Modify | Add `agent:tool_start`, `agent:tool_end` event types |
| `src/shared/ipc-channels.ts` | Modify | Add `TOOL_START`, `TOOL_END` push channels |
| `src/shared/ipc-types.ts` | Modify | Add `ToolStartPayload`, `ToolEndPayload` |
| `src/shared/ipc-guards.ts` | Modify | Add `decodeToolStart`, `decodeToolEnd` |
| `src/main/agent/tools.ts` | Modify | Add `withDescription()` helper, apply to all tools |
| `src/main/agent/context.ts` | Modify | Add `_description` instruction to system prompt |
| `src/main/agent/MessagePipeline.ts` | Modify | Stash `_description` in `beforeToolCall` |
| `src/main/agent/handlers/stream-chunk.ts` | Modify | Handle `tool_execution_start`, `tool_execution_end` |
| `src/main/agent/handlers/stream-chunk.test.ts` | Create | Unit tests for tool event handling |
| `src/main/ipc/event-forwarders.ts` | Modify | Forward `agent:tool_start`, `agent:tool_end` to renderer |
| `src/renderer/components/shared/ActivityPill.tsx` | Create | Chip component for running/done/error states |
| `src/renderer/components/shared/__tests__/ActivityPill.test.tsx` | Create | Component tests |
| `src/renderer/contexts/StreamStateContext.tsx` | Modify | Replace `streamingContent` with `streamingSegments`, handle TOOL_START/TOOL_END |
| `src/renderer/components/layout/chat/MessageList.tsx` | Modify | Render `StreamSegment[]` instead of flat string |
| `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx` | Create | Segment rendering tests |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Modify | Pass `streamingSegments` to `MessageList` |

---

## Task 1: Foundation types

**Files:**
- Modify: `src/main/agent/handlers/types.ts`
- Modify: `src/main/event-bus.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/shared/ipc-guards.ts`

- [ ] **Step 1: Add `pendingToolDescriptions` to `SessionState`**

In `src/main/agent/handlers/types.ts`, add one field to the interface (after `streamChunkCount`):

```typescript
export interface SessionState {
  assistantContent: string;
  lastUserContent: string;
  currentTurnId: number;
  savedForTurn: number;
  processing: boolean;
  pendingFollowUp: string | null;
  pendingSkillDeltas: Array<{ skillName: string; summary: string }>;
  skillRouterReady: boolean;
  activeTurnSpan: ObservationSpan | null;
  activeGenerationSpan: ObservationSpan | null;
  activeToolSpan: ObservationSpan | null;
  sessionId: string;
  turnTraceId: string | null;
  turnSpanId: string | null;
  streamingMessageId: string | null;
  streamChunkCount: number;
  pendingToolDescriptions: Map<string, string>;
}
```

- [ ] **Step 2: Initialize the map in `session.ts`**

In `src/main/agent/session.ts`, the `state` object is constructed in the `AgentSession` constructor. Add the field:

```typescript
const state = {
  assistantContent: "",
  lastUserContent: "",
  currentTurnId: 0,
  savedForTurn: 0,
  processing: false,
  pendingFollowUp: null as string | null,
  pendingSkillDeltas: [] as Array<{ skillName: string; summary: string }>,
  skillRouterReady: false,
  activeTurnSpan: null as import("../services/ObservabilityService").ObservationSpan | null,
  activeGenerationSpan: null as
    | import("../services/ObservabilityService").ObservationSpan
    | null,
  activeToolSpan: null as import("../services/ObservabilityService").ObservationSpan | null,
  sessionId: randomUUID(),
  turnTraceId: null as string | null,
  turnSpanId: null as string | null,
  streamingMessageId: null,
  streamChunkCount: 0,
  pendingToolDescriptions: new Map<string, string>(),
};
```

- [ ] **Step 3: Add bus events to `event-bus.ts`**

Add two new event types to the `AppEvent` union in `src/main/event-bus.ts`:

```typescript
| { type: "agent:tool_start"; payload: { projectId: string; toolCallId: string; toolName: string; description: string } }
| { type: "agent:tool_end"; payload: { projectId: string; toolCallId: string; toolName: string; isError: boolean } }
```

Place them after the existing `agent:chunk` and `agent:done` entries.

- [ ] **Step 4: Add IPC channels**

In `src/shared/ipc-channels.ts`, add to the `IPC` const object under the `// main → renderer` section:

```typescript
TOOL_START: "TOOL_START",
TOOL_END: "TOOL_END",
```

- [ ] **Step 5: Add payload types to `ipc-types.ts`**

Append to `src/shared/ipc-types.ts`:

```typescript
/** Payload for TOOL_START push event */
export interface ToolStartPayload {
  projectId: string;
  toolCallId: string;
  toolName: string;
  description: string;
}

/** Payload for TOOL_END push event */
export interface ToolEndPayload {
  projectId: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
}
```

- [ ] **Step 6: Add decode functions to `ipc-guards.ts`**

Append to `src/shared/ipc-guards.ts`:

```typescript
export function decodeToolStart(data: unknown): ToolStartPayload | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "projectId" in data &&
    "toolCallId" in data &&
    "toolName" in data &&
    "description" in data
  ) {
    const d = data as Record<string, unknown>;
    if (
      typeof d.projectId === "string" &&
      typeof d.toolCallId === "string" &&
      typeof d.toolName === "string" &&
      typeof d.description === "string"
    ) {
      return {
        projectId: d.projectId,
        toolCallId: d.toolCallId,
        toolName: d.toolName,
        description: d.description,
      };
    }
  }
  console.warn("[ipc-guard] Invalid TOOL_START payload");
  return null;
}

export function decodeToolEnd(data: unknown): ToolEndPayload | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "projectId" in data &&
    "toolCallId" in data &&
    "toolName" in data &&
    "isError" in data
  ) {
    const d = data as Record<string, unknown>;
    if (
      typeof d.projectId === "string" &&
      typeof d.toolCallId === "string" &&
      typeof d.toolName === "string" &&
      typeof d.isError === "boolean"
    ) {
      return {
        projectId: d.projectId,
        toolCallId: d.toolCallId,
        toolName: d.toolName,
        isError: d.isError,
      };
    }
  }
  console.warn("[ipc-guard] Invalid TOOL_END payload");
  return null;
}
```

Also add the import at the top of the file:

```typescript
import type {
  BlockedCommandPayload,
  PathApprovalPayload,
  PendingTool,
  ResearchCompletePayload,
  ResearchStatusUpdatePayload,
  ToolEndPayload,
  ToolStartPayload,
} from "./ipc-types";
```

- [ ] **Step 7: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/handlers/types.ts src/main/agent/session.ts src/main/event-bus.ts src/shared/ipc-channels.ts src/shared/ipc-types.ts src/shared/ipc-guards.ts
git commit -m "feat: add tool activity types, IPC channels, and bus events"
```

---

## Task 2: `withDescription` tool wrapper + system prompt

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/context.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/agent/tools.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { withDescription } from "./tools";

describe("withDescription", () => {
  it("adds optional _description to tool parameters", () => {
    const tool = {
      name: "test_tool",
      label: "Test tool",
      description: "Does a thing",
      parameters: Type.Object({ query: Type.String() }),
      execute: async () => ({ content: [], details: {} }),
    };
    const wrapped = withDescription(tool);
    expect(wrapped.parameters.properties).toHaveProperty("_description");
    expect(wrapped.parameters.properties._description[Symbol.for("typebox:optional")]).toBeTruthy();
  });

  it("strips _description before calling original execute", async () => {
    const received: unknown[] = [];
    const tool = {
      name: "test_tool",
      label: "Test tool",
      description: "Does a thing",
      parameters: Type.Object({ query: Type.String() }),
      execute: async (_id: string, params: unknown) => {
        received.push(params);
        return { content: [], details: {} };
      },
    };
    const wrapped = withDescription(tool);
    await wrapped.execute("id-1", { query: "hello", _description: "Testing" });
    expect(received[0]).toEqual({ query: "hello" });
    expect(received[0]).not.toHaveProperty("_description");
  });

  it("preserves tool name and label", () => {
    const tool = {
      name: "my_tool",
      label: "My tool",
      description: "desc",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: {} }),
    };
    const wrapped = withDescription(tool);
    expect(wrapped.name).toBe("my_tool");
    expect(wrapped.label).toBe("My tool");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: FAIL — `withDescription is not exported`

- [ ] **Step 3: Add `withDescription` to `tools.ts`**

Add these imports at the top of `src/main/agent/tools.ts`:

```typescript
import { Type, type TObject } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
```

Add the helper function before `createAgentTools`:

```typescript
export function withDescription(tool: AgentTool): AgentTool {
  const base = tool.parameters as TObject;
  // biome-ignore lint/suspicious/noExplicitAny: wrapping heterogeneous tools
  const originalExecute = tool.execute.bind(tool) as (...args: any[]) => any;
  return {
    ...tool,
    parameters: Type.Object({
      ...base.properties,
      _description: Type.Optional(
        Type.String({
          description:
            "Short user-facing sentence describing what you are doing — e.g. 'Searching for papers on prompt caching' or 'Writing summary to research/output.md'",
        }),
      ),
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { _description: _desc, ...rest } = params as Record<string, unknown>;
      return originalExecute(toolCallId, rest, signal, onUpdate);
    },
  };
}
```

At the end of `createAgentTools`, change the two return paths to apply `withDescription`:

```typescript
  if (opts.toolNames) {
    const allowed = new Set<AgentToolName>(opts.toolNames);
    return tools.filter((t) => allowed.has(t.name as AgentToolName)).map(withDescription);
  }
  return tools.map(withDescription);
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: 3 passing

- [ ] **Step 5: Add `_description` instruction to system prompt**

In `src/main/agent/context.ts`, the `buildSystemContext` function assembles a parts array. Add after the `<!-- Project Directories -->` section (after the `assistantDir` lines):

```typescript
  parts.push(
    "<!-- Tool Usage — Always fill the _description argument -->",
    "When calling any tool, always provide `_description` with a short, user-facing sentence describing what you are doing — e.g. \"Searching for papers on prompt caching\" or \"Writing summary to research/output.md\". This is shown to the user in real time.",
  );
```

- [ ] **Step 6: Typecheck + tests**

```bash
bun run typecheck && bun run test src/main/agent/tools.test.ts
```

Expected: zero type errors, 3 passing tests.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts src/main/agent/context.ts
git commit -m "feat: add withDescription tool wrapper and system prompt instruction"
```

---

## Task 3: Stash `_description` in `beforeToolCall`

**Files:**
- Modify: `src/main/agent/MessagePipeline.ts`

- [ ] **Step 1: Locate `beforeToolCall` in `MessagePipeline.ts`**

Find the `beforeToolCall` hook around line 270. It currently reads:

```typescript
beforeToolCall: async (ctx) => {
  const allowed = new Set(tools.map((t) => t.name));
  if (!allowed.has(ctx.toolCall.name)) {
    return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
  }
  return undefined;
},
```

- [ ] **Step 2: Add stash logic**

Replace the `beforeToolCall` body with:

```typescript
beforeToolCall: async (ctx) => {
  const allowed = new Set(tools.map((t) => t.name));
  if (!allowed.has(ctx.toolCall.name)) {
    return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
  }
  const args = ctx.args as Record<string, unknown>;
  const tool = tools.find((t) => t.name === ctx.toolCall.name);
  const description =
    typeof args._description === "string" && args._description.trim()
      ? args._description.trim()
      : (tool?.label ?? ctx.toolCall.name);
  this.state.pendingToolDescriptions.set(ctx.toolCall.toolCallId, description);
  return undefined;
},
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run full test suite**

```bash
bun run test
```

Expected: all passing (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/MessagePipeline.ts
git commit -m "feat: stash tool _description in beforeToolCall for streaming UI"
```

---

## Task 4: Handle tool events in `handleStreamChunk`

**Files:**
- Modify: `src/main/agent/handlers/stream-chunk.ts`
- Create: `src/main/agent/handlers/stream-chunk.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/handlers/stream-chunk.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleStreamChunk } from "./stream-chunk";
import type { HandlerContext } from "./types";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectId: "proj-1",
    eventBus: { emit: vi.fn(), on: vi.fn() } as unknown as HandlerContext["eventBus"],
    messageService: { updateMessage: vi.fn() } as unknown as HandlerContext["messageService"],
    memoryManager: {} as HandlerContext["memoryManager"],
    state: {
      assistantContent: "",
      lastUserContent: "",
      currentTurnId: 0,
      savedForTurn: 0,
      processing: false,
      pendingFollowUp: null,
      pendingSkillDeltas: [],
      skillRouterReady: false,
      activeTurnSpan: null,
      activeGenerationSpan: null,
      activeToolSpan: null,
      sessionId: "sess-1",
      turnTraceId: null,
      turnSpanId: null,
      streamingMessageId: null,
      streamChunkCount: 0,
      pendingToolDescriptions: new Map(),
    },
    ...overrides,
  };
}

describe("handleStreamChunk — tool events", () => {
  it("emits agent:tool_start with stashed description on tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-1", "Searching for papers");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "web_search", args: {} },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:tool_start",
      payload: {
        projectId: "proj-1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for papers",
      },
    });
  });

  it("removes entry from pendingToolDescriptions after tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-2", "Some description");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-2", toolName: "read_file", args: {} },
      ctx,
    );
    expect(ctx.state.pendingToolDescriptions.has("tc-2")).toBe(false);
  });

  it("falls back to toolName when no stashed description", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-3", toolName: "write_file", args: {} },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent:tool_start",
        payload: expect.objectContaining({ description: "write_file" }),
      }),
    );
  });

  it("emits agent:tool_end on tool_execution_end", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_end",
        toolCallId: "tc-4",
        toolName: "start_research",
        result: {},
        isError: false,
      },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:tool_end",
      payload: {
        projectId: "proj-1",
        toolCallId: "tc-4",
        toolName: "start_research",
        isError: false,
      },
    });
  });

  it("emits agent:tool_end with isError:true on error", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "tool_execution_end",
        toolCallId: "tc-5",
        toolName: "safe_bash",
        result: "error",
        isError: true,
      },
      ctx,
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ isError: true }),
      }),
    );
  });

  it("still handles text_delta normally alongside tool events", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      },
      ctx,
    );
    expect(ctx.state.assistantContent).toBe("Hello");
    expect(ctx.eventBus.emit).toHaveBeenCalledWith({
      type: "agent:chunk",
      payload: { projectId: "proj-1", delta: "Hello" },
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun run test src/main/agent/handlers/stream-chunk.test.ts
```

Expected: FAIL — handler does not handle `tool_execution_start` or `tool_execution_end`.

- [ ] **Step 3: Update `handleStreamChunk.ts`**

Replace the entire contents of `src/main/agent/handlers/stream-chunk.ts`:

```typescript
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleStreamChunk(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type === "message_update") {
    const ae = event.assistantMessageEvent;
    if (ae?.type === "text_delta") {
      ctx.state.assistantContent += ae.delta;
      ctx.state.streamChunkCount++;
      ctx.eventBus.emit({
        type: "agent:chunk",
        payload: { projectId: ctx.projectId, delta: ae.delta },
      });

      if (ctx.state.streamingMessageId && ctx.state.streamChunkCount % 5 === 0) {
        try {
          await ctx.messageService.updateMessage(
            ctx.state.streamingMessageId,
            ctx.state.assistantContent,
          );
        } catch (err) {
          console.error("[AgentSession] failed to update streaming message:", err);
        }
      }
    }
    return;
  }

  if (event.type === "tool_execution_start") {
    const description =
      ctx.state.pendingToolDescriptions.get(event.toolCallId) ?? event.toolName;
    ctx.state.pendingToolDescriptions.delete(event.toolCallId);
    ctx.eventBus.emit({
      type: "agent:tool_start",
      payload: {
        projectId: ctx.projectId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        description,
      },
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    ctx.eventBus.emit({
      type: "agent:tool_end",
      payload: {
        projectId: ctx.projectId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      },
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run test src/main/agent/handlers/stream-chunk.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Run full suite**

```bash
bun run test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/handlers/stream-chunk.ts src/main/agent/handlers/stream-chunk.test.ts
git commit -m "feat: emit agent:tool_start/end from handleStreamChunk"
```

---

## Task 5: Forward tool events from main to renderer

**Files:**
- Modify: `src/main/ipc/event-forwarders.ts`

- [ ] **Step 1: Add forwarding to `event-forwarders.ts`**

Add at the end of the `registerEventForwarders` function body, before the closing `}`:

```typescript
  eventBus.on("agent:tool_start", (payload) => {
    win.webContents.send(IPC.TOOL_START, payload);
  });

  eventBus.on("agent:tool_end", (payload) => {
    win.webContents.send(IPC.TOOL_END, payload);
  });
```

- [ ] **Step 2: Typecheck + full tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors, all passing.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/event-forwarders.ts
git commit -m "feat: forward agent:tool_start/end to renderer via IPC"
```

---

## Task 6: `ActivityPill` component

**Files:**
- Create: `src/renderer/components/shared/ActivityPill.tsx`
- Create: `src/renderer/components/shared/__tests__/ActivityPill.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/renderer/components/shared/__tests__/ActivityPill.test.tsx`:

```typescript
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityPill from "../ActivityPill";

describe("ActivityPill", () => {
  it("renders description text", () => {
    render(
      <ActivityPill
        toolCallId="tc-1"
        toolName="web_search"
        description="Searching for papers"
        status="running"
      />,
    );
    expect(screen.getByText("Searching for papers")).toBeTruthy();
  });

  it("renders running state with data-testid", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-2"
        toolName="read_file"
        description="Reading config"
        status="running"
      />,
    );
    expect(container.querySelector("[data-testid='activity-running']")).toBeTruthy();
  });

  it("renders done state", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-3"
        toolName="write_file"
        description="Writing output"
        status="done"
      />,
    );
    expect(container.querySelector("[data-testid='activity-done']")).toBeTruthy();
  });

  it("renders error state", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-4"
        toolName="safe_bash"
        description="Running command"
        status="error"
      />,
    );
    expect(container.querySelector("[data-testid='activity-error']")).toBeTruthy();
  });

  it("truncates long descriptions", () => {
    const long = "A".repeat(200);
    const { container } = render(
      <ActivityPill toolCallId="tc-5" toolName="x" description={long} status="done" />,
    );
    const textEl = container.querySelector("[data-testid='activity-description']");
    expect(textEl).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun run test src/renderer/components/shared/__tests__/ActivityPill.test.tsx
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Create `ActivityPill.tsx`**

Create `src/renderer/components/shared/ActivityPill.tsx`:

```typescript
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import CircularProgress from "@mui/material/CircularProgress";

export interface ActivityPillProps {
  toolCallId: string;
  toolName: string;
  description: string;
  status: "running" | "done" | "error";
}

export default function ActivityPill({ description, status }: ActivityPillProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 10,
        background: "var(--surface)",
        border: `1px solid ${status === "running" ? "var(--accent)" : "var(--line)"}`,
        maxWidth: 480,
        width: "fit-content",
      }}
    >
      {status === "running" && (
        <CircularProgress
          data-testid="activity-running"
          size={14}
          sx={{ color: "var(--accent)", flexShrink: 0 }}
        />
      )}
      {status === "done" && (
        <CheckIcon
          data-testid="activity-done"
          sx={{ fontSize: 14, color: "var(--ink-2)", flexShrink: 0 }}
        />
      )}
      {status === "error" && (
        <CloseIcon
          data-testid="activity-error"
          sx={{ fontSize: 14, color: "error.main", flexShrink: 0 }}
        />
      )}
      <span
        data-testid="activity-description"
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 440,
        }}
      >
        {description}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run test src/renderer/components/shared/__tests__/ActivityPill.test.tsx
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/shared/ActivityPill.tsx src/renderer/components/shared/__tests__/ActivityPill.test.tsx
git commit -m "feat: add ActivityPill component for streaming tool activity display"
```

---

## Task 7: Streaming segment model in `StreamStateContext`

**Files:**
- Modify: `src/renderer/contexts/StreamStateContext.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/contexts/__tests__/StreamStateContext.test.tsx`:

```typescript
// @vitest-environment happy-dom

import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useContext } from "react";
import { StreamStateContext, StreamStateProvider } from "../StreamStateContext";
import type { StreamSegment } from "../StreamStateContext";
import { IPC } from "../../../shared/ipc-channels";

type ListenerMap = Record<string, ((data: unknown) => void)[]>;

function setupElectronMock() {
  const listeners: ListenerMap = {};
  window.electronAPI = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn((channel: string, cb: (data: unknown) => void) => {
      listeners[channel] = listeners[channel] ?? [];
      listeners[channel].push(cb);
      return () => {
        listeners[channel] = listeners[channel].filter((l) => l !== cb);
      };
    }),
  } as unknown as Window["electronAPI"];
  return listeners;
}

function emit(listeners: ListenerMap, channel: string, data: unknown) {
  for (const cb of listeners[channel] ?? []) cb(data);
}

function TestConsumer() {
  const { states } = useContext(StreamStateContext);
  const proj = states["p1"];
  if (!proj) return <div>no state</div>;
  return (
    <div>
      <div data-testid="processing">{String(proj.processing)}</div>
      <div data-testid="segments">{JSON.stringify(proj.streamingSegments)}</div>
    </div>
  );
}

describe("StreamStateContext — segments", () => {
  let listeners: ListenerMap;

  beforeEach(() => {
    listeners = setupElectronMock();
    render(
      <StreamStateProvider>
        <TestConsumer />
      </StreamStateProvider>,
    );
  });

  it("appends text segment on MESSAGE_CHUNK", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hello" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([{ type: "text", content: "Hello" }]);
  });

  it("appends to existing text segment on subsequent chunks", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hello" }));
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: " world" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("starts new text segment after activity segment", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching",
      }),
    );
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Result:" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe("activity");
    expect(segments[1]).toEqual({ type: "text", content: "Result:" });
  });

  it("pushes activity segment on TOOL_START", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for X",
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for X",
        status: "running",
      },
    ]);
  });

  it("updates activity segment to done on TOOL_END", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-2",
        toolName: "write_file",
        description: "Writing output",
      }),
    );
    act(() =>
      emit(listeners, IPC.TOOL_END, {
        projectId: "p1",
        toolCallId: "tc-2",
        toolName: "write_file",
        isError: false,
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments[0]).toMatchObject({ type: "activity", status: "done", toolCallId: "tc-2" });
  });

  it("updates activity segment to error on TOOL_END with isError", () => {
    act(() =>
      emit(listeners, IPC.TOOL_START, {
        projectId: "p1",
        toolCallId: "tc-3",
        toolName: "safe_bash",
        description: "Running cmd",
      }),
    );
    act(() =>
      emit(listeners, IPC.TOOL_END, {
        projectId: "p1",
        toolCallId: "tc-3",
        toolName: "safe_bash",
        isError: true,
      }),
    );
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments[0]).toMatchObject({ type: "activity", status: "error" });
  });

  it("clears segments on MESSAGE_DONE", () => {
    act(() => emit(listeners, IPC.MESSAGE_CHUNK, { projectId: "p1", delta: "Hi" }));
    act(() => emit(listeners, IPC.MESSAGE_DONE, { projectId: "p1" }));
    const segments: StreamSegment[] = JSON.parse(
      screen.getByTestId("segments").textContent ?? "[]",
    );
    expect(segments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun run test src/renderer/contexts/__tests__/StreamStateContext.test.tsx
```

Expected: FAIL — `streamingSegments` does not exist on `ProjectStreamState`.

- [ ] **Step 3: Rewrite `StreamStateContext.tsx`**

Replace the entire contents of `src/renderer/contexts/StreamStateContext.tsx`:

```typescript
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { IPC } from "../../shared/ipc-channels";
import { decodeMessageChunk, decodeMessageDone, decodeToolStart, decodeToolEnd } from "../../shared/ipc-guards";

export type StreamSegment =
  | { type: "text"; content: string }
  | {
      type: "activity";
      toolCallId: string;
      toolName: string;
      description: string;
      status: "running" | "done" | "error";
    };

export interface ProjectStreamState {
  streamingSegments: StreamSegment[];
  processing: boolean;
}

interface StreamStateContextValue {
  states: Record<string, ProjectStreamState>;
  startStream(projectId: string): void;
  endStream(projectId: string): void;
}

const StreamStateContext = createContext<StreamStateContextValue>({
  states: {},
  startStream: () => {},
  endStream: () => {},
});

export { StreamStateContext };

export function StreamStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ProjectStreamState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const STREAM_TIMEOUT_MS = 300_000;

  const clearTimer = useCallback((projectId: string) => {
    const timer = timersRef.current[projectId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[projectId];
    }
  }, []);

  const startTimer = useCallback(
    (projectId: string) => {
      clearTimer(projectId);
      timersRef.current[projectId] = setTimeout(() => {
        setStates((prev) => {
          const next = { ...prev };
          if (next[projectId]) {
            next[projectId] = { ...next[projectId], streamingSegments: [], processing: false };
          }
          return next;
        });
      }, STREAM_TIMEOUT_MS);
    },
    [clearTimer],
  );

  const startStream = useCallback(
    (projectId: string) => {
      setStates((prev) => {
        const existing = prev[projectId];
        return {
          ...prev,
          [projectId]: {
            streamingSegments: existing?.streamingSegments ?? [],
            processing: true,
          },
        };
      });
      startTimer(projectId);
    },
    [startTimer],
  );

  const endStream = useCallback(
    (projectId: string) => {
      clearTimer(projectId);
      setStates((prev) => {
        const next = { ...prev };
        if (next[projectId]) {
          next[projectId] = { ...next[projectId], streamingSegments: [], processing: false };
        }
        return next;
      });
    },
    [clearTimer],
  );

  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (data) => {
      const chunk = decodeMessageChunk(data);
      if (chunk === null) return;
      const { projectId, delta } = chunk;
      if (!projectId) return;

      setStates((prev) => {
        const existing = prev[projectId];
        const segments: StreamSegment[] = existing?.streamingSegments
          ? [...existing.streamingSegments]
          : [];
        const last = segments[segments.length - 1];
        if (last?.type === "text") {
          segments[segments.length - 1] = { type: "text", content: last.content + delta };
        } else {
          segments.push({ type: "text", content: delta });
        }
        return {
          ...prev,
          [projectId]: { streamingSegments: segments, processing: true },
        };
      });
      startTimer(projectId);
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, (data) => {
      const done = decodeMessageDone(data);
      if (done === null) return;
      const { projectId } = done;
      if (!projectId) return;
      endStream(projectId);
    });

    const unsubToolStart = window.electronAPI.on(IPC.TOOL_START, (data) => {
      const payload = decodeToolStart(data);
      if (payload === null) return;
      const { projectId, toolCallId, toolName, description } = payload;

      setStates((prev) => {
        const existing = prev[projectId];
        const segments: StreamSegment[] = existing?.streamingSegments
          ? [...existing.streamingSegments]
          : [];
        segments.push({ type: "activity", toolCallId, toolName, description, status: "running" });
        return {
          ...prev,
          [projectId]: {
            streamingSegments: segments,
            processing: existing?.processing ?? true,
          },
        };
      });
    });

    const unsubToolEnd = window.electronAPI.on(IPC.TOOL_END, (data) => {
      const payload = decodeToolEnd(data);
      if (payload === null) return;
      const { projectId, toolCallId, isError } = payload;

      setStates((prev) => {
        const existing = prev[projectId];
        if (!existing) return prev;
        const segments: StreamSegment[] = existing.streamingSegments.map((seg) =>
          seg.type === "activity" && seg.toolCallId === toolCallId
            ? { ...seg, status: isError ? ("error" as const) : ("done" as const) }
            : seg,
        );
        return {
          ...prev,
          [projectId]: { ...existing, streamingSegments: segments },
        };
      });
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubToolStart();
      unsubToolEnd();
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, [endStream, startTimer]);

  return (
    <StreamStateContext.Provider value={{ states, startStream, endStream }}>
      {children}
    </StreamStateContext.Provider>
  );
}

export function useStreamState(): StreamStateContextValue {
  return useContext(StreamStateContext);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run test src/renderer/contexts/__tests__/StreamStateContext.test.tsx
```

Expected: 7 passing.

- [ ] **Step 5: Run full suite**

```bash
bun run test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/contexts/StreamStateContext.tsx src/renderer/contexts/__tests__/StreamStateContext.test.tsx
git commit -m "feat: replace streamingContent with StreamSegment[] in StreamStateContext"
```

---

## Task 8: Render segments in `MessageList` and update `ChatPanel`

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`
- Create: `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`:

```typescript
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MessageList from "../MessageList";
import type { StreamSegment } from "../../../../contexts/StreamStateContext";
import type { Message } from "../../../../../shared/types";

const noMessages: Message[] = [];

describe("MessageList — segments", () => {
  it("renders text segment content during streaming", () => {
    const segments: StreamSegment[] = [{ type: "text", content: "Hello world" }];
    render(
      <MessageList messages={noMessages} streamingSegments={segments} processing={false} />,
    );
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders activity pill for running tool", () => {
    const segments: StreamSegment[] = [
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for papers",
        status: "running",
      },
    ];
    render(
      <MessageList messages={noMessages} streamingSegments={segments} processing={true} />,
    );
    expect(screen.getByText("Searching for papers")).toBeTruthy();
  });

  it("renders both text and activity segments in order", () => {
    const segments: StreamSegment[] = [
      { type: "text", content: "Let me search." },
      {
        type: "activity",
        toolCallId: "tc-2",
        toolName: "web_search",
        description: "Searching",
        status: "done",
      },
      { type: "text", content: "Found results." },
    ];
    render(
      <MessageList messages={noMessages} streamingSegments={segments} processing={false} />,
    );
    expect(screen.getByText("Let me search.")).toBeTruthy();
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.getByText("Found results.")).toBeTruthy();
  });

  it("shows thinking spinner when processing and no running tool", () => {
    render(
      <MessageList messages={noMessages} streamingSegments={[]} processing={true} />,
    );
    expect(screen.getByText("Agent is thinking...")).toBeTruthy();
  });

  it("does not show thinking spinner when a tool is running", () => {
    const segments: StreamSegment[] = [
      {
        type: "activity",
        toolCallId: "tc-3",
        toolName: "read_file",
        description: "Reading file",
        status: "running",
      },
    ];
    render(
      <MessageList messages={noMessages} streamingSegments={segments} processing={true} />,
    );
    expect(screen.queryByText("Agent is thinking...")).toBeNull();
  });

  it("renders historical messages unchanged", () => {
    const messages: Message[] = [
      {
        id: "m1",
        projectId: "p1",
        role: "user",
        content: "Hello there",
        createdAt: new Date(),
      },
    ];
    render(
      <MessageList messages={messages} streamingSegments={[]} processing={false} />,
    );
    expect(screen.getByText("Hello there")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx
```

Expected: FAIL — `MessageList` does not accept `streamingSegments` prop.

- [ ] **Step 3: Rewrite `MessageList.tsx`**

Replace the entire contents of `src/renderer/components/layout/chat/MessageList.tsx`:

```typescript
import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";
import ActivityPill from "../../shared/ActivityPill";
import MarkdownRenderer from "../../shared/MarkdownRenderer";
import type { StreamSegment } from "../../../contexts/StreamStateContext";

interface MessageListProps {
  messages: Message[];
  streamingSegments: StreamSegment[];
  processing?: boolean;
}

export default function MessageList({ messages, streamingSegments, processing }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when messages or streaming segments change to auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingSegments]);

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
          if (streamingSegments.length > 0 && m.role === "assistant") return false;
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

  return (
    <div
      className="thin-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 24px",
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
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Agent is thinking...</span>
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
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: Update `ChatPanel.tsx`**

In `src/renderer/components/layout/chat/ChatPanel.tsx`, change the three lines that reference `streamingContent`:

```typescript
  const streamingSegments = projectState?.streamingSegments ?? [];
  const processing = projectState?.processing ?? false;
```

(Remove the `streamingContent` line.)

Then update the `MessageList` render call:

```typescript
      <MessageList
        messages={messages}
        streamingSegments={streamingSegments}
        processing={processing}
      />
```

Also update the `MessageInput` disabled condition (previously checked `streamingContent !== null`):

```typescript
          disabled={processing || streamingSegments.length > 0}
```

- [ ] **Step 5: Run MessageList tests — expect PASS**

```bash
bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx
```

Expected: 6 passing.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Run full suite**

```bash
bun run test
```

Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx src/renderer/components/layout/chat/__tests__/MessageList.test.tsx src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "feat: render StreamSegment[] in MessageList with ActivityPill support"
```

---

## Task 9: Final check + lint

- [ ] **Step 1: Lint + format**

```bash
bun run check
```

Fix any issues reported by Biome, then re-run until clean.

- [ ] **Step 2: Full typecheck + test**

```bash
bun run typecheck && bun run test
```

Expected: zero type errors, all tests passing.

- [ ] **Step 3: Launch and smoke-test**

```bash
bun run dev
```

Send a message that triggers a tool call (e.g. ask the agent to search for something). Verify:
- ActivityPill appears with spinner while tool runs
- Pill transitions to checkmark when done
- Text before and after tool call renders in separate bubbles
- "Agent is thinking..." spinner shows between turns

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -p
git commit -m "chore: lint fixes for streaming tool activity feature"
```
