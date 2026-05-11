# Prompt Architecture Fix + Mastra Observational Memory Migration

**Date:** 2026-05-11
**Status:** Draft

---

## Goal

Fix Scholar's prompt architecture to align with industry best practices: keep the system prompt static, move conversation history to the agent's messages array, and lay the groundwork for migrating from custom compression to Mastra's built-in observational memory.

---

## Guiding Principles

**System prompt is static.** Identity, rules, compressed summary, and context files only. No dynamic content (history, timestamps, session IDs). This enables prompt caching and follows Anthropic/OpenAI best practices.

**Messages array is the living transcript.** All conversation turns from the database are loaded into the agent's messages array on session start. The conversation continues seamlessly after app restart because the agent sees its full history.

**No duplication.** A message exists either in the system prompt (static context) or in the messages array (dynamic transcript), never both.

**Dynamic pruning, not fixed limits.** The agent keeps the full message array in memory, but `transformContext` prunes it to fit the model's context window before each LLM call. This is how Claude Code and Mastra handle long conversations.

**Interface boundary preserved.** `IMemoryManager` stays unchanged. Phase 1 fixes how its output is consumed. Phase 2 swaps its implementation to Mastra.

---

## Phase 1: Fix Prompt Architecture (Immediate)

### 1.1 Problem Statement

Currently, `AgentSession` injects a `<conversation_history>` block into the system prompt on every turn:

```typescript
// session.ts (current)
const historyBlock = formatConversationHistory(memoryContext.recentMessages);
const systemPrompt = [BASE_SYSTEM_PROMPT, summary, historyBlock, systemContext].join('\n\n');
this.agent.state.systemPrompt = systemPrompt;
```

This causes three problems:

1. **Prompt cache destruction.** Anthropic's caching is strict prefix matching. `historyBlock` grows every turn, so the system prompt changes every turn. Cache never hits.
2. **Token duplication.** The same 20 messages are tokenized twice: once in system prompt, once in the agent's internal messages array.
3. **Role confusion.** Conversation turns belong in the messages array (user/assistant roles). The system prompt is for instructions, not dialogue.

### 1.2 Fix: Load All Messages into Messages Array

**Constructor change:** Load **all** messages from the database into `initialState.messages`. Not 20. All of them.

```typescript
// session.ts (target)
const systemPrompt = [BASE_SYSTEM_PROMPT, initialMemoryContext.summary, systemContext]
  .filter(Boolean)
  .join('\n\n');

this.agent = new Agent({
  initialState: {
    systemPrompt,
    model: createModel({ provider, langfuseEnabled }),
    tools,
    messages: initialMemoryContext.allMessages.map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }],
      timestamp: Date.now(),
    })),
  },
  transformContext: async (messages) => {
    // Prune to fit context window before LLM call
    return pruneMessagesToFitContextWindow(messages, model.contextWindow);
  },
  // ...
});
```

**Key:** `pi-agent-core` supports `initialState.messages` (`agent.js:27-44`) and `transformContext` (`types.d.ts:126`). The original design spec already called for this. The fallback to system prompt injection was unnecessary.

**Why all messages?** The database is the source of truth. Loading a fixed 20 breaks seamless restart — if you have 30 messages, reopening shows only 20. The agent must see its full history. Pruning happens at the LLM boundary, not at the data layer.

### 1.3 Fix: Stop Rebuilding System Prompt with History

Current `send()` rebuilds system prompt every turn:

```typescript
// session.ts:246-262 (current — REMOVE)
const memoryContext = await this.memoryManager.buildContext(this.projectId, 20);
const historyBlock = formatConversationHistory(memoryContext.recentMessages);
const systemContext = await buildSystemContext(...);
const systemPrompt = [BASE_SYSTEM_PROMPT, memoryContext.summary, historyBlock, systemContext]
  .filter(Boolean)
  .join('\n\n');
this.agent.state.systemPrompt = systemPrompt;
```

Replace with:

```typescript
// session.ts (target)
const memoryContext = await this.memoryManager.buildContext(this.projectId);
const systemContext = await buildSystemContext(...);

const newSystemPrompt = [BASE_SYSTEM_PROMPT, memoryContext.summary, systemContext]
  .filter(Boolean)
  .join('\n\n');

if (newSystemPrompt !== this.agent.state.systemPrompt) {
  this.agent.state.systemPrompt = newSystemPrompt;
}
```

**System prompt now changes only when:**
- Summary updates (rare — only when compression fires after ~30k tokens)
- Context files change (`config.md`, `AGENTS.md`, skills added/removed)

On 99% of turns, system prompt is byte-for-byte identical → cache hits.

### 1.4 What Stays in System Prompt vs Messages Array

| Content | System Prompt | Messages Array |
|---|---|---|
| Base identity (who Scholar is) | ✅ | ❌ |
| Compressed summary (all past sessions) | ✅ | ❌ |
| Context files (`config.md`, `AGENTS.md`, skills) | ✅ | ❌ |
| Past conversation history | ❌ | ✅ |
| Current user message | ❌ | ✅ |
| Assistant responses | ❌ | ✅ |

