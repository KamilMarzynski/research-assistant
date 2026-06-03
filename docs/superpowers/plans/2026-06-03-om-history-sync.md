# OM History Sync (Option C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop double-paying for tokens once Mastra Observational Memory (OM) compresses chat history into a summary. Make Mastra the authoritative source for chat history when observations exist; reset Pi agent's in-memory message list each turn from Mastra's cursor-filtered tail.

**Architecture:** Today the chat history is forked: Pi keeps `agent.state.messages` in-memory (grows organically), while Mastra OM tracks the same messages in libsql plus an observation cursor. After OM observes, Pi keeps sending the *raw* compressed messages on top of the new summary — paying for both. Fix: surface `hasObservations` from `MemoryManager.buildContext()`, then in `MessagePipeline.send()` replace `agent.state.messages` with the Mastra-filtered tail when observations exist. When no observations yet (cold start, below threshold), keep current organic-growth behavior.

**Tech Stack:** TypeScript, Electron main process, `@mastra/memory`, `@mariozechner/pi-agent-core`, TSyringe, Vitest.

---

## Spec

### In scope
1. Extend `MemoryContext` to carry `hasObservations: boolean` plus rename `recentMessages` → `historyMessages` for clarity.
2. Extract `toAgentMessages(history)` helper used both at session construction and inside `send()`.
3. In `MessagePipeline.send()`, when `memoryContext.hasObservations === true`, replace `this.agent.state.messages` with `toAgentMessages(memoryContext.historyMessages)` **before** `this.agent.prompt(content)`.
4. When `hasObservations === false`, leave `agent.state.messages` untouched (current organic-growth behavior).
5. Update all consumers of `MemoryContext` (production + tests) for the new field shape.
6. Remove the `[MM-DIAG]` diagnostic logs added during Phase 1 (no longer needed after Phase 3 verification).

### Out of scope (deferred)
- Settings UX for OM model + API key (still hardcoded `ollama-cloud/gemma4:31b`).
- Tuning `messageTokens` threshold and observation/reflection cadence.
- Replaying tool-call history mid-session — we accept that resetting Pi state drops tool turns from the unobserved tail; the OM summary captures their intent. (Tool calls are already not persisted by `MemoryManager.save()`.)
- Token-count alignment between Mastra `pendingTokens` and Langfuse — they measure different things by design.

### Acceptance criteria
- `MemoryContext` exports `{ summary, historyMessages, hasObservations }`. No call sites reference `recentMessages` anymore.
- `MessagePipeline` constructor still seeds `agent.state.messages` from `historyMessages` on first build.
- Calling `send()` when `hasObservations === true` replaces `agent.state.messages` with the freshly fetched tail; when `hasObservations === false`, the array is untouched.
- `bun run typecheck` and `bun run check` both clean.
- `bun run test` passes with coverage thresholds intact (90% branches/functions/lines/statements).
- `[MM-DIAG]` strings absent from `MemoryManager.ts`.

