# Manual Langfuse Tracing — Design Spec

## Context

The current Langfuse integration uses an **OpenAI proxy endpoint** (`/api/proxy/openai/v1`) that intercepts LLM HTTP calls and creates traces automatically. This only works with **Langfuse Cloud**; self-hosted Langfuse (Docker Compose) does not expose this endpoint. When enabled with local Langfuse, the app hangs silently because the proxy returns HTML instead of JSON, and error events from the Pi agent runtime are not handled.

This spec replaces the proxy-based approach with **explicit manual tracing** using the `@langfuse/tracing` SDK. Tracing becomes a first-class citizen in the application architecture, capturing the full agent lifecycle — turns, LLM generations, tool executions, and nested research workflows.

## Goals

1. **Works with any Langfuse instance** — cloud or self-hosted — via the standard `@langfuse/tracing` SDK.
2. **State-of-the-art observability** — full trace hierarchy: project trace → agent turn → LLM generation → tool execution → nested research (with its own turns/tools/generations).
3. **Fail-safe** — if Langfuse is unreachable or disabled, the app works normally. No errors propagate to the user. Tracing is entirely behind the scenes.
4. **Automatic** — no manual span creation required by individual tool authors. The `ObservabilityService` and `AgentSession` wire everything up.

## Non-Goals

- No support for distributed tracing across multiple machines (out of scope).
- No custom Langfuse dashboards or metrics aggregation (Langfuse UI is sufficient).
- No migration of old proxy-based traces (new traces start fresh).

## Architecture

### Services

```
┌─────────────────────────────────────────────────────────────┐
│                     ObservabilityService                     │
│  (Singleton, @injectable())                                  │
│  - Lazy client initialization                                │
│  - Project trace cache (Map<projectId, traceId>)              │
│  - Safe wrapper around @langfuse/tracing                     │
│  - All spans fire-and-forget with 5s timeout                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        AgentSession                          │
│  - Receives ObservabilityService via DI                      │
│  - On send(): get/create project trace                       │
│  - Wraps agent.run in agent-turn span                       │
│  - Maps Pi events to nested spans                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ResearchService                         │
│  - start_research tool call receives active span context    │
│  - Passes context to worker AgentSession                     │
│  - Worker spans nest under research span                    │
└─────────────────────────────────────────────────────────────┘
```

### Trace Hierarchy

One **Trace** per project session. All user messages in the same project share the same trace ID.

```
Trace: project-{projectId}  (name: "Project: {projectName}")
├── Span: turn-{n}  "agent-turn"  (asType: "agent")
│   ├── Span: "llm-generation"  (asType: "generation")
│   │   └── input: messages[]
│   │   └── output: assistantMessage
│   │   └── metadata: { model, provider }
│   ├── Span: "tool-execution:{toolName}"  (asType: "tool")
│   │   └── input: toolArgs
│   │   └── output: toolResult
│   │   └── metadata: { durationMs, isError }
│   └── Span: "llm-generation"  (follow-up after tools)
│       └── ...
├── Span: turn-{n+1}  "agent-turn"
│   └── ...
```

### Research Nesting

When a tool call triggers research, the research span inherits the tool span's context and becomes its child:

```
Trace: project-{projectId}
└── Span: turn-1 "agent-turn"
    └── Span: "tool-execution:start_research"
        └── Span: "research"  (ResearchService creates this)
            ├── Span: "llm-generation"  (worker plans)
            ├── Span: "tool-execution:web-search"
            ├── Span: "tool-execution:file-read"
            └── Span: "llm-generation"  (worker synthesizes)
```

The `ResearchService` receives `parentSpanContext` from the `start_research` tool call. It passes this to the worker `AgentSession`, which uses it as the parent for all its own spans.

## Components

### 1. ObservabilityService

**Responsibilities:**
- Initialize `@langfuse/tracing` client lazily (first time `getClient()` is called).
- Read env vars: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`/`LANGFUSE_BASE_URL`.
- Cache project trace IDs in-memory (`Map<projectId, string>`).
- Provide `startTrace(projectId, name)` — idempotent, returns existing trace if cached.
- Provide `safeObserve(name, fn, options)` — wraps `startActiveObservation` with:
  - 5-second timeout on span submission
  - Silent swallow of network/timeout errors
  - Console warning on first failure per session
- Return `null` client when disabled or unreachable — callers check and skip.

**Interface:**
```typescript
@injectable()
class ObservabilityService {
  private client: LangfuseClient | null = null;
  private traceCache = new Map<string, string>();
  private failed = false;

  constructor(@inject(SettingsService) settings: SettingsService);

