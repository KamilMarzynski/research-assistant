# Task: Improve Langfuse Tracing Implementation

You are working on a TypeScript/Electron project (`research-assistant`) that manually instruments Langfuse tracing by bridging `pi-agent` and `mastra` with `@langfuse/tracing` + `@langfuse/otel`. Automated SDK instrumentation is NOT used — everything is wired manually.

Your goal is to fix and improve the tracing implementation according to Langfuse best practices. Make **all changes in one pass** — no partial work.

---

## Files to modify

- `src/main/services/ObservabilityService.ts`
- `src/main/agent/MessagePipeline.ts`
- `src/main/agent/handlers/generation-span.ts`
- `src/main/agent/handlers/tool-span.ts`
- `src/main/agent/handlers/types.ts` (only if `ObservationSpan.update()` payload type needs expanding)

---

## Problems to fix

### 1. `traceCache` causes all turns to collapse into a single trace

**File:** `ObservabilityService.ts`

**Problem:** `getTraceId()` caches one `traceId` per `projectId` for the lifetime of the service. Every turn — every user message — shares the same trace ID. In Langfuse, this means all agent turns appear inside a single trace, which is completely wrong. A Langfuse **trace** is meant to represent one request/response cycle (one user turn).

**Fix:**
- Remove the `traceCache: Map<string, string>` field and the entire `getTraceId()` method from `ObservabilityService`.
- Do NOT pass a `traceId` option when starting the root `agent-turn` span. Let `@langfuse/tracing` auto-generate a fresh trace ID for every root span. This is the correct Langfuse behavior: each root observation that has no `parentSpanContext` automatically creates a new trace.

### 2. `getTraceId()` is called in two places in `MessagePipeline.ts`

**File:** `MessagePipeline.ts`

**Problem:** Both `send()` and `queueFollowUp()` call `this.observabilityService?.getTraceId(...)` before starting the turn span, then pass the result as `traceId`. After removing `getTraceId()` (fix #1), these calls must be removed too.

**Fix:** Remove the `getTraceId` calls and the `traceId` option from both `startObservation("agent-turn", ...)` calls in `send()` and `queueFollowUp()`. The root span should be created without a `traceId`. Keep all other options (`asType: "agent"`, `input`, `sessionId`, `metadata`) exactly as they are.

### 3. `startObservation` incorrectly nests `input` inside the metadata blob

**File:** `ObservabilityService.ts`, method `startObservation()`

**Problem:** The current code does this:
```typescript
const meta Record<string, unknown> = {};
if (options?.input !== undefined) metadata.input = options.input;      // WRONG
if (options?.metadata !== undefined) metadata.metadata = options.metadata; // WRONG
const span = typedStartObservation(name, metadata, { ... });
```
This puts `input` inside the metadata blob rather than as a top-level field. `@langfuse/tracing`'s `startObservation(name, attributes, spanOptions)` expects `input` and `metadata` as separate, top-level fields in the `attributes` object.

**Fix:** Pass them as proper top-level keys:
```typescript
const attributes: Record<string, unknown> = {};
if (options?.input !== undefined) attributes.input = options.input;
if (options?.metadata !== undefined) attributes.metadata = options.metadata;
const span = typedStartObservation(name, attributes, { ... });
```

### 4. Generation span is missing LLM usage data (tokens)

**File:** `src/main/agent/handlers/generation-span.ts`

**Problem:** On `message_end`, only `output` is set. Token usage is never tracked. Without usage data, Langfuse cannot display cost, input/output token counts, or efficiency metrics — which is one of its primary value propositions.

**Fix:** Check whether `pi-agent`'s `message_end` event exposes usage data (look at the `AgentEvent` type for `inputTokens`, `outputTokens`, `totalTokens`, `usage`, or similar fields on the event). If they exist, include them in the update:
```typescript
state.activeGenerationSpan?.update({
  output: event.message?.content,
  meta {
    model: provider.model,
    // include usage if available on the event:
    usage: {
      input: event.usage?.inputTokens ?? event.inputTokens,
      output: event.usage?.outputTokens ?? event.outputTokens,
    },
  },
});
```
If the `AgentEvent` type does not expose usage at all, add a `// TODO: add token usage when pi-agent exposes it` comment and skip the usage fields for now — do NOT make up or hardcode values.

Also add the `provider` name to the generation span's `startObservation` metadata so you can filter by provider in Langfuse:
```typescript
await observabilityService?.startObservation("llm-generation", {
  asType: "generation",
  input: event.message?.content,
  meta {
    model: provider.model,
    provider: provider.providerName ?? provider.constructor?.name ?? "unknown",
  },
  parentSpanContext: parentContext,
});
```
Check the `ModelProvider` type to find the correct field name for the provider identifier.

### 5. Tool span errors are not surfaced properly

**File:** `src/main/agent/handlers/tool-span.ts`

**Problem:** On error, `isError` is buried in `metadata`. Langfuse has first-class `level` (`"DEFAULT"` | `"DEBUG"` | `"WARNING"` | `"ERROR"`) and `statusMessage` fields on span observations specifically for this purpose. Without them, errors are invisible in the Langfuse trace UI.

**Fix:** Update the `tool_execution_end` handler:
```typescript
state.activeToolSpan?.update({
  output: event.result,
  meta { isError: event.isError ?? false },
  level: event.isError ? "ERROR" : "DEFAULT",
  statusMessage: event.isError ? String(event.result) : undefined,
});
```
If `ObservationSpan.update()` payload type in `types.ts` doesn't allow `level` and `statusMessage`, extend it:
```typescript
export interface ObservationSpan {
  update(payload: Record<string, unknown>): void; // already allows arbitrary keys — no change needed
  end(): void;
  traceId: string;
  spanId: string;
}
```
Since `update` already accepts `Record<string, unknown>`, no type change is needed — just pass the fields and they will flow through to `@langfuse/tracing`.

---

## What NOT to change

- Do NOT change `asType: "agent"` on the turn span in `MessagePipeline.ts` — it's correct.
- Do NOT change how `sessionId` is passed — it correctly groups all turns from one session.
- Do NOT change `parentSpanContext` wiring in generation and tool spans — it's correct.
- Do NOT touch `observe()` (the active-context variant) — it's used elsewhere and is fine.
- Do NOT add any new dependencies. Use only what's already imported.
- Do NOT change test files.

---

## Verification steps after changes

1. Run `bun run typecheck` (or the equivalent TS check command from `package.json`) — there should be zero new type errors.
2. Confirm `getTraceId` no longer exists in `ObservabilityService.ts` and is not called anywhere via: `grep -r 'getTraceId' src/`
3. Confirm `traceCache` no longer exists: `grep -r 'traceCache' src/`
4. Confirm `attributes.input` (not `metadata.input`) is used in `startObservation`: check the updated method body.
