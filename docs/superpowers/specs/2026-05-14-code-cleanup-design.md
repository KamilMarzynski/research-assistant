# Code Cleanup Design — Contract-First Refactor

**Date:** 2026-05-14  
**Approach:** Contract-first / outside-in  
**Goal:** Make the codebase easy to test, easy to extend (especially agent progress events and new tools), and easy to maintain. SOLID throughout, clear responsibility lines.

---

## Context

Deep review of the codebase identified these root causes behind maintainability friction:

- IPC layer has three inconsistent error-handling patterns and no typed wrappers in renderer
- `AgentProgressEvent` types are implicit — adding a new event requires touching multiple files with no type guidance
- `MessagePipeline.ts` (455 LOC) is a god object doing model selection, context pruning, system prompt building, agent instantiation, and compression
- `worker-agent.ts` and `MessagePipeline.ts` duplicate agent construction and subscription logic
- Dead code: `CrystallizationService` registered but never injected
- `HomeService` is a pure delegation facade adding indirection without value
- `PathJail` constructed inconsistently across callers (wrong param in `artifact-handlers.ts`)
- `StreamStateContext` (300+ LOC) mixes timer logic, event parsing, and state management
- Three near-identical pending approval modals with no shared abstraction
- `GET_SETTINGS` and `GET_PROJECTS` fetched redundantly across multiple components
- Critical paths have zero test coverage: `chat-handlers.ts`, `MessagePipeline.ts`, `artifact-handlers.ts`
- Bugs: rate limiter race condition, missing `useEffect` dependency, `project.name` passed where path expected

---

## Approach: Contract-First

Start with `src/shared/` contracts. Every subsequent change — main handlers, agent internals, renderer — is guided by stable, typed interfaces. The renderer's `IpcClient` enforces the contract at the seam between FE and BE.

---

## Section 1 — Shared Contracts (`src/shared/`)

### `IpcResult<T>`

Single return shape for all `ipcMain.handle` handlers. No more throws propagating as Electron rejections, no more ad-hoc `{ error: string }` returns.

```typescript
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string }
```

### `IpcPushEvent`

Discriminated union covering every `webContents.send` call. Adding a new push event = adding one member here.

```typescript
export type IpcPushEvent =
  | { type: "MESSAGE_CHUNK"; projectId: string; delta: string }
  | { type: "MESSAGE_DONE"; projectId: string; messageId: string }
  | { type: "AGENT_PROGRESS"; projectId: string; event: AgentProgressEvent }
  | { type: "NEW_MESSAGE"; projectId: string; message: Message }
  | { type: "SETTINGS_UPDATED"; settings: SettingsResponse }
  | { type: "PENDING_COMMAND"; payload: PendingCommandPayload }
  | { type: "PENDING_PATH"; payload: PendingPathPayload }
  | { type: "PENDING_TOOL"; payload: PendingToolPayload }
```

`TOOL_START`/`TOOL_END` and `RESEARCH_STATUS_UPDATE`/`RESEARCH_COMPLETE` are consolidated into `AGENT_PROGRESS` — a single extensible channel for all agent execution events (tool calls, research steps, file writes, memory saves). The renderer subscribes to `AGENT_PROGRESS` once and switches on `event.kind`.

### `AgentProgressEvent`

Extensible tagged union for all agent and research progress. Adding a new progress event = one new union member + one `emitPush()` call in main. Renderer receives it typed, no parsing needed.

```typescript
export type AgentProgressEvent =
  // Research lifecycle (replaces RESEARCH_STATUS_UPDATE + RESEARCH_COMPLETE channels)
  | { kind: "research_started"; taskId: string; goal: string }
  | { kind: "research_step"; taskId: string; step: string; progress: number }
  | { kind: "research_complete"; taskId: string; summary: string }
  | { kind: "research_failed"; taskId: string; error: string }
  // Tool execution (replaces TOOL_START + TOOL_END channels)
  | { kind: "tool_call_start"; toolName: string; toolCallId: string }
  | { kind: "tool_call_end"; toolName: string; toolCallId: string; durationMs: number }
  // Side effects
  | { kind: "memory_saved"; key: string }
  | { kind: "file_written"; relativePath: string }
```

### Existing `IpcRequestMap` / `IpcResponseMap`

Keep and extend. All channels must have entries. No channel can be invoked without a typed request and response.

### Lint enforcement

Two Biome `noRestrictedSyntax` rules added to project config:

1. Ban raw `window.electronAPI.invoke()` outside `src/renderer/lib/ipc-client.ts`
2. Ban type assertions on IPC results (`as Message[]`, `as SettingsResponse`, etc.)

