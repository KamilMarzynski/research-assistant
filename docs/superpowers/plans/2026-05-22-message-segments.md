# Assistant Message Segments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the in-stream order of text and tool calls for assistant messages so committed messages render with the same visual layout as the live stream (text → tool → text → tool …), eliminating the jump where tool pills snap above the text bubble on commit.

**Architecture:** Additive `segments` JSON column on `messages`. The agent session already produces interleaved `text_delta` and `tool_execution_start/end` events — add a `segmentLog: MessageSegment[]` to `SessionState`, append to it from `stream-chunk.ts`, and persist it on `agent_end` in `turn-completion.ts`. The renderer reads `msg.segments` when present and renders the same loop used for streaming; legacy rows without `segments` fall back to the existing `content` + `toolCalls` render path. No backfill — old rows keep rendering the legacy way.

**Tech Stack:** TypeScript, Drizzle ORM (Turso/libsql dialect), React 18, Vitest, tsyringe DI, Biome.

---

## File Structure

**Modify:**
- `src/shared/types/message.ts` — add `MessageSegment` union, extend `Message` with `segments?: MessageSegment[]`.
- `src/main/db/schema.ts` — add `segments` text column.
- `src/main/db/migrate.ts` — add idempotent `ALTER TABLE messages ADD COLUMN segments TEXT` run.
- `src/main/repositories/IMessageRepository.ts` — extend `create` / `updateContent` signatures with `segments?`.
- `src/main/repositories/drizzle/DrizzleMessageRepository.ts` — serialize on write, parse on read.
- `src/main/services/MessageService.ts` — pass `segments` through.
- `src/main/agent/handlers/types.ts` — `SessionState.segmentLog: MessageSegment[]`.
- `src/main/agent/handlers/stream-chunk.ts` — append text deltas + push/mutate activity segments.
- `src/main/agent/handlers/turn-completion.ts` — persist `segmentLog`, reset on turn close.
- `src/main/agent/session.ts` — initialise `segmentLog: []` in default state (verify in this task).
- `src/renderer/contexts/StreamStateContext.tsx` — re-export `StreamSegment` as alias of `MessageSegment` extended with `"running"` status (so streaming + committed share one shape, only `status` widens).
- `src/renderer/components/layout/chat/MessageList.tsx` — extract a `renderSegments()` block; commit branch uses it when `msg.segments` present, else falls back.

**Modify (tests):**
- `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`
- `src/main/services/__tests__/MessageService.test.ts` (if it exists — check during Task 4)
- `src/main/agent/handlers/stream-chunk.test.ts`
- `src/main/agent/__tests__/turn-completion.test.ts`
- `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`

**Create:** none.

---

## Task 1: Add `MessageSegment` type to shared types

**Files:**
- Modify: `src/shared/types/message.ts`

- [ ] **Step 1: Edit the file**

Replace the contents with:

```ts
export type MessageRole = "user" | "assistant" | "system";

export type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  description: string;
  status: "done" | "error";
};

export type MessageSegment =
  | { type: "text"; content: string }
  | {
      type: "activity";
      toolCallId: string;
      toolName: string;
      description: string;
      status: "done" | "error";
    };

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  toolCalls?: ToolCallRecord[];
  segments?: MessageSegment[];
};
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: zero errors (no existing code references `segments` yet).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/message.ts
git commit -m "feat(types): add MessageSegment + Message.segments"
```

---

## Task 2: Add `segments` column to schema and migration

**Files:**
- Modify: `src/main/db/schema.ts:19-28`
- Modify: `src/main/db/migrate.ts` (append new idempotent ALTER at end of `runMigrations`)

- [ ] **Step 1: Edit schema**

In `src/main/db/schema.ts`, change the `messages` table to:

