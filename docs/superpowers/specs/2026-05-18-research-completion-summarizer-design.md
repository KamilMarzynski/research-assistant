# Research Completion Summarizer — Design Spec

**Date:** 2026-05-18  
**Status:** Approved for implementation

---

## Problem

When background research completes, the main agent session must be interrupted to inject a summary. The current `queueFollowUp` approach (fixed to use `agent.prompt`) works but is inelegant: it blocks the main session's turn queue, can only run when the main agent is idle, and has no graceful handling for concurrent completions.

---

## Goal

Research completions produce a short, natural-feeling assistant message that:
- Streams into the chat exactly like a normal agent response
- Never interrupts an in-progress main agent turn
- Handles multiple concurrent completions gracefully (queue, drain serially)
- Confirms files are where they should be, surfaces 2–3 key findings

---

## Architecture Overview

```
Research completes
      │
      ▼
ResearchSummarizerService
  ├─ Runs silent worker agent (depth 0, ≤10 tool calls)
  │    Tools: read_file, list_dir, read_memory
  │    System prompt: identical to main session (no message history)
  │    Task: verify files, read findings, produce short summary text
  ├─ On success: saves assistant message to DB
  ├─ On failure: saves static fallback message to DB
  └─ Pushes { projectId, text } → SummaryQueue
              │
              ▼
     SummaryStreamCoordinator
       ├─ On push: check session.isProcessing()
       │    └─ idle → drainQueue(projectId) immediately
       │    └─ busy → leave in queue
       └─ On EventBus "agent:done" for projectId → drainQueue(projectId)
              │
              ▼
        drainQueue(projectId)
          while queue[projectId] not empty:
            pop text
            emit MESSAGE_CHUNK per segment
            (no MESSAGE_DONE between items)
          emit MESSAGE_DONE once
          renderer re-fetches → all saved messages appear
```

---

## Components

### 1. `ResearchSummarizerService`

**Location:** `src/main/services/ResearchSummarizerService.ts`

Singleton (`@injectable()`). Owns an internal job queue. Processes one summarization at a time — if busy when a new job arrives, queues it.

**Per job:**
- Constructs the same system prompt as the main `AgentSession` for the project:
  - Loads `GOAL.md`, `FILES.md`, memory summary via `MemoryManager.buildContext`
  - Builds system prompt via existing `buildSystemPrompt` + `buildSystemContext`
- Spawns a `createWorkerAgent` with:
  - `agentType`: new `"summarizer"` preset
  - `depth: 0` (no sub-agents)
  - Tool use limit: `maxToolCalls: 10`
  - Tools: `read_file`, `list_dir`, `read_memory` only
  - No message history
- Initial prompt injected:

```
Background research has completed.
Query: "<query>"
Task workspace: <workspacePath>
Files reportedly saved to: <filePaths or "none">

Your job:
1. Verify the output files exist at the reported paths. If FILES.md specifies routing conventions, check those too.
2. Read enough of the output to identify 2–3 key findings.
3. Write a short, natural assistant message for the user. Include:
   - Whether it went smoothly or had issues
   - Where the result files are (relative paths)
   - 2–3 key findings in plain language
Keep it under ~150 words. Write only the message, nothing else.
```

**On `agent_end`:**
- Collects full accumulated text from the agent
- Calls `messageService.addMessage({ projectId, role: "assistant", content: text })`
- Pushes `{ projectId, text }` to `SummaryQueue`

**On error / timeout:**
- Generates static fallback: `"Research complete: \"<query>\". Results saved to: <paths or 'workspace'>. (Summary generation failed — check files manually.)"`
- Saves to DB, pushes to queue

**Concurrency:** internal `_running: boolean` flag + `_pending: JobQueue`. New jobs enqueued while running, processed sequentially after current job completes.

---

### 2. `SummaryQueue`

**Location:** `src/main/ipc/SummaryQueue.ts`

```ts
class SummaryQueue {
  private readonly queues = new Map<string, string[]>();

  push(projectId: string, text: string): void
  peek(projectId: string): string | undefined
  pop(projectId: string): string | undefined
  hasItems(projectId: string): boolean
}
```

Plain in-memory structure. Lives alongside `SessionManager` — created once in `register.ts`, passed to `SummaryStreamCoordinator`.

---

### 3. `SummaryStreamCoordinator`

**Location:** `src/main/ipc/SummaryStreamCoordinator.ts`

Wired into `registerEventForwarders`. Holds references to `SummaryQueue`, `SessionManager`, and `win: BrowserWindow`.

**Trigger 1 — on `EventBus` event `research:summary_ready`:**
```ts
eventBus.on("research:summary_ready", ({ projectId }) => {
  const session = sessionManager.get(projectId);
  if (!session || !session.isProcessing()) {
    void this.drainQueue(projectId);
  }
  // else: leave in queue, agent:done will trigger drain
});
```