  isEnabled(): boolean;
  getTraceId(projectId: string, projectName: string): string | null;
  observe<T>(name: string, fn: (span: ObservationSpan) => Promise<T>, options?: ObserveOptions): Promise<T>;
  startObservation(name: string, options?: ObservationOptions): ObservationSpan | null;
}
```

### 2. AgentSession Integration

**Changes:**
- Add `observabilityService?: ObservabilityService` to `AgentSessionOptions`.
- In `send()`:
  1. If observability enabled, get trace ID for project.
  2. Wrap `agent.prompt()` in `observe("agent-turn", ...)` with `parentSpanContext`.
  3. Inside the agent callback, subscribe to Pi events and create nested spans:
     - `message_start` → `startObservation("llm-generation", { asType: "generation" })`
     - `message_end` → `span.end()`
     - `tool_execution_start` → `startObservation(toolName, { asType: "tool" })`
     - `tool_execution_end` → `span.end()` with output
  4. On `agent_end`, close the turn span.

**Event → Span Mapping:**

| Pi Event | Span Action |
|---|---|
| `agent_start` | (trace already exists) |
| `turn_start` | — |
| `message_start` | `startObservation("llm-generation", { asType: "generation" })` |
| `message_update` + `text_delta` | — (streaming, no span action) |
| `message_end` | `generation.end()` with output + usage |
| `tool_execution_start` | `startObservation(toolName, { asType: "tool" })` |
| `tool_execution_end` | `tool.end()` with result |
| `turn_end` | — |
| `agent_end` | Close active turn span |

### 3. ResearchService Integration

**Changes:**
- `startOrchestratedResearch` and `startResearch` accept optional `parentSpanContext`.
- Create a `research` span as child of the provided context.
- Pass the research span's context to the worker `AgentSession`.

### 4. Tool Integration

**No changes to individual tools.** The `AgentSession` event subscriber handles `tool_execution_start`/`tool_execution_end` and creates spans automatically. Tool authors do not need to know about Langfuse.

### 5. Worker AgentSession

The worker `AgentSession` (used by `ResearchService`) follows the same pattern as the main session, but receives its `parentSpanContext` from the research span instead of creating a new project trace.

## Error Handling & Safety

### Client Initialization Failure
- First call to `getClient()` attempts connection with 5s timeout.
- If timeout or error → set `failed = true`, log warning, return `null` forever after.
- No retries to avoid repeated slowdowns.

### Span Submission Failure
- `safeObserve` wraps `startActiveObservation` in `Promise.race([fn, timeout])`.
- Timeout or network error → span data dropped silently. Error logged once per session.
- The wrapped function still runs and returns its result. Tracing never blocks business logic.

### Missing Env Vars
- If `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` missing → `isEnabled()` returns `false`.
- App works normally. Console warning on startup.

### Toggle Off
- `settings.langfuseEnabled = false` → `ObservabilityService` returns `null` immediately. Zero overhead.

## Data Model

### Trace Attributes
```typescript
{
  name: `Project: ${projectName}`,
  id: traceId, // UUIDv4, cached per project
  metadata: {
    projectId,
    projectName,
    appVersion: process.env.npm_package_version,
  }
}
```

### Span Attributes

**agent-turn:**
```typescript
{
  name: "agent-turn",
  input: { role: "user", content },
  metadata: { turnNumber, projectId },
}
```

**llm-generation:**
```typescript
{
  name: "llm-generation",
  input: messages,
  model,
  modelParameters: { temperature, maxTokens },
  output: assistantMessage,
  usageDetails: { promptTokens, completionTokens, totalTokens },
}
```

**tool-execution:**
```typescript
{
  name: `tool:${toolName}`,
  input: toolArgs,
  output: toolResult,
  metadata: { toolName, durationMs, isError },
}
```

## Testing Strategy

1. **ObservabilityService tests**:
   - Returns `null` when disabled.
   - Returns `null` when env vars missing.
   - Caches trace IDs.
   - `safeObserve` runs function even when span times out.

2. **AgentSession tests**:
   - When observability is `null`, events flow normally (no crash).
   - When observability present, events create expected span calls.
   - `agent_end` closes spans.
   - Tool events create tool spans.

3. **ResearchService tests**:
   - Receives `parentSpanContext` and passes to worker.
   - Worker spans nest correctly.

4. **Integration test**:
   - Mock `@langfuse/tracing` client.
   - Send message through `AgentSession`.
   - Assert trace structure matches hierarchy.

## Migration Plan

1. **Remove proxy code** from `model-factory.ts` (delete `langfuseEnabled` URL rewrite).
2. **Add `@langfuse/tracing`** dependency.
3. **Create `ObservabilityService`**.
4. **Wire into `AgentSession`**.
5. **Wire into `ResearchService`**.
6. **Update tests**.
7. **Remove `langfuseEnabled` from `createModel`** — it no longer affects model config.

## Open Questions

None. All decisions validated with user.

## References

- `@langfuse/tracing` manual tracing API: `startObservation`, `startActiveObservation`, `getActiveTraceId`
- Pi agent event protocol: `AgentEvent` types from `@mariozechner/pi-agent-core`
- Existing DI pattern: `tsyringe` with `@injectable()` / `@inject()`
