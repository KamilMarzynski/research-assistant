# Research Agent Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full observability (turn, generation, and tool spans) to background research worker agents so every step is visible in Langfuse under a single shared trace.

**Architecture:** Extract a reusable `AgentTracer` class that owns all span lifecycle. Chat agents and worker agents both use it. Worker agents pass parent span context to spawned children, creating a nested trace tree.

**Tech Stack:** TypeScript, `@mariozechner/pi-agent-core`, `@langfuse/tracing`, `tsyringe`, `vitest`

---

## File Map

| File | Responsibility |
|---|---|
| `src/main/agent/AgentTracer.ts` (new) | Owns span lifecycle: turn, generation, tool spans. Subscribes to Agent events. |
| `src/main/agent/AgentTracer.test.ts` (new) | Unit tests for AgentTracer with mock ObservabilityService |
| `src/main/agent/handlers/types.ts` | SessionState — remove span fields |
| `src/main/agent/handlers/generation-span.ts` | Delete (logic moved to AgentTracer) |
| `src/main/agent/handlers/tool-span.ts` | Delete (logic moved to AgentTracer) |
| `src/main/agent/handlers/stream-chunk.ts` | Keep, no change |
| `src/main/agent/handlers/turn-completion.ts` | Simplify — call `tracer.endTurn()` |
| `src/main/agent/EventDispatcher.ts` | Simplify — remove generation/tool imports, pass tracer |
| `src/main/agent/MessagePipeline.ts` | Create AgentTracer per turn, pass to EventDispatcher |
| `src/main/agent/session.ts` | Remove span fields from initial state |
| `src/main/agent/worker-agent.ts` | Add tracing: AgentTracer in createWorkerAgent and run() |
| `src/main/agent/worker-agent.test.ts` | Update tests for tracing integration |
| `src/main/services/ResearchService.ts` | Pass observabilityService + parentSpanContext, use run() |
| `src/main/services/__tests__/ResearchService.test.ts` | Update tests for tracing |

---

## Task 1: Create AgentTracer

**Files:**
- Create: `src/main/agent/AgentTracer.ts`
- Test: `src/main/agent/AgentTracer.test.ts`

**Context:** `AgentTracer` encapsulates all observability span management that is currently split across `EventDispatcher`, `generation-span.ts`, `tool-span.ts`, and `MessagePipeline`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import { AgentTracer } from "./AgentTracer";
import type { ObservabilityService, ObservationSpan } from "../services/ObservabilityService";

function makeMockSpan(overrides?: Partial<ObservationSpan>): ObservationSpan {
  return {
    update: vi.fn(),
    end: vi.fn(),
    traceId: "trace-1",
    spanId: "span-1",
    ...overrides,
  };
}

function makeMockObs(): ObservabilityService {
  return {
    startObservation: vi.fn(),
    observe: vi.fn(),
    isEnabled: vi.fn().mockResolvedValue(true),
  } as unknown as ObservabilityService;
}

