# Research Agent Tracing Design

## Date
2026-05-13

## Goal
Add full observability (turn spans, generation spans, tool spans) to background research agents so every step — orchestration, researcher delegation, tool use, and LLM generation — is visible in Langfuse under a single shared trace.

## Motivation
Research agents are currently invisible in Langfuse. `ResearchService` creates one `research` span at the top level, but child worker agents (orchestrator, researcher, coder) create no spans at all. We cannot see which subtasks ran, what tools they used, or how long generations took. The goal is full visibility into the research pipeline.

## Architecture

### New Component: `AgentTracer`

`src/main/agent/AgentTracer.ts`

Owns all span state and lifecycle for a single agent run:

- `startTurn(input)` — creates a turn span, stores `traceId`/`spanId`
- `endTurn(output)` — ends the turn span, generation span, and tool span
- `subscribeToAgent(agent)` — subscribes to `Agent` events; starts generation spans on `message_start` and tool spans on `tool_execution_start`; ends them on corresponding `message_end` / `tool_execution_end`
- `getSpanContext()` — returns `{ traceId, spanId }` for child agents to use as `parentSpanContext`

Design rules:
- `observabilityService` is optional. If null, all methods are no-ops.
- If `startTurn` not called, generation/tool spans are skipped.
- `endTurn` is idempotent.
- `subscribeToAgent` returns an `unsubscribe` callback.

### Chat Agent Refactor

- `SessionState` drops `activeTurnSpan`, `activeGenerationSpan`, `activeToolSpan`, `turnTraceId`, `turnSpanId`. These move into `AgentTracer`.
- `MessagePipeline.send()` creates an `AgentTracer` per turn, calls `startTurn`, then `subscribeToAgent(agent)`.
- `EventDispatcher` simplifies: only `handleStreamChunk` and `handleTurnCompletion` remain. Generation/tool span handlers move into `AgentTracer.subscribeToAgent`.
- `handleTurnCompletion` calls `tracer.endTurn(output)` instead of manually ending spans.

### Worker Agent Tracing

- `WorkerAgentConfig` gains:
  - `observabilityService?: ObservabilityService`
  - `parentSpanContext?: { traceId: string; spanId: string }`
- `createWorkerAgent` creates an `AgentTracer` with `parentSpanContext`.
- `run()` calls `tracer.startTurn(input)` before `agent.prompt(input)`, subscribes via `tracer.subscribeToAgent(agent)`, and calls `tracer.endTurn(output)` on completion.
- `spawnAgentFn` / `spawnAgentsParallelFn` pass `tracer.getSpanContext()` as `parentSpanContext` to children.
- `AGENT_TYPE_PRESETS` does not change. All agent types get tracing automatically.

### ResearchService Tracing

- `ResearchService._runResearch` passes `observabilityService` and `parentSpanContext` (from the `researchSpan`) into `buildPartialConfig`.
- Switches from manual `agent.subscribe()` + `agent.prompt()` to `run()` via `createWorkerAgent`. `createWorkerAgent` owns the event subscriber and observability.
- Top-level `research` span in `ResearchService` remains as the trace root.

## Data Flow

1. User sends message → `MessagePipeline` starts chat turn span
2. Chat agent calls `start_research` → `ResearchService` starts `research` span as new trace root
3. `ResearchService` calls `createWorkerAgent` with `parentSpanContext` from `research` span
4. Worker agent (orchestrator) starts its own turn span as child of `research` span
5. Orchestrator spawns researcher via `spawn_agents_parallel`
6. Each researcher gets `parentSpanContext` from orchestrator's turn span
7. Researchers create their own turn spans, generation spans, and tool spans
8. All nested under the same trace in Langfuse

## Error Handling

| Scenario | Behavior |
|---|---|
| Observability disabled | `AgentTracer` no-ops silently |
| Langfuse init failure | `ObservabilityService` returns null spans; `AgentTracer` skips all spans |
| Agent abort (no `agent_end`) | `endTurn` called manually in `finally` block |
| Span timeout (5s in `ObservabilityService`) | Returns null span; agent continues unaffected |
| Partial spans (generation without turn) | `subscribeToAgent` skips if `startTurn` not called |
| Leaf agent (`remainingDepth === 0`) | Still gets tracing; just cannot spawn children |

## Testing

- Unit test `AgentTracer` with mock `ObservabilityService`
- Verify span hierarchy: turn → generation → tool
- Verify parent context propagation through `spawnAgentFn`
- Verify `run()` calls `startTurn`, `subscribeToAgent`, and `endTurn` in correct order
- Verify `ResearchService` passes correct `parentSpanContext`
- Verify no regression in chat agent tracing after `EventDispatcher` refactor

## Files Changed

| File | Change |
|---|---|
| `src/main/agent/AgentTracer.ts` | New |
| `src/main/agent/handlers/types.ts` | Remove span fields from `SessionState` |
| `src/main/agent/handlers/generation-span.ts` | Delete (moved into `AgentTracer`) |
| `src/main/agent/handlers/tool-span.ts` | Delete (moved into `AgentTracer`) |
| `src/main/agent/handlers/stream-chunk.ts` | Keep, no change |
| `src/main/agent/handlers/turn-completion.ts` | Simplify — use `tracer.endTurn()` |
| `src/main/agent/EventDispatcher.ts` | Simplify — remove generation/tool handlers |
| `src/main/agent/MessagePipeline.ts` | Create `AgentTracer` per turn, pass to `EventDispatcher` |
| `src/main/agent/session.ts` | Remove span fields from initial state |
| `src/main/agent/worker-agent.ts` | Add tracing to `createWorkerAgent` and `run()` |
| `src/main/services/ResearchService.ts` | Pass `observabilityService` + `parentSpanContext`, use `run()` |
| `src/main/agent/AgentTracer.test.ts` | New unit tests |
| `src/main/agent/worker-agent.test.ts` | Update tests for tracing |
| `src/main/services/__tests__/ResearchService.test.ts` | Update tests for tracing |

## Scope

**In scope:**
- `AgentTracer` class with turn/generation/tool span tracking
- Chat agent refactor to use `AgentTracer`
- Worker agent tracing with parent context propagation
- `ResearchService` integration
- Unit tests

**Out of scope:**
- Langfuse cloud setup changes
- Changing `ObservabilityService` API
- UI changes for trace display
- Span sampling or rate limiting
