# Prompt Architecture Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move conversation history from system prompt to the agent's messages array, keep system prompt static, and add dynamic token-aware pruning before LLM calls.

**Architecture:** `MemoryManager` loads a working set (last 100 messages) into agent state. `AgentSession` seeds `initialState.messages` from this working set and passes a `transformContext` function that prunes messages to fit the model's context window before each LLM call. The system prompt stays static (identity + summary + context files).

**Tech Stack:** TypeScript, `pi-agent-core`, `@mastra/libsql`, Vitest

---

## File Map

| File | Responsibility | Action |
|---|---|---|
| `src/main/services/MemoryManager.ts` | Load working set from DB | Modify: change `buildContext` signature, load last 100 messages |
| `src/main/agent/session.ts` | Agent session lifecycle | Modify: seed messages array, remove historyBlock from system prompt, add `transformContext` |
| `src/main/ipc/chat-handlers.ts` | IPC handler registration | Modify: remove `maxRecent` parameter from `buildContext` call |
| `src/main/services/__tests__/MemoryManager.test.ts` | MemoryManager tests | Modify: update tests for new `buildContext` signature and working set size |
| `src/main/agent/session.test.ts` | AgentSession tests | Modify: update tests for messages array injection and system prompt changes |

---

## Task 1: Update `IMemoryManager` Interface and `MemoryManager`

**Files:**
- Modify: `src/main/services/MemoryManager.ts`
- Test: `src/main/services/__tests__/MemoryManager.test.ts`

**Goal:** Change `buildContext` to take only `projectId` and load the last `WORKING_SET_MESSAGES` (100) messages from DB.

---

- [ ] **Step 1: Write the failing test**

Add a new test in `MemoryManager.test.ts` that expects `buildContext` to take only one argument and return last 100 messages:

```typescript
it("loads last WORKING_SET_MESSAGES (100) messages without maxRecent parameter", async () => {
  const manyMessages = Array.from({ length: 150 }, (_, i) =>
    makeMastraMessage(i % 2 === 0 ? "user" : "assistant", `msg-${i}`),
  );
  mockMemoryStore.listMessages.mockResolvedValue({ messages: manyMessages });

  const ctx = await manager.buildContext("proj-1");

  expect(ctx.recentMessages).toHaveLength(100);
  expect(ctx.recentMessages[0].content).toBe("msg-50"); // last 100 = msg-50 to msg-149
  expect(ctx.recentMessages[99].content).toBe("msg-149");
});
```

Run: `bun test src/main/services/__tests__/MemoryManager.test.ts`
Expected: FAIL — `buildContext` still expects 2 arguments

---

- [ ] **Step 2: Update the interface and implementation**

In `src/main/services/MemoryManager.ts`:

1. Add constant at module level:
```typescript
const WORKING_SET_MESSAGES = 100;
```

2. Change interface:
```typescript
export interface IMemoryManager {
  buildContext(projectId: string): Promise<MemoryContext>;
  save(projectId: string, turns: Array<{ role: "user" | "assistant"; content: string }>): Promise<void>;
}
```

3. Change `buildContext` signature and query:
```typescript
async buildContext(projectId: string): Promise<MemoryContext> {
  try {
    const store = await this.getStore();
    const memoryStore = await store.getStore("memory");
    if (!memoryStore) return { summary: "", recentMessages: [] };

    // Retrieve summary stored as metadata on a dedicated summary thread
    let summary = "";
    try {
      const summaryThread = await memoryStore.getThreadById({
        threadId: `${projectId}-summary`,
      });
      summary = (summaryThread?.metadata as { summary?: string } | undefined)?.summary ?? "";
    } catch {
      // No summary thread yet — first session
    }

    // Retrieve working set for agent state (last N messages)
    let recentMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      // Fetch newest first, then reverse to chronological order
      const result = await memoryStore.listMessages({
        threadId: projectId,
        perPage: WORKING_SET_MESSAGES,
        orderBy: { field: "createdAt", direction: "DESC" },
      });
      recentMessages = result.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .reverse() // chronological order for agent replay
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: extractTextContent(m.content),
        }));
    } catch {
      // No messages yet
    }

    return { summary, recentMessages };
  } catch (err) {
    console.error("[MemoryManager] buildContext failed — returning empty context:", err);
    return { summary: "", recentMessages: [] };
  }
}
```

Run: `bun test src/main/services/__tests__/MemoryManager.test.ts`
Expected: FAIL — tests still call `buildContext("proj-1", 10)` with two args

---

- [ ] **Step 3: Update all existing tests**

In `MemoryManager.test.ts`, replace all `manager.buildContext("proj-1", 10)` with `manager.buildContext("proj-1")`.