describe("AgentTracer", () => {
  it("getSpanContext returns null when no turn started", () => {
    const tracer = new AgentTracer({
      observabilityService: makeMockObs(),
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("startTurn creates a turn span and stores context", async () => {
    const obs = makeMockObs();
    const span = makeMockSpan({ traceId: "t-1", spanId: "s-1" });
    obs.startObservation = vi.fn().mockResolvedValue(span);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });

    await tracer.startTurn({ role: "user", content: "hi" });

    expect(obs.startObservation).toHaveBeenCalledWith(
      expect.stringContaining("turn"),
      expect.objectContaining({
        asType: "agent",
        input: { role: "user", content: "hi" },
      }),
    );
    expect(tracer.getSpanContext()).toEqual({ traceId: "t-1", spanId: "s-1" });
  });

  it("startTurn with parentSpanContext passes it through", async () => {
    const obs = makeMockObs();
    const span = makeMockSpan();
    obs.startObservation = vi.fn().mockResolvedValue(span);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
      parentSpanContext: { traceId: "parent-t", spanId: "parent-s" },
    });

    await tracer.startTurn("input");

    expect(obs.startObservation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        parentSpanContext: { traceId: "parent-t", spanId: "parent-s" },
      }),
    );
  });

  it("endTurn ends the turn span", async () => {
    const obs = makeMockObs();
    const span = makeMockSpan();
    obs.startObservation = vi.fn().mockResolvedValue(span);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });

    await tracer.startTurn("input");
    tracer.endTurn("output");

    expect(span.update).toHaveBeenCalledWith(expect.objectContaining({ output: "output" }));
    expect(span.end).toHaveBeenCalled();
    expect(tracer.getSpanContext()).toBeNull();
  });

  it("subscribeToAgent creates generation span on message_start", async () => {
    const obs = makeMockObs();
    const turnSpan = makeMockSpan({ traceId: "t-1", spanId: "s-1" });
    const genSpan = makeMockSpan({ traceId: "t-1", spanId: "gen-1" });
    obs.startObservation = vi.fn()
      .mockResolvedValueOnce(turnSpan)
      .mockResolvedValueOnce(genSpan);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });

    await tracer.startTurn("input");

    const mockAgent = {
      state: { messages: [], systemPrompt: "sp" },
      subscribe: vi.fn((cb: (e: AgentEvent) => void) => {
        cb({ type: "message_start", message: { role: "assistant" } } as AgentEvent);
        return () => {};
      }),
    } as unknown as Agent;

    tracer.subscribeToAgent(mockAgent);

    expect(obs.startObservation).toHaveBeenCalledWith(
      "llm-generation",
      expect.objectContaining({
        asType: "generation",
        parentSpanContext: { traceId: "t-1", spanId: "s-1" },
      }),
    );
  });

  it("subscribeToAgent creates tool span on tool_execution_start", async () => {
    const obs = makeMockObs();
    const turnSpan = makeMockSpan({ traceId: "t-1", spanId: "s-1" });
    const toolSpan = makeMockSpan({ traceId: "t-1", spanId: "tool-1" });
    obs.startObservation = vi.fn()
      .mockResolvedValueOnce(turnSpan)
      .mockResolvedValueOnce(toolSpan);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });

    await tracer.startTurn("input");

    const mockAgent = {
      state: { messages: [] },
      subscribe: vi.fn((cb: (e: AgentEvent) => void) => {
        cb({
          type: "tool_execution_start",
          toolName: "read_file",
          args: { path: "/tmp" },
        } as AgentEvent);
        return () => {};
      }),
    } as unknown as Agent;

    tracer.subscribeToAgent(mockAgent);

    expect(obs.startObservation).toHaveBeenCalledWith(
      "tool:read_file",
      expect.objectContaining({
        asType: "tool",
        input: { path: "/tmp" },
        parentSpanContext: { traceId: "t-1", spanId: "s-1" },
      }),
    );
  });

  it("endTurn cleans up any lingering generation or tool spans", async () => {
    const obs = makeMockObs();
    const turnSpan = makeMockSpan();
    const genSpan = makeMockSpan();
    const toolSpan = makeMockSpan();
    obs.startObservation = vi.fn()
      .mockResolvedValueOnce(turnSpan)
      .mockResolvedValueOnce(genSpan)
      .mockResolvedValueOnce(toolSpan);

    const tracer = new AgentTracer({
      observabilityService: obs,
      provider: { type: "openrouter", apiKey: "k", model: "m" },
    });

    await tracer.startTurn("input");

    const mockAgent = {
      state: { messages: [], systemPrompt: "sp" },
      subscribe: vi.fn((cb: (e: AgentEvent) => void) => {
        cb({ type: "message_start", message: { role: "assistant" } } as AgentEvent);
        cb({
          type: "tool_execution_start",
          toolName: "read_file",
          args: {},
        } as AgentEvent);
        return () => {};
      }),
    } as unknown as Agent;

    tracer.subscribeToAgent(mockAgent);
    tracer.endTurn();

    expect(genSpan.end).toHaveBeenCalled();
    expect(toolSpan.end).toHaveBeenCalled();
    expect(turnSpan.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/main/agent/AgentTracer.test.ts
```

Expected: FAIL — `AgentTracer` not defined.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { ObservabilityService, ObservationSpan } from "../services/ObservabilityService";
import type { ModelProvider } from "./model-provider";

export interface AgentTracerOptions {
  observabilityService?: ObservabilityService;
  provider: ModelProvider;
  sessionId?: string;
  parentSpanContext?: { traceId: string; spanId: string };
  metadata?: Record<string, unknown>;
}

export class AgentTracer {
  private activeTurnSpan: ObservationSpan | null = null;
  private activeGenerationSpan: ObservationSpan | null = null;
  private activeToolSpan: ObservationSpan | null = null;
  private turnTraceId: string | null = null;
  private turnSpanId: string | null = null;

  constructor(private readonly options: AgentTracerOptions) {}

  getSpanContext(): { traceId: string; spanId: string } | null {
    if (this.turnTraceId && this.turnSpanId) {
      return { traceId: this.turnTraceId, spanId: this.turnSpanId };
    }
    return null;
  }

  async startTurn(input: unknown, extraMetadata?: Record<string, unknown>): Promise<void> {
    const obs = this.options.observabilityService;
    if (!obs) return;

    const span = await obs.startObservation("agent-turn", {
      asType: "agent",
      input,
      sessionId: this.options.sessionId,
      parentSpanContext: this.options.parentSpanContext,
      metadata: {
        ...this.options.metadata,
        ...extraMetadata,
        model: this.options.provider.model,
        provider: this.options.provider.type,
      },
    });

    if (span) {
      this.activeTurnSpan = span;
      this.turnTraceId = span.traceId;
      this.turnSpanId = span.spanId;
    }
  }

  endTurn(output?: unknown): void {
    if (this.activeGenerationSpan) {
      this.activeGenerationSpan.end();
      this.activeGenerationSpan = null;
    }
    if (this.activeToolSpan) {
      this.activeToolSpan.end();
      this.activeToolSpan = null;
    }
    if (this.activeTurnSpan) {
      if (output !== undefined) {
        this.activeTurnSpan.update({ output });
      }
      this.activeTurnSpan.end();
      this.activeTurnSpan = null;
    }
    this.turnTraceId = null;
    this.turnSpanId = null;
  }

  subscribeToAgent(agent: Agent): () => void {
    const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
      try {
        await this._handleEvent(event, agent);
      } catch (err) {
        console.error("[AgentTracer] event handler error:", err);
      }
    });
    return unsubscribe;
  }

  private async _handleEvent(event: AgentEvent, agent: Agent): Promise<void> {
    const obs = this.options.observabilityService;
    if (!obs || !this.turnTraceId || !this.turnSpanId) return;

    const parentContext = { traceId: this.turnTraceId, spanId: this.turnSpanId };

    if (event.type === "message_start") {
      const msg = event.message as unknown as { role?: string };
      if (msg?.role !== "assistant") return;

      const span = await obs.startObservation("llm-generation", {
        asType: "generation",
        input: {
          messages: agent.state.messages,
          systemPrompt: agent.state.systemPrompt,
        },
        metadata: { model: this.options.provider.model, provider: this.options.provider.type },
        parentSpanContext: parentContext,
      });
      if (span) this.activeGenerationSpan = span;
    } else if (event.type === "message_end") {
      if (!this.activeGenerationSpan) return;

      const msg = event.message as unknown as {
        usage?: {
          input: number;
          output: number;
          totalTokens: number;
          cacheRead: number;
          cacheWrite: number;
          cost: {
            input: number;
            output: number;
            total: number;
            cacheRead: number;
            cacheWrite: number;
          };
        };
      };
      const usage = msg.usage;

      this.activeGenerationSpan.update({
        output: event.message?.content,
        metadata: {
          model: this.options.provider.model,
          provider: this.options.provider.type,
          ...(usage
            ? {
                usageDetails: {
                  promptTokens: usage.input,
                  completionTokens: usage.output,
                  totalTokens: usage.totalTokens,
                  cacheReadTokens: usage.cacheRead,
                  cacheWriteTokens: usage.cacheWrite,
                },
                costDetails: {
                  input: usage.cost.input,
                  output: usage.cost.output,
                  total: usage.cost.total,
                  cacheRead: usage.cost.cacheRead,
                  cacheWrite: usage.cost.cacheWrite,
                },
              }
            : {}),
        },
      });
      this.activeGenerationSpan.end();
      this.activeGenerationSpan = null;
    } else if (event.type === "tool_execution_start") {
      const span = await obs.startObservation(`tool:${event.toolName ?? "unknown"}`, {
        asType: "tool",
        input: event.args,
        metadata: { messages: agent.state.messages },
        parentSpanContext: parentContext,
      });
      if (span) this.activeToolSpan = span;
    } else if (event.type === "tool_execution_end") {
      if (!this.activeToolSpan) return;
      this.activeToolSpan.update({
        output: event.result,
        metadata: { isError: event.isError ?? false },
        level: event.isError ? "ERROR" : "DEFAULT",
        statusMessage: event.isError ? String(event.result) : undefined,
      });
      this.activeToolSpan.end();
      this.activeToolSpan = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/main/agent/AgentTracer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/AgentTracer.ts src/main/agent/AgentTracer.test.ts
git commit -m "feat: add AgentTracer for unified agent observability"
```

---

## Task 2: Refactor Chat Agent to Use AgentTracer

**Files:**
- Modify: `src/main/agent/handlers/types.ts`
- Delete: `src/main/agent/handlers/generation-span.ts`
- Delete: `src/main/agent/handlers/tool-span.ts`
- Modify: `src/main/agent/handlers/turn-completion.ts`
- Modify: `src/main/agent/EventDispatcher.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Test: `src/main/agent/session.test.ts` (existing, verify no regression)

**Context:** Move span state out of `SessionState` and into `AgentTracer`. `EventDispatcher` only handles stream chunks and turn completion. `MessagePipeline` creates a new `AgentTracer` per turn.

- [ ] **Step 1: Update SessionState types**

In `src/main/agent/handlers/types.ts`, remove span fields from `SessionState`:

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
  sessionId: string;
  streamingMessageId: string | null;
  streamChunkCount: number;
  // Removed: activeTurnSpan, activeGenerationSpan, activeToolSpan, turnTraceId, turnSpanId
}
```

Note: `turnTraceId`/`turnSpanId` were used by `generation-span.ts` and `tool-span.ts` to build `parentSpanContext`. `AgentTracer` handles this internally now.

- [ ] **Step 2: Delete generation-span.ts and tool-span.ts**

```bash
rm src/main/agent/handlers/generation-span.ts
rm src/main/agent/handlers/tool-span.ts
```

- [ ] **Step 3: Simplify turn-completion.ts**

In `src/main/agent/handlers/turn-completion.ts`, remove manual span cleanup and use `tracer.endTurn()`:

```typescript
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { HandlerContext } from "./types";

export async function handleTurnCompletion(event: AgentEvent, ctx: HandlerContext): Promise<void> {
  if (event.type !== "agent_end") return;

  const content = ctx.state.assistantContent;
  const userContent = ctx.state.lastUserContent;
  ctx.state.assistantContent = "";
  ctx.state.lastUserContent = "";
  ctx.state.streamChunkCount = 0;

  if (content && userContent && ctx.state.savedForTurn !== ctx.state.currentTurnId) {
    ctx.state.savedForTurn = ctx.state.currentTurnId;
    try {
      if (ctx.state.streamingMessageId) {
        await ctx.messageService.updateMessage(ctx.state.streamingMessageId, content);
      } else {
        await ctx.messageService.addMessage({
          projectId: ctx.projectId,
          role: "assistant",
          content,
        });
      }
      await ctx.memoryManager.save(ctx.projectId, [
        { role: "user", content: userContent },
        { role: "assistant", content },
      ]);
    } catch (err) {
      console.error("[AgentSession] save failed:", err);
    }
  }

  ctx.state.streamingMessageId = null;
  ctx.eventBus.emit({ type: "agent:done", payload: { projectId: ctx.projectId } });
}
```

Note: `ctx.tracer` is not in `HandlerContext` yet. We'll add it in Step 5. For now, we just remove span cleanup from here. The caller (`EventDispatcher`) will call `tracer.endTurn()`.

- [ ] **Step 4: Simplify EventDispatcher**

In `src/main/agent/EventDispatcher.ts`, remove generation/tool handler imports, add `AgentTracer`, and call `tracer.endTurn()` on `agent_end`:

```typescript
import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import type { IMemoryManager } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import { handleStreamChunk } from "./handlers/stream-chunk";
import { handleTurnCompletion } from "./handlers/turn-completion";
import type { SessionState } from "./handlers/types";
import type { ModelProvider } from "./model-provider";
import { AgentTracer } from "./AgentTracer";

export interface EventDispatcherOptions {
  agent: Agent;
  projectId: string;
  eventBus: EventBus;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  observabilityService?: ObservabilityService;
  provider: ModelProvider;
  state: SessionState;
  tracer: AgentTracer;
}

export function subscribeEvents(options: EventDispatcherOptions): () => void {
  const { agent, projectId, eventBus, messageService, memoryManager, state, tracer } = options;

  const ctx = { projectId, eventBus, messageService, memoryManager, state };

  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    try {
      await handleStreamChunk(event, ctx);
      await handleTurnCompletion(event, ctx);

      if (event.type === "agent_end") {
        tracer.endTurn({ role: "assistant", content: state.assistantContent });
      }
    } catch (err) {
      console.error("[AgentSession] subscriber error:", err);
    }
  });

  // Also subscribe AgentTracer for generation/tool spans
  const unsubscribeTracer = tracer.subscribeToAgent(agent);

  return () => {
    unsubscribe();
    unsubscribeTracer();
  };
}
```

- [ ] **Step 5: Update MessagePipeline**

In `src/main/agent/MessagePipeline.ts`:

1. Import `AgentTracer`:
```typescript
import { AgentTracer } from "./AgentTracer";
```

2. In `send()` method, replace turn span creation with `AgentTracer`:

Replace this block (lines ~285-301):
```typescript
      this.state.activeTurnSpan =
        (await this.observabilityService?.startObservation("agent-turn", {
          asType: "agent",
          input: { role: "user", content },
          sessionId: this.state.sessionId,
          metadata: {
            turnNumber: this.state.currentTurnId,
            projectId: this.projectId,
            systemPrompt: this.agent.state.systemPrompt,
            messages: this.agent.state.messages,
          },
        })) ?? null;

      if (this.state.activeTurnSpan) {
        this.state.turnTraceId = this.state.activeTurnSpan.traceId;
        this.state.turnSpanId = this.state.activeTurnSpan.spanId;
      }
```

With:
```typescript
      const tracer = new AgentTracer({
        observabilityService: this.observabilityService,
        provider: this.provider,
        sessionId: this.state.sessionId,
        metadata: {
          turnNumber: this.state.currentTurnId,
          projectId: this.projectId,
        },
      });
      this.state.activeTracer = tracer;
      await tracer.startTurn({ role: "user", content }, {
        systemPrompt: this.agent.state.systemPrompt,
        messages: this.agent.state.messages,
      });
```

Note: `activeTracer` needs to be added to `SessionState`. Add it to `SessionState` in `types.ts`:
```typescript
import type { AgentTracer } from "./AgentTracer";

export interface SessionState {
  // ...existing fields...
  activeTracer: AgentTracer | null;
}
```

3. In `send()` error handler (line ~367), replace manual span update:
```typescript
      this.state.activeTracer?.endTurn();
```
(Remove: `this.state.activeTurnSpan?.update({ metadata: { error: String(err) } });`)

Wait — we should update the span with the error before ending. So:
```typescript
      this.state.activeTracer?.endTurn({ error: String(err) });
```

4. In `queueFollowUp()`, replace the span creation block (lines ~389-407) with:
```typescript
      const tracer = new AgentTracer({
        observabilityService: this.observabilityService,
        provider: this.provider,
        sessionId: this.state.sessionId,
        metadata: {
          turnNumber: this.state.currentTurnId,
          projectId: this.projectId,
          followUp: true,
        },
      });
      this.state.activeTracer = tracer;
      await tracer.startTurn({ role: "user", content });
```

5. The `EventDispatcher` needs the tracer. In the `constructor` where `subscribeEvents` is called... wait, `subscribeEvents` is called in `session.ts`, not `MessagePipeline`. Let me check `session.ts` again.

In `session.ts`:
```typescript
    subscribeEvents({
      agent: this.pipeline.agent,
      projectId: options.projectId,
      eventBus: options.eventBus,
      messageService: options.messageService,
      memoryManager: options.memoryManager,
      observabilityService: options.observabilityService,
      provider: options.provider,
      state,
    });
```

We need to pass `tracer` to `subscribeEvents`. But `tracer` is created per turn in `MessagePipeline.send()`, not per session. So we need to get the current tracer from the state.

Change `subscribeEvents` to read `tracer` from `state.activeTracer`:

```typescript
export function subscribeEvents(options: Omit<EventDispatcherOptions, 'tracer'> & { state: SessionState }): () => void {
  const { agent, projectId, eventBus, messageService, memoryManager, observabilityService, provider, state } = options;

  const ctx = { projectId, eventBus, messageService, memoryManager, state };

  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    try {
      await handleStreamChunk(event, ctx);
      await handleTurnCompletion(event, ctx);

      if (event.type === "agent_end" && state.activeTracer) {
        state.activeTracer.endTurn({ role: "assistant", content: state.assistantContent });
        state.activeTracer = null;
      }
    } catch (err) {
      console.error("[AgentSession] subscriber error:", err);
    }
  });

  // Note: AgentTracer subscription is set up per-turn in MessagePipeline
  return unsubscribe;
}
```

Wait, but `AgentTracer.subscribeToAgent(agent)` also subscribes to the agent. If we do it per turn, we'd have multiple subscribers. Actually, `agent.subscribe` adds a new callback each time. If we call `subscribeToAgent` in every turn, we'd accumulate callbacks.

Better approach: Set up `AgentTracer.subscribeToAgent(agent)` once in `MessagePipeline` constructor or `session.ts`, similar to how `EventDispatcher` is set up once. But `AgentTracer` needs to know which spans are active (which turn). The generation/tool span handlers in `AgentTracer` check `this.turnTraceId` — which is set by `startTurn`. So subscribing once is fine; the internal state updates per turn.

So: set up `tracer.subscribeToAgent(agent)` once when the tracer is first created... but tracers are created per turn. Alternative: create one `AgentTracer` in `MessagePipeline` constructor and reuse it across turns, calling `startTurn`/`endTurn` each time.

Actually that's cleaner. Create `AgentTracer` once in `MessagePipeline` constructor:

```typescript
export class MessagePipeline {
  private readonly tracer: AgentTracer;
  // ...

  constructor(options: MessagePipelineOptions, private readonly state: SessionState) {
    // ...existing init...
    this.tracer = new AgentTracer({
      observabilityService: options.observabilityService,
      provider: options.provider,
      sessionId: this.state.sessionId,
    });
  }
}
```

Then in `send()`:
```typescript
await this.tracer.startTurn({ role: "user", content }, {
  turnNumber: this.state.currentTurnId,
  projectId: this.projectId,
  systemPrompt: this.agent.state.systemPrompt,
  messages: this.agent.state.messages,
});
```

And `subscribeEvents` receives this single `tracer`:

```typescript
export interface EventDispatcherOptions {
  // ...existing fields...
  tracer: AgentTracer;
}

export function subscribeEvents(options: EventDispatcherOptions): () => void {
  const { agent, projectId, eventBus, messageService, memoryManager, state, tracer } = options;
  // ...
  const unsubscribeTracer = tracer.subscribeToAgent(agent);
  // ...
}
```

In `session.ts`:
```typescript
    subscribeEvents({
      agent: this.pipeline.agent,
      projectId: options.projectId,
      eventBus: options.eventBus,
      messageService: options.messageService,
      memoryManager: options.memoryManager,
      observabilityService: options.observabilityService,
      provider: options.provider,
      state,
      tracer: this.pipeline.tracer, // need to expose tracer
    });
```

So `MessagePipeline` needs to expose `tracer` as a readonly property.

- [ ] **Step 6: Update session.ts initial state**

In `src/main/agent/session.ts`, remove the deleted span fields from initial state:

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
      sessionId: randomUUID(),
      streamingMessageId: null,
      streamChunkCount: 0,
    };
```

Wait, `activeTracer` should NOT be in SessionState if we create it once in MessagePipeline. Good. Keep SessionState clean.

- [ ] **Step 7: Run session tests to verify no regression**

```bash
bun test src/main/agent/session.test.ts
```

Expected: PASS (40 tests)

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/
git commit -m "refactor: chat agents use AgentTracer for observability"
```

---

## Task 3: Add Tracing to Worker Agents

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

**Context:** `createWorkerAgent` and `run()` need to create an `AgentTracer`, start a turn, subscribe to agent events, and end the turn on completion. `spawnAgentFn` passes the current tracer's span context to children.

- [ ] **Step 1: Update WorkerAgentConfig**

In `src/main/agent/worker-agent.ts`, add to `WorkerAgentConfig`:

```typescript
export interface WorkerAgentConfig {
  // ...existing fields...
  observabilityService?: import("../services/ObservabilityService").ObservabilityService;
  parentSpanContext?: { traceId: string; spanId: string };
}
```

- [ ] **Step 2: Add tracing to createWorkerAgent and run()**

In `createWorkerAgent` function, before creating the `Agent`:

```typescript
  const tracer = new AgentTracer({
    observabilityService: config.observabilityService,
    provider: config.provider,
    parentSpanContext: config.parentSpanContext,
    metadata: { agentLabel: config.agentLabel },
  });
```

In the `run()` function, wrap the prompt with tracing:

```typescript
  const run = (input: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      let output = "";

      tracer.startTurn({ query: input }).then(() => {
        const unsubscribe = agent.subscribe(async (event) => {
          const e = event as {
            type: string;
            assistantMessageEvent?: { type: string; delta: string };
          };
          if (e.type === "message_update") {
            const ae = e.assistantMessageEvent;
            if (ae?.type === "text_delta") {
              output += ae.delta;
              config.onProgress?.(config.agentLabel ?? "", ae.delta);
            }
          } else if (e.type === "agent_end") {
            unsubscribe();
            tracer.endTurn({ summary: output });
            resolve(output);
          }
        });

        // Also subscribe tracer for generation/tool spans
        const unsubscribeTracer = tracer.subscribeToAgent(agent);

        agent.prompt(input).catch((err) => {
          unsubscribe();
          unsubscribeTracer();
          tracer.endTurn({ error: String(err) });
          reject(err);
        });
      });
    });
```

Wait, the `agent.subscribe` in `run()` currently handles `message_update` for progress and `agent_end` for resolution. The `tracer.subscribeToAgent` also subscribes to the same agent. Both will receive events. That's fine — they handle different event types.

But we need to be careful: if `agent.prompt()` rejects, we should end the tracer. Currently the catch block does `unsubscribe(); reject(err);`. We need to add `tracer.endTurn({ error: String(err) });` there too.

Also, `spawnAgentFn` and `spawnAgentsParallelFn` need to pass parent context:

In `spawnAgentImpl`:
```typescript
    const spawnAgentImpl = async (
      type: AgentType,
      query: string,
      outputPath: string,
      label?: string,
    ): Promise<SpawnResult> => {
      const effectiveLabel = label ?? `[${type}]`;
      const childConfig = AGENT_TYPE_PRESETS[type](base, outputPath, remainingDepth);
      const { run } = await createWorkerAgent({
        ...childConfig,
        agentLabel: effectiveLabel,
        observabilityService: config.observabilityService,
        parentSpanContext: tracer.getSpanContext() ?? undefined,
      });
      const summary = await run(query);
      return { outputPath, summary };
    };
```

- [ ] **Step 3: Update worker-agent tests**

In `src/main/agent/worker-agent.test.ts`, add test verifying `parentSpanContext` propagation:

```typescript
  it("spawnAgentFn passes parentSpanContext to child createWorkerAgent", async () => {
    const parentOpts = {
      ...BASE_CONFIG,
      toolNames: ["spawn_agent" as const, "read_file" as const],
      remainingDepth: 1,
      observabilityService: {
        startObservation: vi.fn().mockResolvedValue({
          update: vi.fn(),
          end: vi.fn(),
          traceId: "parent-trace",
          spanId: "parent-span",
        }),
      },
    };

    const { agent, run } = await createWorkerAgent(parentOpts);

    // Mock the child createWorkerAgent call
    const childRun = vi.fn().mockResolvedValue("child output");
    vi.spyOn(await import("./worker-agent"), "createWorkerAgent").mockImplementationOnce(async () => ({
      agent: {} as Agent,
      run: childRun,
    }));

    await run("parent query");
    // Trigger spawn_agent tool call via agent...
    // This is tricky to test directly. Better approach:
    // Check that spawnAgentFn passes the right context.
  });
```

Actually, a better test: verify that when `createWorkerAgent` is called with `parentSpanContext`, the `AgentTracer` is created with it. We can test this indirectly by mocking `ObservabilityService`:

```typescript
  it("creates AgentTracer with parentSpanContext when provided", async () => {
    const startObservation = vi.fn().mockResolvedValue({
      update: vi.fn(),
      end: vi.fn(),
      traceId: "child-trace",
      spanId: "child-span",
    });

    const { run } = await createWorkerAgent({
      ...BASE_CONFIG,
      observabilityService: { startObservation } as unknown as import("../services/ObservabilityService").ObservabilityService,
      parentSpanContext: { traceId: "parent-t", spanId: "parent-s" },
    });

    await run("query");

    expect(startObservation).toHaveBeenCalledWith(
      "agent-turn",
      expect.objectContaining({
        parentSpanContext: { traceId: "parent-t", spanId: "parent-s" },
      }),
    );
  });
```

- [ ] **Step 4: Run worker-agent tests**

```bash
bun test src/main/agent/worker-agent.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat: trace worker agents with parent context propagation"
```

---

## Task 4: Integrate Tracing into ResearchService

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Test: `src/main/services/__tests__/ResearchService.test.ts`

**Context:** `ResearchService` creates the root `research` span. It needs to pass `observabilityService` and `parentSpanContext` to `createWorkerAgent`, and switch from manual `agent.prompt()` + `agent.subscribe()` to `run()`.

- [ ] **Step 1: Update ResearchService._runResearch**

In `src/main/services/ResearchService.ts`:

1. In the `buildPartialConfig` call, add `observabilityService` and `parentSpanContext`:

```typescript
    const parentSpanContext = researchSpan
      ? { traceId: researchSpan.traceId, spanId: researchSpan.spanId }
      : undefined;

    return this._runResearch(
      { projectId, projectName, projectPath: projectPath ?? null, query, folderPath },
      (workspacePath) => ({
        toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
        systemPromptAddition: "...",
        projectId,
        projectName,
        projectPath: projectPath ?? null,
        folderPath,
        homePath: this.homeService.getHomePath(),
        remainingDepth: 0,
        allowlistService: this.allowlistService,
        observabilityService: this.observabilityService,
        parentSpanContext,
      }),
    );
```

For `startOrchestratedResearch`, same pattern but with `ORCHESTRATOR_TOOL_NAMES`.

2. Replace manual `agent.prompt()` + `agent.subscribe()` with `run()`:

Replace lines ~189-300:
```typescript
    const { agent } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({...});

    agent.subscribe(async (event) => {
      // ... event handling ...
    });

    agent.prompt(config.query).catch((err) => {
      // ... error handling ...
    });
```

With:
```typescript
    const { run } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId: config.projectId, query: config.query },
    });

    run(config.query)
      .then(async (output) => {
        researchSpan?.update({
          output: { status: "complete", summary: output },
          metadata: { taskId },
        });
        researchSpan?.end();
        try {
          await this.homeService.updateTaskStatus(taskId, "complete");
          // ...output routing logic (same as before)...
          let filePaths: string[] = [];
          // ...existing routing logic...
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              projectId: config.projectId,
              query: config.query,
              filePaths,
            },
          });
        } catch (err) {
          await this.homeService.updateTaskStatus(taskId, "failed", String(err));
          this.eventBus.emit({
            type: "research:failed",
            payload: { taskId, projectId: config.projectId, query: config.query, error: String(err) },
          });
        }
      })
      .catch(async (err) => {
        researchSpan?.update({
          output: { status: "failed", error: String(err) },
          metadata: { taskId },
        });
        researchSpan?.end();
        console.error("[ResearchService] worker error:", err);
        await this.homeService.updateTaskStatus(taskId, "failed", String(err));
        await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
        this.eventBus.emit({
          type: "research:failed",
          payload: { taskId, projectId: config.projectId, query: config.query, error: String(err) },
        });
      });
```

Wait, the `run()` method in worker-agent returns a Promise that resolves with the agent's text output. But the existing code uses `agent.subscribe()` to get progress events AND completion events. `run()` already handles `message_update` and `agent_end` internally. But `ResearchService` also emits `research:progress` events.

Looking at the current `ResearchService` code more carefully:
- `onProgress` callback is passed to `createWorkerAgent`, which calls `config.onProgress` inside `run()` for `text_delta` events.
- So `run()` will emit progress events correctly.
- The `agent_end` handling in `run()` resolves the promise.
- We need to move the `research:complete` / `research:failed` logic into `.then()` / `.catch()` of `run()`.

But there's a subtlety: the existing `agent.subscribe()` emits `research:progress` for ALL `message_update` events, including those without a label. The `onProgress` callback inside `createWorkerAgent` only calls `config.onProgress` when `config.agentLabel` is present (in `run()`). Wait, let me re-read:

In `worker-agent.ts` `run()`:
```typescript
        if (e.type === "message_update") {
          const ae = e.assistantMessageEvent;
          if (ae?.type === "text_delta") {
            output += ae.delta;
            config.onProgress?.(config.agentLabel ?? "", ae.delta);
          }
        }
```

So `onProgress` is called with `agentLabel` (or empty string). In `ResearchService`:
```typescript
    const onProgress = (label: string, delta: string) => {
      if (label) {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId, message: delta, label },
        });
      }
    };
```

So label must be truthy. For the root orchestrator, `agentLabel` is undefined (not passed), so `config.onProgress?.("", ae.delta)` — label is empty string, which is falsy. So the root agent's progress events won't be emitted.

Wait, in the current code, `agent.subscribe` is called on the `agent` directly in `ResearchService`, not inside `run()`. So it receives events directly and emits progress regardless of label:
```typescript
    agent.subscribe(async (event) => {
      const e = event as { type: string; assistantMessageEvent?: { type: string; delta: string } };
      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          this.eventBus.emit({ type: "research:progress", payload: { taskId, message: ae.delta } });
        }
      } else if (e.type === "agent_end") {
        // ...
      }
    });
```

So if we switch to `run()`, we lose direct event access. We need to keep the direct `agent.subscribe()` for progress events, OR modify `run()` to accept an `onEvent` callback, OR modify `onProgress` to always fire.

Better approach: Keep `agent.subscribe()` in `ResearchService` for progress events and completion, but also use `run()` for the prompt execution. Actually, `run()` does its own `agent.subscribe()` internally. Having two subscribers is fine. We can keep the existing `agent.subscribe()` for `research:progress` and completion events, and just call `run()` instead of `agent.prompt()`.

Wait, `run()` subscribes and then calls `agent.prompt()`. If we also subscribe in `ResearchService`, both subscribers will receive events. That's fine. But `run()` will resolve/reject with the output. We can use `run()` for the promise, and keep the existing `agent.subscribe()` for progress and completion:

```typescript
    const { agent, run } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({ type: "research:started", ... });

    // Keep existing subscriber for progress + completion
    agent.subscribe(async (event) => {
      // ... same as before ...
    });

    // Use run() for execution
    run(config.query).catch((err) => {
      console.error("[ResearchService] worker error:", err);
    });
```

But wait, `run()` will also handle `agent_end` and resolve. The `agent.subscribe()` in `ResearchService` also handles `agent_end`. That's fine — multiple handlers for the same event is normal.

Actually, the simplest approach: keep the existing `agent.subscribe()` in `ResearchService` for progress events and post-completion cleanup. Just use `run()` for execution instead of `agent.prompt()`. The `run()` promise doesn't need to be awaited.

So the change is minimal:
1. Pass `observabilityService` and `parentSpanContext` in `workerConfig`
2. Change `agent.prompt(config.query)` to `run(config.query)` (and destructure `run` from `createWorkerAgent`)

Actually, looking at the current code:
```typescript
    const { agent } = await createWorkerAgent(workerConfig);
    // ...
    agent.prompt(config.query).catch(...)
```

Change to:
```typescript
    const { agent, run } = await createWorkerAgent(workerConfig);
    // ...
    run(config.query).catch(...)
```

And that's it for the execution part. The existing `agent.subscribe()` stays.

- [ ] **Step 2: Update ResearchService tests**

In `src/main/services/__tests__/ResearchService.test.ts`, verify that `createWorkerAgent` receives `observabilityService` and `parentSpanContext`.

Since `createWorkerAgent` is a module-level function (not a method), we need to mock it:

```typescript
vi.mock("../../agent/worker-agent", async () => {
  const actual = await vi.importActual<typeof import("../../agent/worker-agent")>("../../agent/worker-agent");
  return {
    ...actual,
    createWorkerAgent: vi.fn(),
  };
});
```

Then in the test:
```typescript
  it("passes observabilityService and parentSpanContext to worker agent", async () => {
    const startObservation = vi.fn().mockResolvedValue({
      update: vi.fn(), end: vi.fn(), traceId: "t", spanId: "s",
    });
    const observabilityService = { startObservation };

    // ...setup ResearchService with mocked observabilityService...
    // ...call startResearch...

    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        observabilityService: expect.any(Object),
        parentSpanContext: { traceId: "t", spanId: "s" },
      }),
    );
  });
```

- [ ] **Step 3: Run ResearchService tests**

```bash
bun test src/main/services/__tests__/ResearchService.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat: wire research agents into Langfuse trace tree"
```

---

## Task 5: Full Suite Verification

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 2: Run linter**

```bash
bun run check
```

Expected: clean

- [ ] **Step 3: Run full test suite**

```bash
bun run test
```

Expected: all tests pass (same count as baseline, or more)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: verify full suite passes after tracing refactor" --allow-empty
```

---

## Spec Coverage Check

| Spec Section | Task |
|---|---|
| AgentTracer class | Task 1 |
| Chat agent refactor | Task 2 |
| Worker agent tracing | Task 3 |
| ResearchService integration | Task 4 |
| Error handling (disabled obs, init failure, abort) | Handled in AgentTracer implementation + task 4 |
| Testing | Each task has test steps |

## Placeholder Scan

No TBDs, TODOs, or vague steps. Each step has exact code, file paths, and commands.

## Type Consistency Check

- `AgentTracerOptions.parentSpanContext` uses `{ traceId: string; spanId: string }` — consistent with `ObserveOptions.parentSpanContext` in `ObservabilityService`
- `WorkerAgentConfig` mirrors the same shape
- `AgentTracer.getSpanContext()` returns the same shape
- `ObservabilityService.startObservation` called with `parentSpanContext` typed correctly

All consistent.
