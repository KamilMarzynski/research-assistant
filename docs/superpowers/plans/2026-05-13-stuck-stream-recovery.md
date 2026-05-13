# Stuck Stream Recovery + Stop Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 300-second auto-clear timeout for stuck streams, a stop button to interrupt active streams, and clean up empty DB placeholders on abort/error.

**Architecture:** Per-project timer in `StreamStateContext`, stop button in `MessageInput` that fires `ABORT_MESSAGE` IPC, `MessagePipeline.abort()` that cleans up the DB placeholder, and `deleteMessage` on the repository layer.

**Tech Stack:** React 19, Electron IPC, Drizzle ORM, Vitest, Biome, @mariozechner/pi-agent-core

---

## File Map

| File | Responsibility |
|---|---|
| `src/shared/ipc-channels.ts` | Add `ABORT_MESSAGE` channel constant |
| `src/main/ipc-validation.ts` | Add `AbortMessageSchema` (projectId only) |
| `src/main/repositories/IMessageRepository.ts` | Add `deleteMessage(id)` to interface |
| `src/main/repositories/drizzle/DrizzleMessageRepository.ts` | Implement `deleteMessage` |
| `src/main/services/MessageService.ts` | Expose `deleteMessage` |
| `src/main/agent/MessagePipeline.ts` | Add `abort()` with placeholder cleanup |
| `src/main/agent/session.ts` | Extend `abort()` to delegate to `pipeline.abort()` |
| `src/main/ipc/chat-handlers.ts` | Register `ABORT_MESSAGE` handler |
| `src/renderer/contexts/StreamStateContext.tsx` | Add 300 s per-project timer |
| `src/renderer/components/shared/Icons.tsx` | Add `IconStop` square icon |
| `src/renderer/components/layout/chat/MessageInput.tsx` | Show stop button when processing |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Wire `onAbort` prop to `MessageInput` |
| `src/main/agent/session.test.ts` | Test abort cleanup paths |
| `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts` | Test `deleteMessage` |
| `src/main/services/__tests__/MessageService.test.ts` | Test `deleteMessage` delegation |

---

### Task 1: Add ABORT_MESSAGE IPC channel and schema

**Files:**
- Modify: `src/shared/ipc-channels.ts:60`
- Modify: `src/main/ipc-validation.ts:96`

- [ ] **Step 1: Add channel constant**

In `src/shared/ipc-channels.ts`, add `ABORT_MESSAGE` to the constants object:

```typescript
  ABORT_MESSAGE: "ABORT_MESSAGE",
```

Place it after `SET_PROJECT_MODEL` and before the closing `} as const;`.

- [ ] **Step 2: Add validation schema**

In `src/main/ipc-validation.ts`, add after `DeleteSkillSchema`:

```typescript
export const AbortMessageSchema = z.object({
  projectId: z.string(),
});
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc-validation.ts
git commit -m "feat: add ABORT_MESSAGE IPC channel and schema

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Add deleteMessage to repository layer

**Files:**
- Modify: `src/main/repositories/IMessageRepository.ts`
- Modify: `src/main/repositories/drizzle/DrizzleMessageRepository.ts`
- Test: `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`, add after the `getRecent` describe block:

```typescript
  describe("deleteMessage", () => {
    it("removes the message from the database", async () => {
      const msg = await repo.create({ projectId, role: "user", content: "Delete me" });
      await repo.deleteMessage(msg.id);
      const remaining = await repo.listByProject(projectId);
      expect(remaining).toHaveLength(0);
    });

    it("does not throw when id does not exist", async () => {
      await expect(repo.deleteMessage("non-existent-id")).resolves.toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
```

Expected: FAIL with `repo.deleteMessage is not a function`

- [ ] **Step 3: Add deleteMessage to interface**

In `src/main/repositories/IMessageRepository.ts`, add to the interface:

```typescript
  deleteMessage(id: string): Promise<void>;
```

- [ ] **Step 4: Implement deleteMessage in DrizzleMessageRepository**

In `src/main/repositories/drizzle/DrizzleMessageRepository.ts`, add after `updateContent`:

```typescript
  async deleteMessage(id: string): Promise<void> {
    await this.db.delete(messages).where(eq(messages.id, id));
  }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/repositories/IMessageRepository.ts src/main/repositories/drizzle/DrizzleMessageRepository.ts src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
git commit -m "feat: add deleteMessage to message repository

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Add deleteMessage to MessageService

**Files:**
- Modify: `src/main/services/MessageService.ts`
- Test: `src/main/services/__tests__/MessageService.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/services/__tests__/MessageService.test.ts`, add after the `addMessage` describe block:

```typescript
  describe("deleteMessage", () => {
    it("delegates to repo.deleteMessage", async () => {
      await service.deleteMessage("msg-123");
      expect(repo.deleteMessage).toHaveBeenCalledWith("msg-123");
    });
  });
```

Also update `makeMockRepo` to include `deleteMessage`:

```typescript
function makeMockRepo(overrides: Partial<IMessageRepository> = {}): IMessageRepository {
  return {
    create: vi.fn().mockResolvedValue(makeMessage()),
    updateContent: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    listByProject: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/main/services/__tests__/MessageService.test.ts
```

Expected: FAIL with `service.deleteMessage is not a function`

- [ ] **Step 3: Implement deleteMessage on MessageService**

In `src/main/services/MessageService.ts`, add after `updateMessage`:

```typescript
  async deleteMessage(id: string): Promise<void> {
    return this.repo.deleteMessage(id);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/main/services/__tests__/MessageService.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/MessageService.ts src/main/services/__tests__/MessageService.test.ts
git commit -m "feat: expose deleteMessage on MessageService

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add MessagePipeline.abort() with placeholder cleanup

**Files:**
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`

- [ ] **Step 1: Implement abort() on MessagePipeline**

In `src/main/agent/MessagePipeline.ts`, add after `queueFollowUp`:

```typescript
  abort(): void {
    this.agent.abort();

    const content = this.state.assistantContent;
    const streamingId = this.state.streamingMessageId;

    if (streamingId) {
      if (content === "") {
        void this.messageService.deleteMessage(streamingId).catch((err) => {
          console.error("[AgentSession] failed to delete empty placeholder:", err);
        });
      } else {
        void this.messageService.updateMessage(streamingId, content).catch((err) => {
          console.error("[AgentSession] failed to finalize partial message:", err);
        });
      }
      this.state.streamingMessageId = null;
    }

    this.state.assistantContent = "";
    this.state.lastUserContent = "";
    this.state.streamChunkCount = 0;
    this.state.processing = false;

    this.eventBus.emit({ type: "agent:done", payload: { projectId: this.projectId } });
  }
```

- [ ] **Step 2: Extend AgentSession.abort()**

In `src/main/agent/session.ts`, replace the existing `abort()` method:

```typescript
  abort(): void {
    this.pipeline.abort();
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/MessagePipeline.ts src/main/agent/session.ts
git commit -m "feat: add abort() to MessagePipeline with placeholder cleanup

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Register ABORT_MESSAGE handler in chat-handlers

**Files:**
- Modify: `src/main/ipc/chat-handlers.ts`

- [ ] **Step 1: Import AbortMessageSchema**

At the top of `src/main/ipc/chat-handlers.ts`, add `AbortMessageSchema` to the destructured imports from `../ipc-validation`:

```typescript
import { ProjectIdSchema, SendMessageSchema, AbortMessageSchema } from "../ipc-validation";
```

- [ ] **Step 2: Register the handler**

At the end of `registerChatHandler`, after the `SEND_MESSAGE` handler block (after line 196), add:

```typescript
  ipcMain.handle(IPC.ABORT_MESSAGE, async (_event, payload: unknown) => {
    const parsed = parseOrThrow(AbortMessageSchema, payload, "ABORT_MESSAGE");
    const session = sessionManager.get(parsed.projectId);
    session?.abort();
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/chat-handlers.ts
git commit -m "feat: register ABORT_MESSAGE IPC handler

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Add 300 s timer to StreamStateContext

**Files:**
- Modify: `src/renderer/contexts/StreamStateContext.tsx`

- [ ] **Step 1: Add timer refs and helper**

Replace the entire `StreamStateProvider` function body with:

```typescript
export function StreamStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ProjectStreamState>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const STREAM_TIMEOUT_MS = 300_000;

  const clearTimer = (projectId: string) => {
    const timer = timersRef.current[projectId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[projectId];
    }
  };

  const startTimer = (projectId: string) => {
    clearTimer(projectId);
    timersRef.current[projectId] = setTimeout(() => {
      setStates((prev) => {
        const next = { ...prev };
        if (next[projectId]) {
          next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
        }
        return next;
      });
    }, STREAM_TIMEOUT_MS);
  };

  const startStream = (projectId: string) => {
    setStates((prev) => {
      const existing = prev[projectId];
      return {
        ...prev,
        [projectId]: {
          streamingContent: existing?.streamingContent ?? null,
          processing: true,
        },
      };
    });
    startTimer(projectId);
  };

  const endStream = (projectId: string) => {
    clearTimer(projectId);
    setStates((prev) => {
      const next = { ...prev };
      if (next[projectId]) {
        next[projectId] = { ...next[projectId], streamingContent: null, processing: false };
      }
      return next;
    });
  };

  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (data) => {
      const chunk = decodeMessageChunk(data);
      if (chunk === null) return;
      const { projectId, delta } = chunk;
      if (!projectId) return;

      setStates((prev) => {
        const existing = prev[projectId];
        if (!existing) {
          return {
            ...prev,
            [projectId]: { streamingContent: delta, processing: true },
          };
        }
        return {
          ...prev,
          [projectId]: {
            ...existing,
            streamingContent: (existing.streamingContent ?? "") + delta,
            processing: true,
          },
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

    return () => {
      unsubChunk();
      unsubDone();
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, []);

  return (
    <StreamStateContext.Provider value={{ states, startStream, endStream }}>
      {children}
    </StreamStateContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/contexts/StreamStateContext.tsx
git commit -m "feat: add 300s per-project stream timeout to StreamStateContext

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Add IconStop to Icons.tsx

**Files:**
- Modify: `src/renderer/components/shared/Icons.tsx`

- [ ] **Step 1: Add IconStop component**

In `src/renderer/components/shared/Icons.tsx`, add after `IconSend` (or at an appropriate location):

```typescript
export function IconStop({ size = 16, strokeColor = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/shared/Icons.tsx
git commit -m "feat: add IconStop square icon

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Add stop button to MessageInput

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`

- [ ] **Step 1: Import IconStop and add onAbort prop**

At the top, add `IconStop` to the imports:

```typescript
import { IconChevD, IconCpu, IconSend, IconStop } from "../../shared/Icons";
```

Add `onAbort` to the props interface:

```typescript
interface MessageInputProps {
  onSend: (content: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  projectId: string;
  projectModelOverride: string | null;
}
```

Add `onAbort` to the destructured props:

```typescript
export default function MessageInput({
  onSend,
  onAbort,
  disabled,
  projectId,
  projectModelOverride,
}: MessageInputProps) {
```

- [ ] **Step 2: Replace send button with conditional send/stop**

Replace the send button block (lines 234–242) with:

```typescript
              {disabled ? (
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={onAbort}
                  data-testid="stop-btn"
                >
                  <IconStop size={13} /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={handleSend}
                  disabled={!content.trim() || disabled}
                  data-testid="send-btn"
                >
                  <IconSend size={13} /> Send
                </button>
              )}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/chat/MessageInput.tsx
git commit -m "feat: add stop button to MessageInput

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Wire stop button in ChatPanel

**Files:**
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`

- [ ] **Step 1: Add handleAbort and pass to MessageInput**

In `ChatPanel.tsx`, add `handleAbort` after `handleSend`:

```typescript
  const handleAbort = () => {
    if (!activeProjectId) return;
    void window.electronAPI.invoke(IPC.ABORT_MESSAGE, { projectId: activeProjectId });
  };
```

Pass `onAbort` to `MessageInput`:

```typescript
        <MessageInput
          onSend={handleSend}
          onAbort={handleAbort}
          disabled={processing || streamingContent !== null}
          projectId={activeProjectId}
          projectModelOverride={activeProject?.modelOverride ?? null}
        />
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "feat: wire stop button to ABORT_MESSAGE IPC

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Update session tests for abort cleanup

**Files:**
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Add abort placeholder tests**

In `session.test.ts`, add after the `turn deduplication` describe block:

```typescript
  describe("abort()", () => {
    it("deletes empty placeholder when aborted during thinking", async () => {
      const sendPromise = session.send("my question");
      // Abort before any chunks arrive
      session.abort();
      await sendPromise.catch(() => {}); // prompt may reject after abort

      expect(messageService.deleteMessage).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });

    it("finalizes partial content when aborted mid-stream", async () => {
      await session.send("my question");
      await triggerEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Partial" },
      });
      session.abort();

      expect(messageService.updateMessage).toHaveBeenCalledWith(
        expect.any(String),
        "Partial",
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent:done", payload: { projectId: "p-1" } }),
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun test src/main/agent/session.test.ts
```

Expected: PASS (all tests in the file)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/session.test.ts
git commit -m "test: abort cleanup paths for empty and partial placeholders

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Full validation

- [ ] **Step 1: Type check**

```bash
bun run typecheck
```

Expected: zero errors

- [ ] **Step 2: Lint and format**

```bash
bun run check
```

Expected: clean, no fixes needed (or auto-applied)

- [ ] **Step 3: Run full test suite**

```bash
bun run test
```

Expected: all 622+ tests pass

- [ ] **Step 4: Commit any auto-fixes**

```bash
git diff --quiet || git commit -m "style: biome auto-fixes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**
- 300s auto-clear timer in `StreamStateContext` → Task 6
- Stop button in `MessageInput` → Tasks 7–9
- `ABORT_MESSAGE` IPC handler → Tasks 1, 5
- `MessagePipeline.abort()` with placeholder cleanup → Task 4
- `deleteMessage` on repository/service → Tasks 2–3
- Timeout vs abort race (handler returns silently if session missing) → Task 5
- Multiple projects isolation (timer per project) → Task 6

**Placeholder scan:**
- No "TBD", "TODO", or vague requirements
- Every step shows exact file paths and code
- Every step shows exact test commands and expected output

**Type consistency:**
- `deleteMessage(id: string): Promise<void>` used consistently across interface, repository, service, and tests
- `ABORT_MESSAGE` schema uses `projectId: z.string()` matching other schemas
- `IconStop` follows existing `IconProps` pattern

**Gaps found and fixed:**
- Added `AbortMessageSchema` to `ipc-validation.ts` (was missing in initial draft)
- Added `IconStop` to `Icons.tsx` (was missing in initial draft)
- Added `useRef` import check for `StreamStateContext` (already imported in current file)