Also update the "respects maxRecent" test to "respects WORKING_SET_MESSAGES":
```typescript
it("respects WORKING_SET_MESSAGES by passing it as perPage to listMessages", async () => {
  await manager.buildContext("proj-1");

  expect(mockMemoryStore.listMessages).toHaveBeenCalledWith(
    expect.objectContaining({
      perPage: 100,
      orderBy: { field: "createdAt", direction: "DESC" },
    }),
  );
});
```

Run: `bun test src/main/services/__tests__/MemoryManager.test.ts`
Expected: PASS

---

- [ ] **Step 4: Commit**

```bash
git add src/main/services/MemoryManager.ts src/main/services/__tests__/MemoryManager.test.ts
git commit -m "refactor: change buildContext to load working set of 100 messages

- Remove maxRecent parameter from IMemoryManager.buildContext
- Load last 100 messages (WORKING_SET_MESSAGES) from DB
- Order by DESC then reverse for chronological agent replay
- Update tests for new signature and behavior"
```

---

## Task 2: Update `chat-handlers.ts`

**Files:**
- Modify: `src/main/ipc/chat-handlers.ts`

**Goal:** Remove `maxRecent` parameter from `memoryManager.buildContext` call.

---

- [ ] **Step 1: Make the change**

In `src/main/ipc/chat-handlers.ts` around line 113:

```typescript
// BEFORE
const initialMemoryContext = await memoryManager.buildContext(projectId, 20);

// AFTER
const initialMemoryContext = await memoryManager.buildContext(projectId);
```

---

- [ ] **Step 2: Verify with typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors)

---

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/chat-handlers.ts
git commit -m "refactor: remove maxRecent from buildContext call"
```

---

## Task 3: Refactor `AgentSession` — Constructor

**Files:**
- Modify: `src/main/agent/session.ts`
- Test: `src/main/agent/session.test.ts`

**Goal:** Load working set messages into `initialState.messages`, remove `historyBlock` from system prompt.

---

- [ ] **Step 1: Write failing test for messages array injection**

In `session.test.ts`, update the test that checks recent messages in system prompt:

```typescript
// REPLACE the existing test "injects recent messages as conversation history block when non-empty"
it("seeds initialState.messages with recent messages from memory context", async () => {
  const { Agent } = await import("@mariozechner/pi-agent-core");
  new AgentSession({
    eventBus: makeEventBus(),
    messageService: makeMessageService() as never,
    homeService: makeHomeService() as never,
    researchService: makeResearchService() as never,
    memoryManager: makeMemoryManager() as never,
    initialMemoryContext: {
      summary: "",
      recentMessages: [
        { role: "user", content: "Hello from last session" },
        { role: "assistant", content: "Hi there from last session" },
      ],
    },
    projectId: "p-1",
    projectName: "Test",
    folderPath: null,
    provider: {
      type: "openrouter",
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
    },
    isFirstRun: false,
    systemContext: "",
    langfuseEnabled: false,
    allowlistService: new AllowlistService() as never,
  });
  const lastCall = vi.mocked(Agent).mock.calls.at(-1);
  const initialMessages = (lastCall?.[0] as { initialState: { messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }> } })?.initialState?.messages;

  expect(initialMessages).toHaveLength(2);
  expect(initialMessages?.[0].role).toBe("user");
  expect(initialMessages?.[0].content).toEqual([{ type: "text", text: "Hello from last session" }]);
  expect(initialMessages?.[1].role).toBe("assistant");
  expect(initialMessages?.[1].content).toEqual([{ type: "text", text: "Hi there from last session" }]);
});
```

Also update the test "does not include history in system prompt":
```typescript
it("does not inject conversation history into system prompt", async () => {
  const { Agent } = await import("@mariozechner/pi-agent-core");
  new AgentSession({
    eventBus: makeEventBus(),
    messageService: makeMessageService() as never,
    homeService: makeHomeService() as never,
    researchService: makeResearchService() as never,
    memoryManager: makeMemoryManager() as never,
    initialMemoryContext: {
      summary: "",
      recentMessages: [
        { role: "user", content: "Hello from last session" },
      ],
    },
    projectId: "p-1",
    projectName: "Test",
    folderPath: null,
    provider: {
      type: "openrouter",
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
    },
    isFirstRun: false,
    systemContext: "",
    langfuseEnabled: false,
    allowlistService: new AllowlistService() as never,
  });
  const lastCall = vi.mocked(Agent).mock.calls.at(-1);
  const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState?.systemPrompt;
  expect(prompt).not.toContain("Hello from last session");
  expect(prompt).not.toContain("<conversation_history>");
});
```

Run: `bun test src/main/agent/session.test.ts`
Expected: FAIL — constructor still puts history in system prompt

---

- [ ] **Step 2: Refactor constructor**

In `src/main/agent/session.ts`, around the constructor:

1. Remove `formatConversationHistory` function entirely (lines 26-31):
```typescript
// DELETE this function
function formatConversationHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
}
```

2. Update constructor to load messages into `initialState.messages`:

```typescript
// BEFORE (around line 107)
const homePath = homeService.getHomePath();
const historyBlock = formatConversationHistory(initialMemoryContext.recentMessages);