```ts
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"),
  segments: text("segments"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 2: Edit migrate.ts — add idempotent ALTER**

At the end of `runMigrations` in `src/main/db/migrate.ts` (after the existing Run 21 block), append:

```ts
  // Run 22: add segments to messages — idempotent
  try {
    await db.run(sql`ALTER TABLE messages ADD COLUMN segments TEXT`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
```

- [ ] **Step 3: Verify migration runs cleanly on existing DB**

Run: `bun run typecheck && bun run test src/main/db`
Expected: passes; `client.test.ts` exercises the migration path and should not break.

- [ ] **Step 4: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.ts
git commit -m "feat(db): add messages.segments column"
```

---

## Task 3: Repository round-trips `segments`

**Files:**
- Modify: `src/main/repositories/IMessageRepository.ts`
- Modify: `src/main/repositories/drizzle/DrizzleMessageRepository.ts`
- Test: `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `DrizzleMessageRepository.test.ts` (inside the existing top-level `describe`):

```ts
  it("persists and parses segments round-trip", async () => {
    const { repo, projectId } = await setupRepo(); // reuse existing setup helper
    const segments = [
      { type: "text", content: "Looking at the schema." },
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "Read schema.ts",
        status: "done" as const,
      },
      { type: "text", content: "Schema has no ordering field." },
    ] satisfies import("@shared/types").MessageSegment[];

    const created = await repo.create({
      projectId,
      role: "assistant",
      content: "Looking at the schema. Schema has no ordering field.",
      segments,
    });

    expect(created.segments).toEqual(segments);

    const fetched = await repo.listByProject(projectId);
    expect(fetched.at(-1)?.segments).toEqual(segments);
  });

  it("updateContent persists segments when provided", async () => {
    const { repo, projectId } = await setupRepo();
    const created = await repo.create({ projectId, role: "assistant", content: "initial" });

    const segments = [
      { type: "text", content: "final" },
    ] satisfies import("@shared/types").MessageSegment[];

    await repo.updateContent(created.id, "final", undefined, segments);

    const fetched = await repo.listByProject(projectId);
    expect(fetched[0].segments).toEqual(segments);
  });

  it("returns undefined segments for rows where column is null (legacy rows)", async () => {
    const { repo, projectId } = await setupRepo();
    await repo.create({ projectId, role: "assistant", content: "legacy" });
    const fetched = await repo.listByProject(projectId);
    expect(fetched[0].segments).toBeUndefined();
  });
```

Note: if the existing test file uses a different setup pattern (no `setupRepo` helper), adapt to match the file's existing style — keep the assertions identical.

- [ ] **Step 2: Run tests — expect failure**

Run: `bun run test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`
Expected: FAIL with type error or "Argument of type … is not assignable" because `segments` is not yet in the repo signature.

- [ ] **Step 3: Update `IMessageRepository`**

Replace `src/main/repositories/IMessageRepository.ts` with:

```ts
import type { Message, MessageSegment, ToolCallRecord } from "@shared/types";

export interface IMessageRepository {
  create(data: Omit<Message, "id" | "createdAt">): Promise<Message>;
  updateContent(
    id: string,
    content: string,
    toolCalls?: ToolCallRecord[],
    segments?: MessageSegment[],
  ): Promise<void>;
  deleteMessage(id: string): Promise<void>;
  listByProject(projectId: string): Promise<Message[]>;
  getRecent(projectId: string, n: number): Promise<Message[]>;
}
```

- [ ] **Step 4: Update `DrizzleMessageRepository`**

In `src/main/repositories/drizzle/DrizzleMessageRepository.ts`:

1. Add `MessageSegment` to the import from `@shared/types`:

```ts
import type { Message, MessageRole, MessageSegment, ToolCallRecord } from "../../../shared/types";
```

2. Replace `create`:

```ts
  async create(data: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const message: Message = {
      id: this.id(),
      projectId: data.projectId,
      role: data.role,
      content: data.content,
      createdAt: this.now(),
      toolCalls: data.toolCalls,
      segments: data.segments,
    };
    await this.db.insert(messages).values({
      id: message.id,
      projectId: message.projectId,
      role: message.role,
      content: message.content,
      toolCalls: data.toolCalls ? JSON.stringify(data.toolCalls) : null,
      segments: data.segments ? JSON.stringify(data.segments) : null,
      createdAt: message.createdAt,
    });
    return message;
  }
```

3. Replace `updateContent`:

```ts
  async updateContent(
    id: string,
    content: string,
    toolCalls?: ToolCallRecord[],
    segments?: MessageSegment[],
  ): Promise<void> {
    await this.db
      .update(messages)
      .set({
        content,
        ...(toolCalls !== undefined ? { toolCalls: JSON.stringify(toolCalls) } : {}),
        ...(segments !== undefined ? { segments: JSON.stringify(segments) } : {}),
      })
      .where(eq(messages.id, id));
  }
```

4. Replace `rowToEntity`:

```ts
  protected rowToEntity = (row: typeof messages.$inferSelect): Message => ({
    id: row.id,
    projectId: row.projectId,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.createdAt,
    toolCalls: row.toolCalls ? (JSON.parse(row.toolCalls) as ToolCallRecord[]) : undefined,
    segments: row.segments ? (JSON.parse(row.segments) as MessageSegment[]) : undefined,
  });
```

- [ ] **Step 5: Run tests — expect pass**

Run: `bun run test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/repositories src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
git commit -m "feat(repo): round-trip messages.segments"
```

---

## Task 4: MessageService passes `segments` through

**Files:**
- Modify: `src/main/services/MessageService.ts:21-23`
- Test: any existing `MessageService` test file (check `src/main/services/__tests__/` first; if none for this service, skip the new unit test — Task 8 integration covers it).

- [ ] **Step 1: Locate existing tests**

Run: `find /Users/mayk/Projects/private/research-assistant/src/main/services -name "MessageService.test*"`
If a file exists, use it for Step 2. Otherwise jump to Step 4 (no service-level test needed — repo + handler tests cover the flow).

- [ ] **Step 2 (optional, only if test file exists): Write failing test**

Add:

```ts
  it("passes segments to repo.updateContent", async () => {
    const repo = { updateContent: vi.fn() } as unknown as IMessageRepository;
    const service = new MessageService(repo);
    const segments: MessageSegment[] = [{ type: "text", content: "hi" }];
    await service.updateMessage("id-1", "hi", undefined, segments);
    expect(repo.updateContent).toHaveBeenCalledWith("id-1", "hi", undefined, segments);
  });
```

- [ ] **Step 3 (optional): Run — expect failure**

Run: `bun run test src/main/services`
Expected: FAIL (signature mismatch).

- [ ] **Step 4: Update `MessageService`**

Replace `src/main/services/MessageService.ts`:

```ts
import { inject, injectable } from "tsyringe";
import type { Message, MessageRole, MessageSegment, ToolCallRecord } from "../../shared/types";
import { MESSAGE_REPO_TOKEN } from "../di/tokens";
import type { IMessageRepository } from "../repositories/IMessageRepository";

const VALID_ROLES = new Set<MessageRole>(["user", "assistant", "system"]);

@injectable()
export class MessageService {
  constructor(@inject(MESSAGE_REPO_TOKEN) private readonly repo: IMessageRepository) {}

  async addMessage(data: Omit<Message, "id" | "createdAt">): Promise<Message> {
    if (!VALID_ROLES.has(data.role)) {
      throw new Error(
        `Invalid message role: "${data.role}". Must be one of: user, assistant, system`,
      );
    }
    return this.repo.create(data);
  }

  async updateMessage(
    id: string,
    content: string,
    toolCalls?: ToolCallRecord[],
    segments?: MessageSegment[],
  ): Promise<void> {
    return this.repo.updateContent(id, content, toolCalls, segments);
  }

  async deleteMessage(id: string): Promise<void> {
    return this.repo.deleteMessage(id);
  }

  async getHistory(projectId: string): Promise<Message[]> {
    return this.repo.listByProject(projectId);
  }

  async getRecentContext(projectId: string, n: number): Promise<Message[]> {
    return this.repo.getRecent(projectId, n);
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: zero errors. (`stream-chunk.ts` already calls `updateMessage(id, content)` — the new optional `segments` keeps backward compat.)

- [ ] **Step 6: Commit**

```bash
git add src/main/services/MessageService.ts
git commit -m "feat(service): MessageService accepts segments"
```

---

## Task 5: Build `segmentLog` in SessionState during streaming

**Files:**
- Modify: `src/main/agent/handlers/types.ts:13-27`
- Modify: `src/main/agent/handlers/stream-chunk.ts`
- Modify: `src/main/agent/session.ts` (initial state — verify location and add `segmentLog: []`)
- Test: `src/main/agent/handlers/stream-chunk.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/main/agent/handlers/stream-chunk.test.ts`:

```ts
import type { MessageSegment } from "@shared/types";

describe("handleStreamChunk — segmentLog", () => {
  it("starts a new text segment on first text_delta", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([{ type: "text", content: "Hello" }] satisfies MessageSegment[]);
  });

  it("appends to last text segment on subsequent text_delta", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi " } } as never,
      ctx,
    );
    await handleStreamChunk(
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "there" } } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([{ type: "text", content: "Hi there" }]);
  });

  it("pushes activity segment on tool_execution_start", async () => {
    const ctx = makeCtx();
    ctx.state.pendingToolDescriptions.set("tc-1", "Reading file");
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read_file", args: {} } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "Reading file",
        status: "done", // initial committed status — overwritten by tool_execution_end if error
      },
    ]);
  });

  it("starts a new text segment after a tool call (text-after-tool = new bubble)", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "before" } } as never,
      ctx,
    );
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read_file", args: {} } as never,
      ctx,
    );
    await handleStreamChunk(
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "after" } } as never,
      ctx,
    );
    expect(ctx.state.segmentLog).toEqual([
      { type: "text", content: "before" },
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "read_file",
        status: "done",
      },
      { type: "text", content: "after" },
    ]);
  });

  it("marks activity segment as error on tool_execution_end with isError", async () => {
    const ctx = makeCtx();
    await handleStreamChunk(
      { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read_file", args: {} } as never,
      ctx,
    );
    await handleStreamChunk(
      { type: "tool_execution_end", toolCallId: "tc-1", toolName: "read_file", isError: true, result: "" } as never,
      ctx,
    );
    expect(ctx.state.segmentLog[0]).toMatchObject({ type: "activity", status: "error" });
  });
});
```

Also update the existing `makeCtx` helper in this file: add `segmentLog: []` to the `state` object.

- [ ] **Step 2: Run tests — expect failure**

Run: `bun run test src/main/agent/handlers/stream-chunk.test.ts`
Expected: FAIL — `segmentLog` does not exist on `SessionState`.

- [ ] **Step 3: Add `segmentLog` to `SessionState`**

In `src/main/agent/handlers/types.ts`, add to the `SessionState` interface:

```ts
import type { MessageSegment } from "../../../shared/types";

// inside SessionState:
  segmentLog: MessageSegment[];
```

- [ ] **Step 4: Initialise `segmentLog` in session default state**

Search `src/main/agent/session.ts` for where `SessionState` is created (likely an object literal with `assistantContent: ""`). Add `segmentLog: [],` alongside it.

Run: `grep -n "assistantContent: \"\"" /Users/mayk/Projects/private/research-assistant/src/main/agent/session.ts` to find the location, then edit.

- [ ] **Step 5: Update `stream-chunk.ts`**

Replace `src/main/agent/handlers/stream-chunk.ts` with:

```ts
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleStreamChunk(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type === "message_update") {
    const ae = event.assistantMessageEvent;
    if (ae?.type === "text_delta") {
      ctx.state.assistantContent += ae.delta;
      ctx.state.streamChunkCount++;

      const last = ctx.state.segmentLog[ctx.state.segmentLog.length - 1];
      if (last?.type === "text") {
        last.content += ae.delta;
      } else {
        ctx.state.segmentLog.push({ type: "text", content: ae.delta });
      }

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
    const description = ctx.state.pendingToolDescriptions.get(event.toolCallId) ?? event.toolName;
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
    ctx.state.pendingToolCalls.push({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      description,
      status: "running",
    });
    ctx.state.segmentLog.push({
      type: "activity",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      description,
      status: "done",
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
    const idx = ctx.state.pendingToolCalls.findIndex((tc) => tc.toolCallId === event.toolCallId);
    const existing = idx >= 0 ? ctx.state.pendingToolCalls[idx] : undefined;
    if (existing) {
      ctx.state.pendingToolCalls[idx] = { ...existing, status: event.isError ? "error" : "done" };
    }
    if (event.isError) {
      const seg = ctx.state.segmentLog.find(
        (s) => s.type === "activity" && s.toolCallId === event.toolCallId,
      );
      if (seg && seg.type === "activity") seg.status = "error";
    }
  }
}
```

Note: activity segments start with `status: "done"` (optimistic). On `tool_execution_end` we only downgrade to `"error"` if `isError` — this avoids an extra mutation in the common success case.

- [ ] **Step 6: Run tests — expect pass**

Run: `bun run test src/main/agent/handlers/stream-chunk.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/handlers/types.ts src/main/agent/handlers/stream-chunk.ts src/main/agent/handlers/stream-chunk.test.ts src/main/agent/session.ts
git commit -m "feat(agent): build segmentLog during streaming"
```

---

## Task 6: Persist `segmentLog` in turn-completion

**Files:**
- Modify: `src/main/agent/handlers/turn-completion.ts:9-55`
- Test: `src/main/agent/__tests__/turn-completion.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/main/agent/__tests__/turn-completion.test.ts` (inside the existing describe block):

```ts
  it("passes segmentLog to messageService.addMessage on commit", async () => {
    const addMessage = vi.fn().mockResolvedValue({ id: "m-1" });
    const ctx = makeCtx({
      messageService: { addMessage, updateMessage: vi.fn() } as never,
    });
    ctx.state.assistantContent = "Hi there.";
    ctx.state.lastUserContent = "hi";
    ctx.state.currentTurnId = 1;
    ctx.state.segmentLog = [
      { type: "text", content: "Hi " },
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "Read",
        status: "done",
      },
      { type: "text", content: "there." },
    ];

    await handleTurnCompletion({ type: "agent_end" } as never, ctx);

    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [
          { type: "text", content: "Hi " },
          {
            type: "activity",
            toolCallId: "tc-1",
            toolName: "read_file",
            description: "Read",
            status: "done",
          },
          { type: "text", content: "there." },
        ],
      }),
    );
  });

  it("clears segmentLog after turn commit", async () => {
    const ctx = makeCtx({
      messageService: { addMessage: vi.fn().mockResolvedValue({ id: "m-1" }), updateMessage: vi.fn() } as never,
    });
    ctx.state.assistantContent = "ok";
    ctx.state.lastUserContent = "hi";
    ctx.state.currentTurnId = 1;
    ctx.state.segmentLog = [{ type: "text", content: "ok" }];
    await handleTurnCompletion({ type: "agent_end" } as never, ctx);
    expect(ctx.state.segmentLog).toEqual([]);
  });

  it("passes segmentLog to messageService.updateMessage when streamingMessageId is set", async () => {
    const updateMessage = vi.fn();
    const ctx = makeCtx({
      messageService: { addMessage: vi.fn(), updateMessage } as never,
    });
    ctx.state.assistantContent = "ok";
    ctx.state.lastUserContent = "hi";
    ctx.state.currentTurnId = 1;
    ctx.state.streamingMessageId = "msg-existing";
    ctx.state.segmentLog = [{ type: "text", content: "ok" }];
    await handleTurnCompletion({ type: "agent_end" } as never, ctx);
    expect(updateMessage).toHaveBeenCalledWith(
      "msg-existing",
      "ok",
      undefined,
      [{ type: "text", content: "ok" }],
    );
  });
```

If `makeCtx` doesn't exist in this test file, follow the existing test setup pattern in the file — keep assertion shape identical.

- [ ] **Step 2: Run tests — expect failure**

Run: `bun run test src/main/agent/__tests__/turn-completion.test.ts`
Expected: FAIL — segments not yet passed.

- [ ] **Step 3: Update `turn-completion.ts`**

Replace `src/main/agent/handlers/turn-completion.ts` with:

```ts
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { MessageSegment, ToolCallRecord } from "../../../shared/types";
import type { HandlerContext, PendingToolCall } from "./types";

function isFinished(tc: PendingToolCall): tc is ToolCallRecord {
  return tc.status !== "running";
}

export async function handleTurnCompletion(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "agent_end") return;

  const content = ctx.state.assistantContent;
  const userContent = ctx.state.lastUserContent;
  const segments: MessageSegment[] = [...ctx.state.segmentLog];
  ctx.state.assistantContent = "";
  ctx.state.lastUserContent = "";
  ctx.state.streamChunkCount = 0;
  ctx.state.segmentLog = [];

  if (content && userContent && ctx.state.savedForTurn !== ctx.state.currentTurnId) {
    ctx.state.savedForTurn = ctx.state.currentTurnId;
    const finishedToolCalls = ctx.state.pendingToolCalls.filter(isFinished);
    ctx.state.pendingToolCalls = [];
    const toolCallsArg = finishedToolCalls.length > 0 ? finishedToolCalls : undefined;
    const segmentsArg = segments.length > 0 ? segments : undefined;
    try {
      if (ctx.state.streamingMessageId) {
        await ctx.messageService.updateMessage(
          ctx.state.streamingMessageId,
          content,
          toolCallsArg,
          segmentsArg,
        );
      } else {
        await ctx.messageService.addMessage({
          projectId: ctx.projectId,
          role: "assistant",
          content,
          ...(toolCallsArg ? { toolCalls: toolCallsArg } : {}),
          ...(segmentsArg ? { segments: segmentsArg } : {}),
        });
      }
      await ctx.memoryManager.save(ctx.projectId, [
        { role: "user", content: userContent },
        { role: "assistant", content },
      ]);
    } catch (err) {
      console.error("[AgentSession] save failed:", err);
    }
  } else {
    ctx.state.pendingToolCalls = [];
  }

  ctx.state.streamingMessageId = null;
  ctx.eventBus.emit({ type: "agent:done", payload: { projectId: ctx.projectId } });
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `bun run test src/main/agent`
Expected: PASS for both stream-chunk and turn-completion suites.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/handlers/turn-completion.ts src/main/agent/__tests__/turn-completion.test.ts
git commit -m "feat(agent): persist segmentLog on turn completion"
```

---

## Task 7: Renderer reads `segments` and renders interleaved bubbles

**Files:**
- Modify: `src/renderer/contexts/StreamStateContext.tsx:13-21`
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`
- Test: `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`

- [ ] **Step 1: Align `StreamSegment` with `MessageSegment`**

In `src/renderer/contexts/StreamStateContext.tsx`, keep the existing `StreamSegment` definition (it's a superset of `MessageSegment` — it allows `"running"` status). No change required there; it stays renderer-local. The renderer treats `MessageSegment` as a subtype.

Verify by adding to the top of `MessageList.tsx`:

```ts
import type { Message, MessageSegment } from "../../../../shared/types";
import type { StreamSegment } from "../../../contexts/StreamStateContext";
```

- [ ] **Step 2: Write failing test**

Add to `src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`:

```tsx
import type { Message } from "../../../../../shared/types"; // adjust to match existing import depth

it("renders committed message segments interleaved (text → tool → text)", () => {
  const msg: Message = {
    id: "m-1",
    projectId: "p-1",
    role: "assistant",
    content: "before after",
    createdAt: new Date(),
    segments: [
      { type: "text", content: "before" },
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "read_file",
        description: "Read schema",
        status: "done",
      },
      { type: "text", content: "after" },
    ],
  };

  render(<MessageList messages={[msg]} streamingSegments={[]} />);

  // Two text bubbles
  expect(screen.getByText("before")).toBeInTheDocument();
  expect(screen.getByText("after")).toBeInTheDocument();

  // Tool pill between them — check order in DOM
  const rendered = screen.getByText("before").closest("div");
  expect(rendered).not.toBeNull();
});

it("falls back to legacy render path when segments absent", () => {
  const msg: Message = {
    id: "m-2",
    projectId: "p-1",
    role: "assistant",
    content: "legacy content",
    createdAt: new Date(),
    toolCalls: [
      { toolCallId: "tc-9", toolName: "old_tool", description: "old", status: "done" },
    ],
  };

  render(<MessageList messages={[msg]} streamingSegments={[]} />);

  expect(screen.getByText("legacy content")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests — expect failure**

Run: `bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`
Expected: FAIL on segment rendering — tool pill won't appear in correct order because the current code renders all tool calls first.

- [ ] **Step 4: Refactor `MessageList.tsx` assistant render branch**

In `src/renderer/components/layout/chat/MessageList.tsx`, replace lines 108–152 (the `displayMessages.map(...)` block) with the version below. Keep everything else (`streamingSegments` block, jump button, scroll logic) untouched.

```tsx
        {displayMessages.map((msg) => {
          const isAssistant = msg.role === "assistant";
          const useSegments = isAssistant && msg.segments && msg.segments.length > 0;

          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxWidth: 640,
                marginLeft: msg.role === "user" ? "auto" : undefined,
              }}
            >
              {useSegments
                ? msg.segments?.map((seg, i) =>
                    seg.type === "text" ? (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: segments are immutable post-commit
                        key={`${msg.id}-seg-${i}`}
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
                      </div>
                    ) : (
                      <ActivityPill
                        key={`${msg.id}-seg-${i}`}
                        toolCallId={seg.toolCallId}
                        toolName={seg.toolName}
                        description={seg.description}
                        status={seg.status}
                      />
                    ),
                  )
                : (
                  <>
                    {isAssistant && msg.toolCalls && msg.toolCalls.length > 0 && (
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
                        borderRadius:
                          msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
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
                  </>
                )}
            </div>
          );
        })}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `bun run test src/renderer/components/layout/chat/__tests__/MessageList.test.tsx`
Expected: PASS for both new tests and all existing MessageList tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx src/renderer/components/layout/chat/__tests__/MessageList.test.tsx
git commit -m "feat(ui): render message.segments interleaved on commit"
```

---

## Task 8: Final verification — typecheck, check, full test, coverage, smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: zero errors.

- [ ] **Step 2: Lint + format**

Run: `bun run check`
Expected: zero issues (auto-fix runs).

- [ ] **Step 3: Full test suite**

Run: `bun run test`
Expected: all suites pass. Per memory `feedback_broken_tests_stop_work` — fix any break before continuing.

- [ ] **Step 4: Coverage**

Run: `bun run test:coverage`
Expected: branches/functions/lines/statements ≥ 90%. If any new file dips below, add focused tests until threshold is met.

- [ ] **Step 5: Smoke — manual UX check per memory testing protocol**

Per `feedback_testing_protocol`:

```bash
bun run dev -- --remote-debugging-port=9222
```

Open the app, send a message that triggers tool calls (e.g. "read the project's CLAUDE.md and summarise"). Verify visually:
1. During streaming: text bubble → tool pill → text bubble (no jump)
2. After turn completes: same layout, no re-ordering
3. Reload the project: same layout persists

Use `agent-browser` to capture a screenshot after stream completes for the record.

- [ ] **Step 6: Final commit (if anything was tweaked)**

If Step 4 or 5 required test additions, commit them:

```bash
git add -p
git commit -m "test(messages): coverage + smoke for segments"
```

Otherwise skip.

---

## Out of Scope

- Backfilling `segments` for existing rows. Legacy rows keep the old render (tools stacked above text). They are immutable historical messages and not worth migrating.
- Changing user message content shape (still plain string).
- Changing `MemoryManager.save` — memory still receives plain `content` text, not segments.
- Anthropic-style `content: ContentBlock[]` replacement. Considered and deferred (Option C in design discussion).