### 1.5 Session Persistence Flow

**On session start (app opened, project selected):**

```
Database (LibSQL)
    │
    ├── ALL messages for projectId
    │
MemoryManager.buildContext(projectId)
    │
    ├── Load compressed summary → inject into system prompt
    └── Load ALL messages → inject into agent.messages
    │
AgentSession initialized
    │
    ├── systemPrompt = static (identity + summary + context)
    └── messages = [msg1, msg2, ..., msgN] (all messages from DB)
```

**During conversation:**

```
User sends message
    │
Agent.prompt(userMessage) → adds to messages array
    │
transformContext runs → prunes messages to fit context window
    │
LLM call: { systemPrompt (static), messages: [pruned subset + userMessage] }
    │
Assistant responds → added to messages array
    │
MemoryManager.save(projectId, [user, assistant]) → persisted to DB
```

**On app restart:**

Same as session start. All messages re-loaded from DB. Agent sees full history. Conversation continues seamlessly.

### 1.6 Token Window Management

The messages array holds the **full conversation history** (all messages from the database). The database holds the **persistent source of truth**. The compressed summary holds the **essence of older turns**.

**Dynamic pruning via `transformContext`:**

```typescript
function pruneMessagesToFitContextWindow(
  messages: AgentMessage[],
  contextWindow: number,
): AgentMessage[] {
  // Reserve tokens for system prompt, tools, and response
  const reservedTokens = 4000;
  const availableTokens = contextWindow - reservedTokens;

  // Estimate tokens (rough: 4 chars ≈ 1 token)
  let estimatedTokens = 0;
  const pruned: AgentMessage[] = [];

  // Walk backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.map(c => c.text ?? '').join('');
    const msgTokens = Math.ceil(text.length / 4);

    if (estimatedTokens + msgTokens > availableTokens) {
      // Keep at least the last user message
      if (msg.role === 'user' && pruned.length === 0) {
        pruned.unshift(msg);
      }
      break;
    }

    estimatedTokens += msgTokens;
    pruned.unshift(msg);
  }

  return pruned;
}
```

**How this works in practice:**

- 10 messages, 200 tokens each → all 10 sent to LLM
- 100 messages, 500 tokens each → last ~80 sent to LLM, older 20 covered by summary
- 500 messages, 500 tokens each → last ~20 sent to LLM, older 480 covered by summary

**Key:** The agent's internal `messages` array always has ALL messages. Only the LLM call is pruned. The UI shows all messages. The agent never "forgets" a turn existed.

### 1.7 Files Changed in Phase 1

| File | Change |
|---|---|
| `src/main/agent/session.ts` | Remove `historyBlock` from system prompt. Inject `allMessages` into `initialState.messages`. Add `transformContext` for dynamic pruning. Rebuild system prompt only when summary/context changes. |
| `src/main/ipc/chat-handlers.ts` | No change needed — already passes `initialMemoryContext` to `AgentSession`. |
| `src/main/services/MemoryManager.ts` | No change — interface stays same. |
| `src/main/services/MemoryCompressionService.ts` | No change — still used in Phase 1. |

---

## Phase 2: Migrate to Mastra Observational Memory (Next)

**Note:** Phase 2 is deliberately scoped but not implemented in this run. It is documented here so it is not forgotten and so Phase 1 does not paint us into a corner.

### 2.1 Current State (Custom Implementation)

Scholar uses `LibSQLStore` directly with custom compression logic:

- **Storage:** `LibSQLStore` from `@mastra/libsql` — messages saved as MastraMessageContentV2 format
- **Compression:** `MemoryCompressionService` manually calls `complete()` with a summarization prompt when total chars exceed ~30k
- **Summary storage:** Custom `${projectId}-summary` thread metadata
- **Recall:** Custom `listMessages({ threadId, perPage, orderBy })` + manual text extraction

This works but re-invents what Mastra already provides.

### 2.2 Target State (Mastra `Memory` Class)

Mastra's `Memory` class (from `@mastra/core` or `@mastra/memory`) provides:

- **Storage:** Same `LibSQLStore` — data format is compatible
- **Observer:** Automatic compression when token threshold hits (default 30k)
- **Reflector:** Deeper synthesis when higher threshold hits (default 60k)
- **Working Memory:** The compressed summary, automatically injected into `recall()` results
- **API:** `memory.saveMessages()` and `memory.recall()` — same pattern as current `IMemoryManager`

### 2.3 Interface Compatibility

Current `IMemoryManager`:

```typescript
export interface IMemoryManager {
  buildContext(projectId: string): Promise<MemoryContext>;
  save(projectId: string, turns: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void>;
}
```

This interface is **already compatible** with Mastra. The swap is internal to `MemoryManager`:

```typescript
// Phase 2: MemoryManager refactored to use Mastra Memory
class MemoryManager implements IMemoryManager {
  private memory: Memory; // from @mastra/core

  async buildContext(projectId: string): Promise<MemoryContext> {
    const result = await this.memory.recall({
      threadId: projectId,
      resourceId: projectId,
    });

    const summary = result.workingMemory?.text ?? '';
    const allMessages = result.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: extractTextContent(m.content),
      }));

    return { summary, allMessages };
  }

  async save(projectId: string, turns: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
    const messages = turns.map((t) => ({
      id: crypto.randomUUID(),
      role: t.role as 'user' | 'assistant',
      content: { format: 2 as const, parts: [{ type: 'text' as const, text: t.content }] },
      threadId: projectId,
      resourceId: projectId,
      createdAt: new Date(),
    }));

    await this.memory.saveMessages({ messages });
    // Mastra handles Observer/Reflector compression automatically
  }
}
```

**Boundary:** `AgentSession` does not change. `chat-handlers.ts` does not change. Only `MemoryManager` and `MemoryCompressionService` are affected.

### 2.4 Data Migration

Existing messages in LibSQL use Mastra's standard format (`MastraMessageContentV2`). Mastra's `Memory` class reads the same tables. **No data migration needed.** The swap is implementation-only.

### 2.5 What Gets Deleted in Phase 2

- `MemoryCompressionService` — Mastra handles compression internally
- Custom `${projectId}-summary` thread metadata — Mastra's `workingMemory` replaces it
- Manual `complete()` calls for summarization — Mastra's Observer/Reflector replaces them

### 2.6 What Gets Added in Phase 2

- Dependency: `@mastra/core` or `@mastra/memory` (check Mastra v1.9.0 package structure)
- `Memory` instance in `MemoryManager` constructor
- Configuration: Observer/Reflector model, thresholds (can reuse existing `COMPRESSION_MODEL_ID`)

### 2.7 Files Changed in Phase 2

| File | Change |
|---|---|
| `src/main/services/MemoryManager.ts` | Replace `LibSQLStore` direct usage with `Memory` class from Mastra. |
| `src/main/services/MemoryCompressionService.ts` | **Delete.** Mastra handles compression. |
| `package.json` | Add `@mastra/core` or `@mastra/memory` dependency. |
| `src/main/bootstrap.ts` | Update DI registration if needed. |

### 2.8 Dependencies Between Phases

Phase 1 must be completed before Phase 2 because:
- Phase 1 fixes the fundamental architecture (system prompt vs messages array)
- Phase 2 only changes the memory backend. If system prompt still contains history, Mastra's compression won't fix the caching issue.
- Phase 1 gives us a clean `IMemoryManager` boundary that Phase 2 plugs into.

---

## Testing Plan

### Phase 1 Tests

1. **Unit test:** `AgentSession` constructor seeds `initialState.messages` from `allMessages`
2. **Unit test:** `send()` does not rebuild system prompt on every turn when summary/context are unchanged
3. **Unit test:** `send()` rebuilds system prompt when summary changes
4. **Integration test:** Send 5 messages, verify system prompt is identical on turns 2–5
5. **Integration test:** Close app, reopen project, verify conversation continues seamlessly with all messages restored
6. **Integration test:** Send 50+ messages, verify `transformContext` prunes to fit context window
7. **Manual test:** Open Langfuse (if enabled), verify `cacheRead` tokens appear on subsequent messages

### Phase 2 Tests

1. **Unit test:** `MemoryManager.buildContext` returns same shape with Mastra backend
2. **Unit test:** `MemoryManager.save` persists messages and triggers Mastra Observer
3. **Integration test:** Conversation exceeds 30k tokens, verify compression fires automatically
4. **Data migration test:** Existing messages readable after switching to Mastra backend
5. **Regression test:** All Phase 1 tests still pass after Phase 2 swap

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Pi agent framework does not support `initialState.messages` | Already verified in source (`agent.js:27-44`). Fallback: inject history as first user message. |
| Context window overflow with many messages | `transformContext` dynamically prunes messages to fit model context window. Full history kept in agent state, only LLM call is pruned. |
| System prompt still too dynamic (summary changes) | Summary changes are rare (~every 30k tokens). Cache hits on 95%+ of turns. |
| Phase 2 Mastra package not available | Already have `@mastra/libsql` v1.9.0. `Memory` class should be in `@mastra/core` or `@mastra/memory`. Verify before Phase 2. |
| Data loss during Phase 2 migration | No migration needed — same LibSQL tables. Keep backup of `research-assistant.db` anyway. |

---

## Summary

**Phase 1 (now):** Fix the prompt architecture. Move history to messages array. Keep system prompt static. This fixes caching, removes duplication, and aligns with industry best practices.

**Phase 2 (next):** Swap custom compression for Mastra's built-in observational memory. The `IMemoryManager` interface boundary means this is a contained refactor. No changes to `AgentSession`, `chat-handlers`, or the UI.