const systemPrompt = [
  isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
  initialMemoryContext.summary,
  historyBlock,
  systemContext,
]
  .filter(Boolean)
  .join("\n\n");

// AFTER
const homePath = homeService.getHomePath();

const systemPrompt = [
  isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
  initialMemoryContext.summary,
  systemContext,
]
  .filter(Boolean)
  .join("\n\n");

const initialMessages = initialMemoryContext.recentMessages.map((m) => ({
  role: m.role,
  content: [{ type: "text" as const, text: m.content }],
  timestamp: Date.now(),
}));
```

3. Update `Agent` constructor call to include `messages` and `transformContext`:

```typescript
this.agent = new Agent({
  initialState: {
    systemPrompt,
    model: createModel({ provider, langfuseEnabled }),
    tools,
    messages: initialMessages,
  },
  transformContext: createTransformContext(provider.model),
  getApiKey: async () => (provider.type === "ollama" ? "ollama" : provider.apiKey),
  beforeToolCall: async (ctx) => {
    const allowed = new Set(tools.map((t) => t.name));
    if (!allowed.has(ctx.toolCall.name)) {
      return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
    }
    return undefined;
  },
});
```

Run: `bun test src/main/agent/session.test.ts`
Expected: FAIL — `createTransformContext` not defined yet

---

- [ ] **Step 3: Implement `createTransformContext`**

Add at module level in `session.ts`:

```typescript
const RESERVED_TOKENS = 6000; // system prompt + tools + response buffer
const CHARS_PER_TOKEN = 4;

function createTransformContext(modelId: string) {
  // Get context window from model ID (fallback to 128k)
  const contextWindow = getContextWindow(modelId);

  return async (messages: Array<{ role: string; content: unknown }>): Promise<typeof messages> => {
    const availableTokens = contextWindow - RESERVED_TOKENS;
    let estimatedTokens = 0;
    const pruned: typeof messages = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const text = extractMessageText(msg);
      const msgTokens = Math.ceil(text.length / CHARS_PER_TOKEN);

      if (estimatedTokens + msgTokens > availableTokens) {
        // Always include the last user message
        if (msg.role === "user" && pruned.length === 0) {
          pruned.unshift(msg);
        }
        break;
      }

      estimatedTokens += msgTokens;
      pruned.unshift(msg);
    }

    return pruned;
  };
}

function getContextWindow(modelId: string): number {
  // Known models
  if (modelId.includes("claude-3-opus")) return 200_000;
  if (modelId.includes("claude-3-5-sonnet") || modelId.includes("claude-sonnet-4")) return 200_000;
  if (modelId.includes("claude-3-haiku") || modelId.includes("claude-haiku-4")) return 200_000;
  if (modelId.includes("gpt-4o")) return 128_000;
  if (modelId.includes("gpt-4-turbo")) return 128_000;
  if (modelId.includes("gpt-4")) return 8_192;
  if (modelId.includes("gpt-3.5")) return 16_384;
  // Default fallback
  return 128_000;
}

function extractMessageText(msg: { role: string; content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c) => (typeof c === "object" && c !== null ? (c as { text?: string }).text ?? "" : ""))
      .join("");
  }
  return "";
}
```

Run: `bun test src/main/agent/session.test.ts`
Expected: PASS

---

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "refactor: load conversation history into messages array, not system prompt

- Remove formatConversationHistory and historyBlock from system prompt
- Seed initialState.messages from MemoryManager working set
- Add transformContext for dynamic token-aware pruning before LLM calls
- Add getContextWindow helper for known models
- Update tests: history in messages array, not system prompt"
```

---

## Task 4: Refactor `AgentSession` — `send()` Method

**Files:**
- Modify: `src/main/agent/session.ts`
- Test: `src/main/agent/session.test.ts`

**Goal:** Stop rebuilding system prompt with `historyBlock` on every turn. Only rebuild when summary or context files change.

---

- [ ] **Step 1: Write failing test for system prompt stability**

In `session.test.ts`, update the "system prompt refresh" test:

```typescript
describe("system prompt refresh", () => {
  it("does NOT update systemPrompt when summary and context are unchanged", async () => {
    const { buildSystemContext } = await import("./context");
    (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValue("unchanged context");

    const memoryManager = makeMemoryManager();
    (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: "unchanged summary",
      recentMessages: [],
    });

    const localSession = new AgentSession({
      eventBus: makeEventBus(),
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", recentMessages: [] },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      provider: {
        type: "openrouter",
        apiKey: "sk-or-test",
        model: "anthropic/claude-sonnet-4-6",
      },
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
      allowlistService: new AllowlistService() as never,
    });

    // First send establishes system prompt
    await localSession.send("hello");
    const firstPrompt = mockAgent.state.systemPrompt;

    // Second send with same context should not change system prompt
    vi.clearAllMocks();
    await localSession.send("hello again");
    const secondPrompt = mockAgent.state.systemPrompt;

    expect(secondPrompt).toBe(firstPrompt);
  });

  it("updates systemPrompt when summary changes", async () => {
    const { buildSystemContext } = await import("./context");
    (buildSystemContext as ReturnType<typeof vi.fn>).mockResolvedValue("unchanged context");

    const memoryManager = makeMemoryManager();
    let callCount = 0;
    (memoryManager.buildContext as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        summary: callCount === 1 ? "first summary" : "updated summary",
        recentMessages: [],
      });
    });

    const localSession = new AgentSession({
      eventBus: makeEventBus(),
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", recentMessages: [] },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      provider: {
        type: "openrouter",
        apiKey: "sk-or-test",
        model: "anthropic/claude-sonnet-4-6",
      },
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
      allowlistService: new AllowlistService() as never,
    });

    await localSession.send("hello");
    const firstPrompt = mockAgent.state.systemPrompt;
    expect(firstPrompt).toContain("first summary");

    await localSession.send("hello again");
    const secondPrompt = mockAgent.state.systemPrompt;
    expect(secondPrompt).toContain("updated summary");
    expect(secondPrompt).not.toBe(firstPrompt);
  });
});
```

Run: `bun test src/main/agent/session.test.ts`
Expected: FAIL — `send()` still rebuilds system prompt every turn

---

- [ ] **Step 2: Refactor `send()` to only rebuild system prompt when changed**

In `src/main/agent/session.ts`, replace the system prompt rebuild in `send()`:

```typescript
// BEFORE (around line 246)
const memoryContext = await this.memoryManager.buildContext(this.projectId, 20);
const historyBlock = formatConversationHistory(memoryContext.recentMessages);
const systemContext = await buildSystemContext(
  this.projectName,
  this.folderPath ?? undefined,
  this.skillRouter.toXml(),
);

const systemPrompt = [
  BASE_SYSTEM_PROMPT,
  memoryContext.summary,
  historyBlock,
  systemContext,
]
  .filter(Boolean)
  .join("\n\n");
this.agent.state.systemPrompt = systemPrompt;

// AFTER
const memoryContext = await this.memoryManager.buildContext(this.projectId);
const systemContext = await buildSystemContext(
  this.projectName,
  this.folderPath ?? undefined,
  this.skillRouter.toXml(),
);

const newSystemPrompt = [BASE_SYSTEM_PROMPT, memoryContext.summary, systemContext]
  .filter(Boolean)
  .join("\n\n");

if (newSystemPrompt !== this.agent.state.systemPrompt) {
  this.agent.state.systemPrompt = newSystemPrompt;
}
```

Run: `bun test src/main/agent/session.test.ts`
Expected: PASS

---

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "refactor: only rebuild system prompt when summary or context changes

- Remove historyBlock from send() rebuild logic
- Compare newSystemPrompt against current before assigning
- System prompt stays stable across turns (enables prompt caching)
- Add tests for stable prompt and summary-change detection"
```

---

## Task 5: Final Verification

---

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```
Expected: PASS (zero errors)

---

- [ ] **Step 2: Run full test suite**

```bash
bun test
```
Expected: All tests pass

---

- [ ] **Step 3: Run lint/format check**

```bash
bun run check
```
Expected: Clean (no issues)

---

- [ ] **Step 4: Manual test — close and reopen project**

1. Start app: `bun run dev`
2. Send 5 messages in a project
3. Close the app
4. Reopen the app, select the same project
5. Verify: all 5 messages appear, conversation continues seamlessly
6. Send a 6th message
7. Verify: system prompt did not change on turns 2–6 (check Langfuse cache metrics if enabled)

---

- [ ] **Step 5: Final commit**

```bash
git commit -m "feat: static system prompt, messages array holds conversation history

Phase 1 of prompt architecture fix:
- MemoryManager loads working set of 100 messages (not 20)
- AgentSession seeds messages array from working set
- System prompt stays static (identity + summary + context)
- transformContext prunes messages to fit model context window
- Enables Anthropic prompt caching (cache hits on 99% of turns)"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** All Phase 1 requirements from the spec are covered by tasks
- [ ] **No placeholders:** Every step has exact file paths and code
- [ ] **Type consistency:** `buildContext` signature is `(projectId: string)` everywhere
- [ ] **Test coverage:** Both MemoryManager and AgentSession tests updated
- [ ] **No breaking changes to UI:** `MessageService.getHistory` still returns all messages

**Gaps found:** None. All spec requirements map to tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-prompt-architecture-fix.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