**Trigger 2 — on `EventBus` event `agent:done`:**
```ts
eventBus.on("agent:done", ({ projectId }) => {
  if (summaryQueue.hasItems(projectId)) {
    void this.drainQueue(projectId);
  }
});
```

**`drainQueue(projectId)`:**
```ts
async drainQueue(projectId: string): Promise<void> {
  while (summaryQueue.hasItems(projectId)) {
    const text = summaryQueue.pop(projectId)!;
    // stream text as chunks
    for (const chunk of splitIntoChunks(text)) {
      emitPush(win, { type: "MESSAGE_CHUNK", projectId, delta: chunk });
      await sleep(CHUNK_DELAY_MS); // natural pacing ~10–15ms
    }
    // no MESSAGE_DONE between items
  }
  emitPush(win, { type: "MESSAGE_DONE", projectId });
}
```

`splitIntoChunks`: splits by word boundaries, groups ~3–5 words per chunk for natural streaming feel.

---

### 4. `AgentSession` — new method

```ts
isProcessing(): boolean {
  return this.pipeline.isProcessing();
}
```

`MessagePipeline` exposes:
```ts
isProcessing(): boolean {
  return this.state.processing;
}
```

---

### 5. New EventBus event

```ts
{ type: "research:summary_ready"; payload: { projectId: string } }
```

Emitted by `ResearchSummarizerService` after it pushes to `SummaryQueue`.

---

### 6. New AGENT_TYPE_PRESET — `"summarizer"`

In `worker-agent.ts`, add a `"summarizer"` preset alongside `"researcher"` and `"orchestrator"`:

```ts
summarizer: (base, workspacePath, _depth) => ({
  ...base,
  agentType: "summarizer",
  maxToolCalls: 10,
  tools: ["read_file", "list_dir", "read_memory"],
  workspacePath,
})
```

This preset uses the constrained tool set. The `createWorkerAgent` factory already supports tool filtering via the tools list.

---

### 7. Wiring — `ResearchService` changes

`ResearchService._runResearch` currently emits `research:complete` and delegates to `event-forwarders.ts`. After this change:

- `research:complete` event continues to fire (for UI panel updates, OS notification, artifact panel refresh)
- The `event-forwarders.ts` `research:complete` handler **removes the `queueFollowUp` call** — replaced entirely by the summarizer pipeline
- `ResearchService` injects `ResearchSummarizerService` and calls `summarizerService.summarize(payload)` on `agent_end`

---

## Data Flow (full sequence)

```
1. Worker agent finishes → ResearchService emits research:complete
2. ResearchService calls summarizerService.summarize({ projectId, query, filePaths, workspacePath })
3. ResearchSummarizerService:
   a. Builds system prompt (GOAL.md + FILES.md + memories)
   b. Spawns summarizer worker agent (silent — no IPC events)
   c. Agent reads files, reads findings (≤10 tool calls)
   d. Agent produces summary text
   e. Saves assistant message to DB
   f. Pushes text to SummaryQueue
   g. Emits research:summary_ready on EventBus
4. SummaryStreamCoordinator receives research:summary_ready:
   a. Checks session.isProcessing()
   b. If idle → drainQueue immediately
   c. If busy → waits for next agent:done
5. drainQueue streams text as MESSAGE_CHUNK events
6. Single MESSAGE_DONE at end
7. Renderer re-fetches messages → all saved summaries appear
```

---

## Error Handling

| Scenario | Handling |
|---|---|
| Summarizer agent errors | Static fallback message saved to DB, pushed to queue |
| Summarizer agent times out | Same as error — timeout via existing worker agent timeout |
| Main session never becomes idle | Summary sits in queue indefinitely; streams on next `agent:done` |
| Multiple concurrent research completions | All processed serially by summarizer; all texts queued; drained in order on single `agent:done` |
| `drainQueue` called while already draining | Guard flag `_draining: boolean` per projectId in coordinator |

---

## Removal

- `event-forwarders.ts`: remove `session.queueFollowUp(...)` call from `research:complete` handler
- `MessagePipeline.queueFollowUp`: keep (still used for other follow-up cases) but remove from research completion path

---

## Testing

- `ResearchSummarizerService`: unit test job serialization, fallback on error, correct tool set passed to worker
- `SummaryStreamCoordinator`: unit test drain logic, guard against concurrent drain, queue persists when session busy
- `SummaryQueue`: trivial push/pop/peek tests
- `AgentSession.isProcessing()`: single assertion test
- Integration: `ResearchService` → summarizer → queue → coordinator tested end-to-end with mock agent

---

## Out of Scope

- Persisting the `SummaryQueue` across restarts (in-memory only; lost summaries on crash are acceptable)
- Summary message edit/delete UI
- Per-project summarizer configuration