### Observable signal after rollout
On a project past the OM threshold, `[MM-DIAG] buildContext` (before removal) showed `hasObservations: true` and `systemMessageLen > 0`. Once Option C lands, the Pi prompt to the model on the next turn should contain only: system prompt (with observations block), unobserved tail of messages (small N), and the new user message — no longer the full 98-message backlog.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/main/services/MemoryManager.ts` | Modify | `MemoryContext` shape; populate `hasObservations`; rename `recentMessages` → `historyMessages`; drop `[MM-DIAG]` logs |
| `src/main/services/__tests__/MemoryManager.test.ts` | Modify | Update mocks/asserts for new field names; add test for `hasObservations` propagation |
| `src/main/agent/agent-message-mapper.ts` | Create | Pure helper `toAgentMessages(history)` — single conversion from `{role, content}[]` to `AgentMessage[]` |
| `src/main/agent/__tests__/agent-message-mapper.test.ts` | Create | Cover user/assistant shape branches |
| `src/main/agent/MessagePipeline.ts` | Modify | Use `toAgentMessages` in constructor; reset `agent.state.messages` in `send()` when `hasObservations` is true |
| `src/main/agent/session.ts` | Modify | Re-export updated type if needed (likely just a re-import line — verify) |
| `src/main/agent/session.test.ts` | Modify | Update all `recentMessages` references to `historyMessages`; add `hasObservations: false` to existing fixtures; add a test for the reset behavior |
| `src/main/agent/__tests__/turn-completion.test.ts` | Modify | Update mock `buildContext` return shape |
| `src/main/ipc/chat-handlers.ts` | No code change needed | Passes `initialMemoryContext` opaquely — only verify it still compiles |

---

## Task 1 — Extend `MemoryContext` shape

**Files:**
- Modify: `src/main/services/MemoryManager.ts`
- Test: `src/main/services/__tests__/MemoryManager.test.ts`

- [ ] **Step 1.1: Add failing test for `hasObservations` propagation**

In `src/main/services/__tests__/MemoryManager.test.ts`, inside `describe("buildContext()")`, add:

```ts
it("returns hasObservations=true when getContext reports observations", async () => {
  mockMemory.getContext.mockResolvedValue({
    systemMessage: "Prior work summary.",
    messages: [],
    hasObservations: true,
    omRecord: { activeObservations: "Prior work summary." },
    continuationMessage: undefined,
    otherThreadsContext: undefined,
  });

  const ctx = await manager.buildContext("proj-1");

  expect(ctx.hasObservations).toBe(true);
  expect(ctx.summary).toBe("Prior work summary.");
});