---

## Section 2 — Typed Renderer IPC Client (`src/renderer/lib/ipc-client.ts`)

Single wrapper over `window.electronAPI`. All component and hook code uses this — never `window.electronAPI` directly.

```typescript
class IpcClient {
  async invoke<K extends keyof IpcRequestMap>(
    channel: K,
    payload?: IpcRequestMap[K]
  ): Promise<IpcResult<IpcResponseMap[K]>>

  on<T extends IpcPushEvent["type"]>(
    type: T,
    handler: (event: Extract<IpcPushEvent, { type: T }>) => void
  ): () => void  // returns unsubscribe
}

export const ipc = new IpcClient();
```

- `invoke` return type is inferred from `IpcResponseMap` — no casts anywhere in renderer
- `on` narrows the event type automatically via `Extract` — handler receives the exact event shape
- `IpcClient` is the only place `window.electronAPI` is referenced
- Preload is unchanged

---

## Section 3 — Main Process Handler Cleanup

### `wrapIpc` utility (`src/main/ipc/wrap-ipc.ts`)

```typescript
async function wrapIpc<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message, code: (err as NodeJS.ErrnoException).code ?? "UNKNOWN" };
  }
}
```

Every `ipcMain.handle` wraps its body in `wrapIpc`. Handlers become uniform, ~5 LOC each.

### `emitPush` helper (`src/main/ipc/emit-push.ts`)

```typescript
function emitPush(win: BrowserWindow, event: IpcPushEvent): void {
  win.webContents.send(event.type, event);
}
```

No raw channel strings in handlers. Emitting a new event type = adding a member to `IpcPushEvent` and calling `emitPush`.

### Dead code removal

- `CrystallizationService` — deleted from source and `bootstrap.ts`
- `HomeService` — stripped to directory-setup methods only (`ensureDirectories`, `isFirstRun`). Callers that need `TaskPersistenceService`, `ToolApprovalService`, or `SkillManagementService` inject them directly via TSyringe.

### Bug fixes

- **Rate limiter race condition** (`chat-handlers.ts` lines 67–82): Two concurrent `SEND_MESSAGE` calls both see `last = 0`, sleep, then both proceed. Fix: check-and-set inside the existing `sendLocks` promise chain so concurrent calls serialize correctly.
- **Module-scoped Maps** (`sendLocks`, `lastSendTimes`): Add bounded cleanup — evict entries when map exceeds 500 keys, or move into `SessionManager` with explicit per-session lifecycle.

---

## Section 4 — Agent Architecture Decomposition

### `ModelRegistry` (`src/main/agent/model-registry.ts`)

Replaces the hardcoded `getContextWindow()` function in `MessagePipeline.ts`. A config object:

```typescript
const MODEL_REGISTRY: ModelEntry[] = [
  { pattern: "claude-3-opus", contextWindow: 200_000, provider: "anthropic" },
  { pattern: "claude-sonnet-4", contextWindow: 200_000, provider: "anthropic" },
  // ...
]
```

One place to update for new models. `ModelRegistry.getContextWindow(modelId)` replaces the cascade of string-includes checks.

### `SystemPromptBuilder` (`src/main/agent/system-prompt-builder.ts`)

Pure function: `buildSystemPrompt(context: SystemPromptContext): string`. Takes project goal, memory, skills, and any injected instructions. No side effects — unit-testable with no mocking.

### `MessageContextPruner` (`src/main/agent/message-context-pruner.ts`)

Pure function: `pruneMessages(messages: Message[], contextWindow: number): Message[]`. Extracted from `MessagePipeline`. Testable in isolation.

### `AgentFactory` (`src/main/agent/agent-factory.ts`)

Single factory used by both `MessagePipeline` (chat) and `worker-agent.ts` (background research). Eliminates duplicated agent construction, subscription wiring, and compression service setup between the two files. Both callers pass an `AgentFactoryOptions` object; `AgentFactory` returns a configured `Agent` instance.

`MessagePipeline` shrinks from ~455 LOC to ~120 LOC (orchestration only).

### `PathJailFactory` (`src/main/agent/path-jail-factory.ts`)

Single constructor site:

```typescript
class PathJailFactory {
  create(project: Project): PathJail
}
```

Eliminates the inconsistent multi-site construction. Fixes the `project.name` passed as `projectPath` bug in `artifact-handlers.ts`.

### `tools.ts` — explicit `ToolCapabilities`

Replace 14 conditional `tools.push()` calls with:

```typescript
interface ToolCapabilities {
  webAccess: boolean;
  memory: boolean;
  codeExecution: boolean;
  fileSystem: boolean;
  bash: boolean;
}

function createAgentTools(
  capabilities: ToolCapabilities,
  context: ToolContext
): AgentTool[]
```

`ToolContext` replaces loose optional callbacks (`onFileWrite?`, `emitBlocked?`) with required typed methods. Tools always have access to context; no silent no-ops if a callback was forgotten.

---

## Section 5 — Renderer Cleanup

### `StreamStateContext`

Replace `useState` + `useCallback` tangle with `useReducer`. Actions: `START_STREAM`, `ADD_SEGMENT`, `END_STREAM`, `TIMEOUT`, `CLEAR`. State transitions are explicit and testable.

Extract `useStreamTimeout(projectId, timeoutMs, onTimeout)` hook — isolates timer management.

Extract `StreamEventParser` — pure functions decoding `IpcPushEvent` members into `StreamSegment` objects. No IPC-specific parsing inside the context.

Context value shrinks to `{ state, dispatch }`. Components read `state[projectId]` directly.

### `usePendingApproval<T>` hook

Shared hook for the three near-identical pending approval modals:

```typescript
function usePendingApproval<T>(config: {
  fetch: () => Promise<T[]>
  approve: (item: T) => Promise<void>
  reject: (item: T) => Promise<void>
  pushEventType: IpcPushEvent["type"]
}): { pending: T[]; approve: (item: T) => void; reject: (item: T) => void }
```

`PendingCommandModal`, `PendingPathModal`, `PendingToolModal` each become ~30 LOC calling this hook.

### `useSettings()` hook

Single source for `GET_SETTINGS` across `LeftSidebar`, `ChatPanel`, `MessageInput`, `useProviderSettings`. Subscribes to `SETTINGS_UPDATED` push event once, caches result in module-level ref so concurrent callers don't each fire a separate IPC call.

### `useProjects()` hook

Same pattern for duplicate project-list fetches in `LeftSidebar`.

### `ErrorBoundary`

Wrap `AppShell` with a React `ErrorBoundary`. Component crashes render a "Something went wrong — reload" prompt instead of blank screen.

### Bug fix

- `useProviderSettings` — add specific credential property to `useEffect` dependency array (currently missing, so model list doesn't refresh when API key changes).

---

## Section 6 — Testing Strategy

### Critical path tests (currently zero coverage)

| File | What to test |
|------|-------------|
| `chat-handlers.ts` | Message send, abort, throttle, error paths; mock `SessionManager` + `AgentSession` |
| `MessagePipeline.ts` (post-split) | Each extracted unit gets its own test file — no mocking needed for pure units |
| `artifact-handlers.ts` | File tree traversal, `PathJailFactory` integration, access control |

### Contract tests

| Target | What to test |
|--------|-------------|
| `IpcClient` | Typed invoke returns `IpcResult<T>`; `on()` unsubscribes correctly |
| `wrapIpc` | throw → `{ ok: false }`; success → `{ ok: true }` |
| `AgentProgressEvent` | Each event kind round-trips through emit → parse |

### Renderer unit tests

| Target | What to test |
|--------|-------------|
| `StreamStateContext` reducer | Pure state transitions, no mocking |
| `StreamEventParser` | Pure parsing functions, no mocking |
| `usePendingApproval` | Mock `ipc`, verify fetch/approve/subscribe lifecycle |
| `useSettings`, `useProjects` | Mock `ipc`, verify deduplication and SETTINGS_UPDATED invalidation |

### Lint rules (catch regressions automatically)

1. Ban `window.electronAPI` outside `src/renderer/lib/ipc-client.ts`
2. Ban type assertions on IPC results

---

## Implementation Order

1. **`src/shared/`** — `IpcResult<T>`, `IpcPushEvent`, `AgentProgressEvent`, extend `IpcRequestMap`/`IpcResponseMap`
2. **`IpcClient`** — typed renderer wrapper; add Biome rules
3. **`wrapIpc` + `emitPush`** — main utilities; update all handlers; remove `CrystallizationService`; thin `HomeService`; fix rate limiter
4. **Agent decomposition** — `ModelRegistry`, `SystemPromptBuilder`, `MessageContextPruner`, `AgentFactory`, `PathJailFactory`, `tools.ts`
5. **Renderer cleanup** — `StreamStateContext` reducer, `usePendingApproval`, `useSettings`, `useProjects`, `ErrorBoundary`
6. **Tests** — critical path + contract + renderer unit tests

Each step leaves the codebase in a shippable state. Steps 1–3 can be reviewed as one PR; steps 4–6 as separate PRs.