it("returns hasObservations=false when getContext reports no observations", async () => {
  // beforeEach default already sets hasObservations: false
  const ctx = await manager.buildContext("proj-1");

  expect(ctx.hasObservations).toBe(false);
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `bun run test src/main/services/__tests__/MemoryManager.test.ts`
Expected: 2 failures — `expect(ctx.hasObservations).toBe(true)` and `.toBe(false)`, because the field doesn't exist on the returned object yet.

- [ ] **Step 1.3: Update `MemoryContext` interface and impl**

In `src/main/services/MemoryManager.ts`:

Replace the existing `MemoryContext` interface:

```ts
export interface MemoryContext {
  summary: string;
  historyMessages: Array<{ role: "user" | "assistant"; content: string }>;
  hasObservations: boolean;
}
```

Inside `buildContext()`, change the destructured locals and return shape. Replace this block:

```ts
const summary = ctx.systemMessage ?? "";

const recentMessages = ctx.messages
  .filter((m) => m.role === "user" || m.role === "assistant")
  .map((m) => ({
    role: m.role as "user" | "assistant",
    content: extractTextContent(m.content),
  }));

return { summary, recentMessages };
```

with:

```ts
const summary = ctx.systemMessage ?? "";

const historyMessages = ctx.messages
  .filter((m) => m.role === "user" || m.role === "assistant")
  .map((m) => ({
    role: m.role as "user" | "assistant",
    content: extractTextContent(m.content),
  }));

return { summary, historyMessages, hasObservations: ctx.hasObservations === true };
```

Also update the catch-block return at the end of `buildContext()`:

```ts
return { summary: "", historyMessages: [], hasObservations: false };
```

- [ ] **Step 1.4: Update existing tests in `MemoryManager.test.ts`**

Replace every `recentMessages` with `historyMessages` (use Edit's `replace_all`). Then update every literal `{ summary: "", recentMessages: [] }` or similar shape returned/asserted in this file to also include `hasObservations: false`. Specifically affected assertions on lines 113, 146, 168, 169, 190, 222, 249, 281, 426, 431 — re-run the search if line numbers drift.

Example: `expect(ctx).toEqual({ summary: "", recentMessages: [] });`
becomes: `expect(ctx).toEqual({ summary: "", historyMessages: [], hasObservations: false });`

- [ ] **Step 1.5: Run all MemoryManager tests to verify they pass**

Run: `bun run test src/main/services/__tests__/MemoryManager.test.ts`
Expected: all pass (including the two new tests from Step 1.1).

- [ ] **Step 1.6: Commit**

```bash
git add src/main/services/MemoryManager.ts src/main/services/__tests__/MemoryManager.test.ts
git commit -m "feat(memory): expose hasObservations and rename recentMessages to historyMessages"
```

---

## Task 2 — Extract `toAgentMessages` helper

**Files:**
- Create: `src/main/agent/agent-message-mapper.ts`
- Create: `src/main/agent/__tests__/agent-message-mapper.test.ts`

- [ ] **Step 2.1: Write failing test for the helper**

Create `src/main/agent/__tests__/agent-message-mapper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toAgentMessages } from "../agent-message-mapper";

describe("toAgentMessages", () => {
  it("returns an empty array for empty input", () => {
    expect(toAgentMessages([])).toEqual([]);
  });

  it("maps user messages to plain-string content", () => {
    const result = toAgentMessages([{ role: "user", content: "hello" }]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hello");
    expect(typeof result[0].timestamp).toBe("number");
  });

  it("wraps assistant messages in a text part block", () => {
    const result = toAgentMessages([{ role: "assistant", content: "hi back" }]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toEqual([{ type: "text", text: "hi back" }]);
  });

  it("preserves order across mixed roles", () => {
    const result = toAgentMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `bun run test src/main/agent/__tests__/agent-message-mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the helper**

Create `src/main/agent/agent-message-mapper.ts`:

```ts
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function toAgentMessages(history: HistoryMessage[]): AgentMessage[] {
  return history.map((m) => ({
    role: m.role,
    content: m.role === "assistant" ? [{ type: "text" as const, text: m.content }] : m.content,
    timestamp: Date.now(),
  })) as AgentMessage[];
}
```

- [ ] **Step 2.4: Run tests to verify pass**

Run: `bun run test src/main/agent/__tests__/agent-message-mapper.test.ts`
Expected: 4 passing.

- [ ] **Step 2.5: Commit**

```bash
git add src/main/agent/agent-message-mapper.ts src/main/agent/__tests__/agent-message-mapper.test.ts
git commit -m "feat(agent): add toAgentMessages helper for history conversion"
```

---

## Task 3 — Use helper in `MessagePipeline` constructor

**Files:**
- Modify: `src/main/agent/MessagePipeline.ts`

- [ ] **Step 3.1: Replace inline mapping with helper call**

In `src/main/agent/MessagePipeline.ts`, add to the imports at the top:

```ts
import { toAgentMessages } from "./agent-message-mapper";
```

Replace this block (currently around lines 97–101):

```ts
const initialMessages = options.initialMemoryContext.recentMessages.map((m) => ({
  role: m.role,
  content: m.role === "assistant" ? [{ type: "text" as const, text: m.content }] : m.content,
  timestamp: Date.now(),
})) as import("@mariozechner/pi-agent-core").AgentMessage[];
```

with:

```ts
const initialMessages = toAgentMessages(options.initialMemoryContext.historyMessages);
```

Also update `options.initialMemoryContext.summary` consumer site if anything else still references the old field name (it should not — only `summary` and the mapped list are used at construction).

- [ ] **Step 3.2: Run typecheck to confirm no type errors**

Run: `bun run typecheck`
Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/main/agent/MessagePipeline.ts
git commit -m "refactor(agent): reuse toAgentMessages in MessagePipeline constructor"
```

---

## Task 4 — Update `session.test.ts` and `turn-completion.test.ts` fixtures

**Files:**
- Modify: `src/main/agent/session.test.ts`
- Modify: `src/main/agent/__tests__/turn-completion.test.ts`

- [ ] **Step 4.1: Update session.test.ts fixtures**

In `src/main/agent/session.test.ts`, do this in three passes using Edit:

**Pass 1 — rename field everywhere.** Run Edit with `replace_all: true`:
- `old_string`: `recentMessages`
- `new_string`: `historyMessages`

**Pass 2 — extend simple empty fixtures.** Run Edit with `replace_all: true`:
- `old_string`: `{ summary: "", historyMessages: [] }`
- `new_string`: `{ summary: "", historyMessages: [], hasObservations: false }`

**Pass 3 — fix non-empty fixtures and any leftovers.** Search the file for `historyMessages:` and inspect each context. Any object literal that contains `historyMessages` but does not yet include `hasObservations` must have `hasObservations: false` added. Specific cases to expect (line numbers may have drifted; rely on context):
- Around lines 663–668, 729–760, 773–795: `initialMemoryContext` literals with populated `historyMessages` arrays.
- Around lines 1024, 1028, 1067, 1071, 1111, 1115: standalone `{ historyMessages: [] }` objects used as `buildContext` mock returns — these also need `hasObservations: false` and a `summary: ""` if missing.

Example for a non-trivially empty case:

```ts
initialMemoryContext: {
  summary: "prior summary",
  historyMessages: [{ role: "user", content: "old" }],
}
```

becomes:

```ts
initialMemoryContext: {
  summary: "prior summary",
  historyMessages: [{ role: "user", content: "old" }],
  hasObservations: false,
}
```

After all three passes, run `grep -n "recentMessages" src/main/agent/session.test.ts` and expect no matches. Then run `grep -n "historyMessages" src/main/agent/session.test.ts` and visually scan that every match either is part of an object that also has `hasObservations:` or is the helper-call argument in production-style code (none should exist in the test file).

- [ ] **Step 4.2: Update turn-completion.test.ts fixture**

In `src/main/agent/__tests__/turn-completion.test.ts` at line 36:

Replace:
```ts
buildContext: vi.fn().mockResolvedValue({ summary: "", recentMessages: [] }),
```

with:

```ts
buildContext: vi.fn().mockResolvedValue({ summary: "", historyMessages: [], hasObservations: false }),
```

- [ ] **Step 4.3: Run the agent test suites to verify they still pass**

Run: `bun run test src/main/agent`
Expected: all tests pass with no `recentMessages` references remaining.

- [ ] **Step 4.4: Commit**

```bash
git add src/main/agent/session.test.ts src/main/agent/__tests__/turn-completion.test.ts
git commit -m "test(agent): update fixtures to new MemoryContext shape"
```

---

## Task 5 — Reset Pi state in `send()` when observations exist

**Files:**
- Modify: `src/main/agent/MessagePipeline.ts`
- Test: `src/main/agent/session.test.ts`

- [ ] **Step 5.1: Write a failing test for the reset behavior**

In `src/main/agent/session.test.ts`, append a new `describe` block just before the final closing brace of the top-level `describe("AgentSession", ...)`. Use the existing `mockAgent` (defined at the top of the file) — that is the Agent mock whose `state.messages` array represents Pi's in-memory history. Use the existing `beforeEach`-built `session` instance to send messages.

The existing `makeMemoryManager()` helper is used by `beforeEach` to construct the default session. To override its `buildContext` per-test, grab the mock via the captured `mockAgent` and a custom `memoryManager` passed to a freshly-constructed session.

Add this new block:

```ts
describe("send() history sync (Option C)", () => {
  it("resets mockAgent.state.messages from historyMessages when hasObservations is true", async () => {
    const memoryManager = {
      buildContext: vi.fn().mockResolvedValue({
        summary: "Summary from OM.",
        historyMessages: [
          { role: "user", content: "kept-user" },
          { role: "assistant", content: "kept-assistant" },
        ],
        hasObservations: true,
      }),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const localSession = new AgentSession({
      eventBus,
      messageService: messageService as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
      projectId: "p-1",
      slug: "test",
      projectName: "Test Project",
      folderPath: null,
      projectPath: null,
      provider: { type: "openrouter", apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" },
      systemContext: "",
      allowlistService: new AllowlistService() as never,
      observabilityService: makeObservabilityService() as never,
    });

    // Seed stale Pi state to prove the reset overwrites it.
    mockAgent.state.messages.length = 0;
    mockAgent.state.messages.push(
      { role: "user", content: "stale-1", timestamp: 1 } as never,
      { role: "assistant", content: [{ type: "text", text: "stale-2" }], timestamp: 2 } as never,
    );

    await localSession.send("new question");

    // After reset the first two entries must be the kept history, not stale.
    expect(mockAgent.state.messages[0]).toMatchObject({
      role: "user",
      content: "kept-user",
    });
    expect(mockAgent.state.messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "kept-assistant" }],
    });
    // No stale entries survived.
    expect(
      mockAgent.state.messages.some(
        (m: { content: unknown }) =>
          (typeof m.content === "string" && m.content === "stale-1") ||
          (Array.isArray(m.content) &&
            (m.content as Array<{ text?: string }>).some((p) => p.text === "stale-2")),
      ),
    ).toBe(false);
  });

  it("leaves mockAgent.state.messages untouched when hasObservations is false", async () => {
    const memoryManager = {
      buildContext: vi.fn().mockResolvedValue({
        summary: "",
        historyMessages: [{ role: "user", content: "ignored-when-no-obs" }],
        hasObservations: false,
      }),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const localSession = new AgentSession({
      eventBus,
      messageService: messageService as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", historyMessages: [], hasObservations: false },
      projectId: "p-1",
      slug: "test",
      projectName: "Test Project",
      folderPath: null,
      projectPath: null,
      provider: { type: "openrouter", apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" },
      systemContext: "",
      allowlistService: new AllowlistService() as never,
      observabilityService: makeObservabilityService() as never,
    });

    mockAgent.state.messages.length = 0;
    mockAgent.state.messages.push(
      { role: "user", content: "kept-stale", timestamp: 1 } as never,
    );

    await localSession.send("new question");

    // The stale entry must still be present — no reset happened.
    expect(
      mockAgent.state.messages.some(
        (m: { content: unknown }) =>
          typeof m.content === "string" && m.content === "kept-stale",
      ),
    ).toBe(true);
    // And the historyMessages from buildContext were NOT pasted in.
    expect(
      mockAgent.state.messages.some(
        (m: { content: unknown }) =>
          typeof m.content === "string" && m.content === "ignored-when-no-obs",
      ),
    ).toBe(false);
  });
});
```

> Helper functions (`makeHomeService`, `makeResearchService`, `makeObservabilityService`, `mockAgent`, `messageService`, `eventBus`) all already exist in the same test file. Do not redefine them.

- [ ] **Step 5.2: Run the new test to verify it fails**

Run: `bun run test src/main/agent/session.test.ts -t "resets agent.state.messages"`
Expected: FAIL — stale entries remain because no reset logic exists yet.

- [ ] **Step 5.3: Implement the reset in `send()`**

In `src/main/agent/MessagePipeline.ts`, inside `send()`, modify the existing try-block that fetches `memoryContext`. Currently:

```ts
const memoryContext = await this.memoryManager.buildContext(this.projectId);
const systemContext = await buildSystemContext(
  this.projectPath ?? join(this.homePath, "projects", this.slug),
  this.folderPath,
  this.skillRouter.toXml(),
);

const newSystemPrompt = buildSystemPrompt({
  basePrompt: BASE_SYSTEM_PROMPT,
  memorySummary: memoryContext.summary,
  systemContext,
});

if (newSystemPrompt !== this.agent.state.systemPrompt) {
  this.agent.state.systemPrompt = newSystemPrompt;
}
```

Replace with:

```ts
const memoryContext = await this.memoryManager.buildContext(this.projectId);
const systemContext = await buildSystemContext(
  this.projectPath ?? join(this.homePath, "projects", this.slug),
  this.folderPath,
  this.skillRouter.toXml(),
);

const newSystemPrompt = buildSystemPrompt({
  basePrompt: BASE_SYSTEM_PROMPT,
  memorySummary: memoryContext.summary,
  systemContext,
});

if (newSystemPrompt !== this.agent.state.systemPrompt) {
  this.agent.state.systemPrompt = newSystemPrompt;
}

// Once OM has compressed prior turns into observations, the raw messages
// they replaced live in libsql and are filtered out of getContext.messages
// via the lastObservedAt cursor. Adopt Mastra's filtered tail as the
// canonical Pi message history; otherwise we send summary + full raw
// backlog and double-pay tokens.
if (memoryContext.hasObservations) {
  this.agent.state.messages = toAgentMessages(memoryContext.historyMessages);
}
```

- [ ] **Step 5.4: Run the new tests to verify pass**

Run: `bun run test src/main/agent/session.test.ts -t "resets agent.state.messages"`
Run: `bun run test src/main/agent/session.test.ts -t "leaves agent.state.messages untouched"`
Expected: both pass.

- [ ] **Step 5.5: Run the full agent suite to confirm no regressions**

Run: `bun run test src/main/agent`
Expected: all pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/main/agent/MessagePipeline.ts src/main/agent/session.test.ts
git commit -m "feat(agent): reset Pi messages from Mastra when observations exist"
```

---

## Task 6 — Remove Phase 1 `[MM-DIAG]` logs

**Files:**
- Modify: `src/main/services/MemoryManager.ts`

- [ ] **Step 6.1: Strip the diagnostic logs**

In `src/main/services/MemoryManager.ts`, remove:

1. The IIFE inside `getMemory()` that resolves `memory.omEngine` and logs `omEngine resolved`. Keep the existing best-effort `memory.omEngine?.catch?.(...)` line (it predates the diag work).

2. The `[MM-DIAG] pre-observe status` block inside `triggerObservation()` (the `getStatus` lookup and console.log). Keep the warn-log for null omEngine and the `observe()` call.

3. The hooks object passed to `omEngine.observe(...)` plus the `[MM-DIAG] observe result` console.log immediately after. Restore the call to the simple form:

```ts
await omEngine.observe({ threadId: projectId });
```

4. The `[MM-DIAG] save persisted ...` log inside `save()` directly after `await memory.saveMessages({ messages });`.

5. The `[MM-DIAG] buildContext for ...` block inside `buildContext()` directly after the `getContext` call.

The end result: no `MM-DIAG` strings anywhere in the file.

- [ ] **Step 6.2: Verify logs gone**

Run: `grep -n "MM-DIAG" src/main/services/MemoryManager.ts || echo "clean"`
Expected: prints `clean`.

- [ ] **Step 6.3: Run the MemoryManager tests**

Run: `bun run test src/main/services/__tests__/MemoryManager.test.ts`
Expected: all pass.

- [ ] **Step 6.4: Commit**

```bash
git add src/main/services/MemoryManager.ts
git commit -m "chore(memory): drop Phase 1 diagnostic logs"
```

---

## Task 7 — Full verification

**Files:** none (validation only)

- [ ] **Step 7.1: Typecheck**

Run: `bun run typecheck`
Expected: zero errors.

- [ ] **Step 7.2: Lint and format**

Run: `bun run check`
Expected: zero issues.

- [ ] **Step 7.3: Test suite**

Run: `bun run test`
Expected: all pass.

- [ ] **Step 7.4: Coverage thresholds**

Run: `bun run test:coverage`
Expected: 90% branches/functions/lines/statements met.

- [ ] **Step 7.5: Manual smoke**

Launch the app:
```bash
bun run dev -- --remote-debugging-port=9222
```

Open the same project used during Phase 1 (project id `000c28be-2ac7-416b-b4f4-68fba5281ac7` or any project past the OM threshold). Send one new message. Inspect Langfuse for the next turn — the prompt sent to the LLM should contain:
- The system prompt block including the OM observations summary.
- A small number of user/assistant messages (the unobserved tail), **not** the entire prior backlog.
- The new user message at the end.

If the Langfuse `inputTokens` for this turn is significantly smaller than the previous turn's count (where the backlog was still being sent), the fix is live.

- [ ] **Step 7.6: Final commit (only if anything trivial slipped)**

If Steps 7.1–7.4 surface formatting nits handled automatically by `bun run check`, stage and commit them:

```bash
git add -p
git commit -m "chore: post-verification cleanup"
```

Otherwise skip.
