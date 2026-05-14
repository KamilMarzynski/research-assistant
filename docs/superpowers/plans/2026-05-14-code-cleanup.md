# Code Cleanup — Contract-First Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate stringly-typed IPC, inconsistent error handling, dead code, and god objects — leaving the codebase easy to test, extend, and maintain.

**Architecture:** Contract-first: define `IpcResult<T>`, `IpcPushEvent`, and `AgentProgressEvent` in `src/shared/` first, then update main handlers to emit them via `wrapIpc`/`emitPush`, then update renderer to consume them via a typed `IpcClient`. Agent internals (MessagePipeline, tools.ts) are decomposed in a separate phase. Renderer state cleanup follows.

**Tech Stack:** TypeScript strict, Bun, Vitest, Biome v2, React 19, TSyringe, Electron IPC, `@mariozechner/pi-agent-core`

---

## PR Boundaries

- **PR 1:** Tasks 1–11 (shared contracts → IpcClient → main handler cleanup → event consolidation → dead code + bug fixes)
- **PR 2:** Tasks 12–15 (agent decomposition — ModelRegistry, pruner, prompt builder, PathJailFactory, tools.ts)
- **PR 3:** Tasks 16–21 (renderer cleanup + critical tests)

---

## Phase 1 — Shared Contracts

### Task 1: Add `IpcResult<T>` and `IpcRequestMap` to shared types

**Files:**
- Modify: `src/shared/ipc-types.ts`

- [ ] **Step 1: Add `IpcResult<T>` and `IpcRequestMap` to `ipc-types.ts`**

Open `src/shared/ipc-types.ts`. Add at the top, before `IpcResponseMap`:

```typescript
/** Unified return shape for all ipcMain.handle handlers */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/** Typed request payloads for all invoke() channels */
export interface IpcRequestMap {
  GET_PROJECTS: undefined;
  CREATE_PROJECT: { name: string; folderPath: string };
  RENAME_PROJECT: { id: string; name: string };
  DELETE_PROJECT: { id: string };
  GET_ARTIFACTS: { projectId: string };
  GET_PROJECT_ARTIFACTS: { projectId: string };
  GET_RESEARCHES: { projectId: string };
  GET_MESSAGES: { projectId: string };
  GET_SETTINGS: undefined;
  SAVE_SETTINGS: {
    activeProvider?: string;
    defaultCloudProvider?: string;
    providerCredentials?: unknown;
    langfuseEnabled?: boolean;
    webAccessEnabled?: boolean;
    theme?: "light" | "dark" | "system";
  };
  OPEN_FOLDER_DIALOG: undefined;
  LINK_FOLDER: { projectId: string; folderPath: string };
  UNLINK_FOLDER: { id: string };
  RETRY_RESEARCH: { projectId: string; query: string };
  READ_ARTIFACT_FILE: { filePath: string; projectId: string };
  GET_FILE_TREE: { projectId: string };
  REVEAL_IN_FOLDER: { filePath: string; projectId: string };
  GET_PENDING_TOOLS: undefined;
  APPROVE_TOOL: { name: string };
  REJECT_TOOL: { name: string };
  GET_SKILLS: undefined;
  TOGGLE_SKILL: { name: string; enabled: boolean };
  DELETE_SKILL: { name: string };
  GET_AUDIT_LOG: undefined;
  CLEAR_AUDIT_LOG: undefined;
  RESOLVE_BLOCKED_COMMAND: {
    commandId: string;
    action: "approve_once" | "approve_session" | "deny";
    projectId?: string;
  };
  GET_PENDING_PATH_APPROVALS: undefined;
  RESOLVE_PATH_APPROVAL: {
    path: string;
    mode: "read" | "write";
    action: "approve_once" | "approve_session" | "deny";
    projectId: string;
  };
  CHECK_OLLAMA: string;
  GET_PROVIDER_MODELS: GetProviderModelsRequest;
  SEND_MESSAGE: { projectId: string; content: string };
  ABORT_MESSAGE: { projectId: string };
  SET_PROJECT_MODEL: { projectId: string; modelOverride: string };
}
```

- [ ] **Step 2: Run typecheck to verify no breakage**

```bash
bun run typecheck
```

Expected: zero errors (no callers use `IpcRequestMap` yet — it's additive).

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat(shared): add IpcResult<T> and IpcRequestMap"
```

---

### Task 2: Add `AgentProgressEvent` and `IpcPushEvent` to shared types

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-types.ts`

- [ ] **Step 1: Add `AGENT_PROGRESS` channel and remove consolidated channels from IPC enum**

In `src/shared/ipc-channels.ts`, replace the push section:

```typescript
  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  AGENT_PROGRESS: "AGENT_PROGRESS",   // replaces TOOL_START, TOOL_END, RESEARCH_STATUS_UPDATE, RESEARCH_COMPLETE
  TOOL_PENDING: "TOOL_PENDING",
  BASH_BLOCKED: "BASH_BLOCKED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
```

Remove these lines:
```typescript
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
  TOOL_START: "TOOL_START",
  TOOL_END: "TOOL_END",
```

- [ ] **Step 2: Add `AgentProgressEvent` and `IpcPushEvent` to `ipc-types.ts`**

Add after `IpcResult<T>`:

```typescript
/** Extensible tagged union for all agent execution progress events.
 * Adding a new event = one new union member here + one emitPush() call in main. */
export type AgentProgressEvent =
  // Research lifecycle (replaces RESEARCH_STATUS_UPDATE + RESEARCH_COMPLETE)
  | { kind: "research_started"; taskId: string; projectId: string; query: string }
  | { kind: "research_step"; taskId: string; message: string; label?: string }
  | { kind: "research_complete"; taskId: string; projectId: string; query: string; artifactId?: string; filePaths: string[] }
  | { kind: "research_failed"; taskId: string; projectId: string; query: string; error: string }
  // Tool execution (replaces TOOL_START + TOOL_END)
  | { kind: "tool_call_start"; projectId: string; toolCallId: string; toolName: string; description: string }
  | { kind: "tool_call_end"; projectId: string; toolCallId: string; toolName: string; isError: boolean };

/** Discriminated union covering every webContents.send() call from main → renderer.
 * All push channels must have an entry here. */
export type IpcPushEvent =
  | { type: "MESSAGE_CHUNK"; projectId: string; delta: string }
  | { type: "MESSAGE_DONE"; projectId: string }
  | { type: "AGENT_PROGRESS"; event: AgentProgressEvent }
  | { type: "NEW_MESSAGE"; projectId: string; message: Message }
  | { type: "SETTINGS_UPDATED"; settings: SettingsResponse }
  | { type: "BASH_BLOCKED" } & BlockedCommandPayload
  | { type: "TOOL_PENDING" } & PendingTool
  | { type: "PATH_APPROVAL_REQUIRED" } & PathApprovalPayload;
```

Note: `BASH_BLOCKED`, `TOOL_PENDING`, `PATH_APPROVAL_REQUIRED` spread their payload directly into the event shape (matching existing `webContents.send` call sites).

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: errors only in files that reference removed channels (`TOOL_START`, `TOOL_END`, `RESEARCH_STATUS_UPDATE`, `RESEARCH_COMPLETE`). These will be fixed in Tasks 6–8.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/shared/ipc-types.ts
git commit -m "feat(shared): add AgentProgressEvent and IpcPushEvent discriminated unions"
```

---

### Task 3: Write unit tests for `AgentProgressEvent` shapes

**Files:**
- Create: `src/shared/__tests__/ipc-types.test.ts`

- [ ] **Step 1: Write tests**

Create `src/shared/__tests__/ipc-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { AgentProgressEvent, IpcPushEvent, IpcResult } from "../ipc-types";

describe("IpcResult", () => {
  it("ok variant has data", () => {
    const r: IpcResult<string> = { ok: true, data: "hello" };
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe("hello");
  });

  it("error variant has error and code", () => {
    const r: IpcResult<string> = { ok: false, error: "Not found", code: "NOT_FOUND" };
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Not found");
      expect(r.code).toBe("NOT_FOUND");
    }
  });
});

describe("AgentProgressEvent", () => {
  it("research_started is a valid AgentProgressEvent", () => {
    const e: AgentProgressEvent = {
      kind: "research_started",
      taskId: "t1",
      projectId: "p1",
      query: "test",
    };
    expect(e.kind).toBe("research_started");
  });

  it("tool_call_start is a valid AgentProgressEvent", () => {
    const e: AgentProgressEvent = {
      kind: "tool_call_start",
      projectId: "p1",
      toolCallId: "tc1",
      toolName: "read_file",
      description: "Reading file",
    };
    expect(e.kind).toBe("tool_call_start");
  });
});

describe("IpcPushEvent", () => {
  it("AGENT_PROGRESS event is typed", () => {
    const e: IpcPushEvent = {
      type: "AGENT_PROGRESS",
      event: { kind: "research_started", taskId: "t1", projectId: "p1", query: "q" },
    };
    expect(e.type).toBe("AGENT_PROGRESS");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun run test src/shared/__tests__/ipc-types.test.ts
```

Expected: all pass (these are compile-time type tests with minimal runtime assertions).

- [ ] **Step 3: Commit**

```bash
git add src/shared/__tests__/ipc-types.test.ts
git commit -m "test(shared): add IpcResult and AgentProgressEvent type tests"
```

---

## Phase 2 — Typed Renderer IPC Client

### Task 4: Create `IpcClient` with tests

**Files:**
- Create: `src/renderer/lib/ipc-client.ts`
- Create: `src/renderer/lib/__tests__/ipc-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/lib/__tests__/ipc-client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../../shared/ipc-types";
import { IpcClient } from "../ipc-client";

const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  generateUuid: vi.fn(() => "uuid"),
};

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { electronAPI: mockElectronAPI },
    writable: true,
  });
  vi.clearAllMocks();
});

describe("IpcClient.invoke", () => {
  it("returns data when ok", async () => {
    const result: IpcResult<string[]> = { ok: true, data: ["a", "b"] };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    const data = await client.invoke("GET_PROJECTS");
    expect(data).toEqual(["a", "b"]);
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("GET_PROJECTS", undefined);
  });

  it("throws when not ok", async () => {
    const result: IpcResult<never> = { ok: false, error: "Not found", code: "NOT_FOUND" };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    await expect(client.invoke("GET_PROJECTS")).rejects.toThrow("Not found");
  });

  it("passes payload to electronAPI", async () => {
    const result: IpcResult<unknown> = { ok: true, data: undefined };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    await client.invoke("GET_MESSAGES", { projectId: "p1" });
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("GET_MESSAGES", { projectId: "p1" });
  });
});

describe("IpcClient.on", () => {
  it("subscribes and returns unsubscribe", () => {
    const unsub = vi.fn(() => {});
    mockElectronAPI.on.mockReturnValue(unsub);
    const client = new IpcClient();
    const handler = vi.fn();
    const off = client.on("AGENT_PROGRESS", handler);
    expect(mockElectronAPI.on).toHaveBeenCalledWith("AGENT_PROGRESS", expect.any(Function));
    off();
    expect(unsub).toHaveBeenCalled();
  });

  it("calls handler with narrowed event", () => {
    let capturedCallback: ((data: unknown) => void) | undefined;
    mockElectronAPI.on.mockImplementation((_ch: string, cb: (data: unknown) => void) => {
      capturedCallback = cb;
      return vi.fn();
    });
    const client = new IpcClient();
    const handler = vi.fn();
    client.on("MESSAGE_CHUNK", handler);
    const event = { type: "MESSAGE_CHUNK", projectId: "p1", delta: "hello" };
    capturedCallback?.(event);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/renderer/lib/__tests__/ipc-client.test.ts
```

Expected: FAIL — `IpcClient` module not found.

- [ ] **Step 3: Create `src/renderer/lib/ipc-client.ts`**

```typescript
import type {
  AgentProgressEvent,
  IpcPushEvent,
  IpcRequestMap,
  IpcResponseMap,
  IpcResult,
} from "../../shared/ipc-types";

export type { AgentProgressEvent, IpcPushEvent };

export class IpcClient {
  async invoke<K extends keyof IpcRequestMap & keyof IpcResponseMap>(
    channel: K,
    payload?: IpcRequestMap[K],
  ): Promise<IpcResponseMap[K]> {
    const result = (await window.electronAPI.invoke(
      channel as Parameters<typeof window.electronAPI.invoke>[0],
      payload,
    )) as IpcResult<IpcResponseMap[K]>;
    if (!result.ok) {
      const err = new Error(result.error);
      (err as NodeJS.ErrnoException).code = result.code;
      throw err;
    }
    return result.data;
  }

  on<T extends IpcPushEvent["type"]>(
    type: T,
    handler: (event: Extract<IpcPushEvent, { type: T }>) => void,
  ): () => void {
    return window.electronAPI.on(
      type as Parameters<typeof window.electronAPI.on>[0],
      (data) => handler(data as Extract<IpcPushEvent, { type: T }>),
    );
  }
}

export const ipc = new IpcClient();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/renderer/lib/__tests__/ipc-client.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/ipc-client.ts src/renderer/lib/__tests__/ipc-client.test.ts
git commit -m "feat(renderer): add typed IpcClient wrapping window.electronAPI"
```

---

### Task 5: Add Biome lint rules banning raw `window.electronAPI`

**Files:**
- Modify: `biome.json`
- Modify: `src/renderer/electron.d.ts`

- [ ] **Step 1: Add `noRestrictedGlobals` rule to biome.json**

In `biome.json`, update the `linter.rules` block:

```json
"linter": {
  "enabled": true,
  "rules": {
    "recommended": true,
    "style": {
      "noRestrictedGlobals": {
        "level": "error",
        "options": {
          "deniedGlobals": [
            {
              "name": "window.electronAPI",
              "message": "Use ipc from src/renderer/lib/ipc-client.ts instead of window.electronAPI directly."
            }
          ]
        }
      }
    }
  }
}
```

Note: Biome's `noRestrictedGlobals` only catches bare identifiers. For member access (`window.electronAPI`), use `noRestrictedSyntax` if available, otherwise document as a code-review convention. For now, add a comment to `electron.d.ts`:

- [ ] **Step 2: Add deprecation comment to `electron.d.ts`**

At the top of `src/renderer/electron.d.ts`, add:

```typescript
/**
 * @deprecated Do NOT use window.electronAPI directly.
 * Import { ipc } from "src/renderer/lib/ipc-client" instead.
 * Direct usage bypasses type safety and error handling contracts.
 */
```

- [ ] **Step 3: Run lint to verify no new errors**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add biome.json src/renderer/electron.d.ts
git commit -m "chore: document IpcClient as required entrypoint, deprecate window.electronAPI direct use"
```

---

## Phase 3 — Main Handler Cleanup

### Task 6: Create `wrapIpc` and `emitPush` utilities with tests

**Files:**
- Create: `src/main/ipc/wrap-ipc.ts`
- Create: `src/main/ipc/emit-push.ts`
- Create: `src/main/ipc/__tests__/wrap-ipc.test.ts`

- [ ] **Step 1: Write failing test for `wrapIpc`**

Create `src/main/ipc/__tests__/wrap-ipc.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { wrapIpc } from "../wrap-ipc";

describe("wrapIpc", () => {
  it("returns ok:true with data on success", async () => {
    const result = await wrapIpc(async () => [1, 2, 3]);
    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it("returns ok:false with error message on throw", async () => {
    const result = await wrapIpc(async () => {
      throw new Error("Something failed");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Something failed");
      expect(result.code).toBe("UNKNOWN");
    }
  });

  it("uses err.code if present", async () => {
    const result = await wrapIpc(async () => {
      const err = new Error("Not found") as NodeJS.ErrnoException;
      err.code = "NOT_FOUND";
      throw err;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/ipc/__tests__/wrap-ipc.test.ts
```

Expected: FAIL — `wrap-ipc` module not found.

- [ ] **Step 3: Create `src/main/ipc/wrap-ipc.ts`**

```typescript
import type { IpcResult } from "../../shared/ipc-types";

export async function wrapIpc<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: e.message ?? String(err), code: e.code ?? "UNKNOWN" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/ipc/__tests__/wrap-ipc.test.ts
```

Expected: all pass.

- [ ] **Step 5: Create `src/main/ipc/emit-push.ts`**

```typescript
import type { BrowserWindow } from "electron";
import type { IpcPushEvent } from "../../shared/ipc-types";

export function emitPush(win: BrowserWindow, event: IpcPushEvent): void {
  win.webContents.send(event.type, event);
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/wrap-ipc.ts src/main/ipc/emit-push.ts src/main/ipc/__tests__/wrap-ipc.test.ts
git commit -m "feat(ipc): add wrapIpc utility and emitPush helper"
```

---

### Task 7: Update all `ipcMain.handle` handlers to use `wrapIpc`

**Files:**
- Modify: `src/main/ipc/settings-handlers.ts`
- Modify: `src/main/ipc/project-handlers.ts`
- Modify: `src/main/ipc/artifact-handlers.ts`
- Modify: `src/main/ipc/research-handlers.ts`
- Modify: `src/main/ipc/admin-handlers.ts`
- Modify: `src/main/ipc/command-handlers.ts`
- Modify: `src/main/ipc/chat-handlers.ts`

The pattern for each handler changes from:

```typescript
// Before
ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
  const p = parseOrThrow(ProjectIdSchema, payload, "GET_MESSAGES");
  return messageService.getHistory(p.projectId);
});
```

To:

```typescript
// After
ipcMain.handle(IPC.GET_MESSAGES, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_MESSAGES");
    return messageService.getHistory(p.projectId);
  }),
);
```

- [ ] **Step 1: Update `settings-handlers.ts`**

Add import at top:
```typescript
import { wrapIpc } from "./wrap-ipc";
```

Wrap all four handlers: `GET_SETTINGS`, `SAVE_SETTINGS`, `CHECK_OLLAMA`, `GET_PROVIDER_MODELS`.

For `GET_SETTINGS`:
```typescript
ipcMain.handle(IPC.GET_SETTINGS, () =>
  wrapIpc(async () => {
    const settings = await settingsService.getSettings();
    const activeCreds = settings.providerCredentials[settings.activeProvider];
    const isOllama = settings.activeProvider === "ollama";
    const activeApiKey = "apiKey" in activeCreds ? (activeCreds.apiKey ?? null) : null;
    return {
      hasApiKey: isOllama || (activeApiKey !== null && activeApiKey !== ""),
      activeProvider: settings.activeProvider,
      defaultCloudProvider: settings.defaultCloudProvider,
      providerCredentials: settings.providerCredentials,
      langfuseEnabled: settings.langfuseEnabled,
      webAccessEnabled: settings.webAccessEnabled,
      theme: settings.theme,
    };
  }),
);
```

Note: `SAVE_SETTINGS` uses `event.sender.send(IPC.SETTINGS_UPDATED, ...)` — keep that inside the `wrapIpc` callback but switch to `emitPush` in Task 8.

- [ ] **Step 2: Update `project-handlers.ts`**

Add import: `import { wrapIpc } from "./wrap-ipc";`

Wrap all project handlers: `GET_PROJECTS`, `CREATE_PROJECT`, `RENAME_PROJECT`, `DELETE_PROJECT`, `LINK_FOLDER`, `UNLINK_FOLDER`, `SET_PROJECT_MODEL`.

- [ ] **Step 3: Update `artifact-handlers.ts`**

Add import: `import { wrapIpc } from "./wrap-ipc";`

Wrap: `GET_ARTIFACTS`, `GET_FILE_TREE`, `READ_ARTIFACT_FILE`, `GET_PROJECT_ARTIFACTS`, `REVEAL_IN_FOLDER`.

- [ ] **Step 4: Update `research-handlers.ts`, `admin-handlers.ts`, `command-handlers.ts`**

Add `wrapIpc` import to each and wrap all handlers.

- [ ] **Step 5: Update `chat-handlers.ts`**

Add import: `import { wrapIpc } from "./wrap-ipc";`

Wrap `GET_MESSAGES` and `ABORT_MESSAGE`. `SEND_MESSAGE` is special — it has complex error handling that must stay. Wrap just its outer body:
```typescript
ipcMain.handle(IPC.SEND_MESSAGE, (_event, payload: unknown) =>
  wrapIpc(async () => {
    // ... existing SEND_MESSAGE body unchanged for now
  }),
);
```

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero typecheck errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/settings-handlers.ts src/main/ipc/project-handlers.ts \
  src/main/ipc/artifact-handlers.ts src/main/ipc/research-handlers.ts \
  src/main/ipc/admin-handlers.ts src/main/ipc/command-handlers.ts src/main/ipc/chat-handlers.ts
git commit -m "refactor(ipc): wrap all ipcMain.handle handlers with wrapIpc"
```

---

### Task 8: Consolidate push events — update `event-forwarders.ts` to emit `AGENT_PROGRESS`

**Files:**
- Modify: `src/main/ipc/event-forwarders.ts`
- Modify: `src/main/ipc/settings-handlers.ts`
- Modify: `src/main/ipc/chat-handlers.ts`

All `webContents.send` calls switch to `emitPush`.

- [ ] **Step 1: Rewrite `event-forwarders.ts`**

Replace the entire file:

```typescript
import { type BrowserWindow, Notification } from "electron";
import type { EventBus } from "../event-bus";
import { emitPush } from "./emit-push";
import type { SessionManager } from "./session-manager";

export function registerEventForwarders(
  win: BrowserWindow,
  deps: { eventBus: EventBus; sessionManager: SessionManager },
): void {
  const { eventBus, sessionManager } = deps;

  eventBus.on("research:started", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: { kind: "research_started", taskId: payload.taskId, projectId: payload.projectId, query: payload.query },
    });
  });

  eventBus.on("research:progress", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: { kind: "research_step", taskId: payload.taskId, message: payload.message, label: payload.label },
    });
  });

  eventBus.on("research:complete", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "research_complete",
        taskId: payload.taskId,
        projectId: payload.projectId,
        query: payload.query,
        artifactId: payload.artifactId,
        filePaths: payload.filePaths,
      },
    });

    if (!win.isFocused()) {
      const notification = new Notification({
        title: "Research Complete",
        body: String(payload.query).slice(0, 80),
      });
      notification.show();
      notification.on("click", () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
    }

    const session = sessionManager.get(payload.projectId);
    if (session) {
      const filePathsStr = payload.filePaths.length > 0 ? payload.filePaths.join(", ") : "none";
      session
        .queueFollowUp(
          `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${filePathsStr}. Please briefly summarise the findings for the user.`,
        )
        .catch((err) => console.error("[event-forwarders] queueFollowUp failed:", err));
    }
  });

  eventBus.on("research:failed", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: { kind: "research_failed", taskId: payload.taskId, projectId: payload.projectId, query: payload.query, error: payload.error },
    });
  });

  eventBus.on("tool:pending", (payload) => {
    emitPush(win, { type: "TOOL_PENDING", name: payload.name, skillContent: payload.skillContent });
  });

  eventBus.on("bash:blocked", (payload) => {
    emitPush(win, { type: "BASH_BLOCKED", ...payload });
  });

  eventBus.on("path:approval_required", (payload) => {
    emitPush(win, { type: "PATH_APPROVAL_REQUIRED", ...payload });
  });

  eventBus.on("agent:tool_start", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "tool_call_start",
        projectId: payload.projectId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        description: payload.description,
      },
    });
  });

  eventBus.on("agent:tool_end", (payload) => {
    emitPush(win, {
      type: "AGENT_PROGRESS",
      event: {
        kind: "tool_call_end",
        projectId: payload.projectId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        isError: payload.isError,
      },
    });
  });
}
```

- [ ] **Step 2: Update `chat-handlers.ts` — replace raw `win.webContents.send` calls**

In `chat-handlers.ts`, import `emitPush`:
```typescript
import { emitPush } from "./emit-push";
```

Replace all `win.webContents.send(IPC.MESSAGE_CHUNK, ...)` calls:
```typescript
// Before
win.webContents.send(IPC.MESSAGE_CHUNK, { projectId, delta: "..." });
// After
emitPush(win, { type: "MESSAGE_CHUNK", projectId, delta: "..." });
```

Replace all `win.webContents.send(IPC.MESSAGE_DONE, ...)` calls:
```typescript
emitPush(win, { type: "MESSAGE_DONE", projectId });
```

Also replace the EventBus listeners at the top of `registerChatHandler`:
```typescript
// Before
eventBus.on("agent:chunk", (payload) => {
  win.webContents.send(IPC.MESSAGE_CHUNK, { projectId: payload.projectId, delta: payload.delta });
});
eventBus.on("agent:done", (payload) => {
  win.webContents.send(IPC.MESSAGE_DONE, { projectId: payload.projectId });
});
// After
eventBus.on("agent:chunk", (payload) => {
  emitPush(win, { type: "MESSAGE_CHUNK", projectId: payload.projectId, delta: payload.delta });
});
eventBus.on("agent:done", (payload) => {
  emitPush(win, { type: "MESSAGE_DONE", projectId: payload.projectId });
});
```

- [ ] **Step 3: Update `settings-handlers.ts` — replace `event.sender.send`**

In `SAVE_SETTINGS` handler, replace:
```typescript
// Before
event.sender.send(IPC.SETTINGS_UPDATED, { ... });
// After — need BrowserWindow reference
```

The `event.sender` is the `WebContents`. For `emitPush` we need a `BrowserWindow`. Change the handler registration to accept `win` as a parameter:

In `registerSettingsHandlers`, add `win: BrowserWindow` to the deps destructuring or as a first arg. The call site in `register.ts` already passes `win`. Update the signature:

```typescript
export function registerSettingsHandlers(
  win: Electron.BrowserWindow,
  deps: { settingsService: SettingsService; sessionManager: SessionManager; projectService: ProjectService },
): void {
```

Then in `SAVE_SETTINGS`:
```typescript
emitPush(win, { type: "SETTINGS_UPDATED", settings: { hasApiKey, activeProvider, ... } });
```

- [ ] **Step 4: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all tests pass. (Some tests may need updating if they checked for old channel names — fix those.)

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/event-forwarders.ts src/main/ipc/chat-handlers.ts src/main/ipc/settings-handlers.ts
git commit -m "refactor(ipc): consolidate push events via emitPush and AGENT_PROGRESS channel"
```

---

### Task 9: Remove dead code — `CrystallizationService` and `HomeService` delegation

**Files:**
- Delete: `src/main/services/CrystallizationService.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/services/index.ts`
- Modify: `src/main/ipc/register.ts` (inject services directly where HomeService delegation was used)

- [ ] **Step 1: Remove `CrystallizationService` from bootstrap.ts**

Find line `appContainer.registerSingleton(CrystallizationService);` in `src/main/bootstrap.ts` and remove it along with the import.

- [ ] **Step 2: Delete `CrystallizationService.ts`**

```bash
rm src/main/services/CrystallizationService.ts
```

Remove its export from `src/main/services/index.ts` if present.

- [ ] **Step 3: Strip `HomeService` to directory-setup only**

In `src/main/services/HomeService.ts`:
- Remove `@inject(TaskPersistenceService)`, `@inject(SkillManagementService)`, `@inject(ToolApprovalService)` constructor parameters
- Remove all delegation methods: `saveTask`, `deleteTask`, `getInProgressTasks`, `getTasksByProject`, `updateTaskStatus`, `migrateTasksFromJson`, `savePendingTool`, `getPendingTools`, `approvePendingTool`, `rejectPendingTool`, `getSkills`, `toggleSkill`, `deleteSkill`
- Keep: `getHomePath()`, `ensureDirectories()`, `isFirstRun()`, `ensureWorkspaceForProject()`, `copyBuiltinSkillsIfNeeded()`, `ensureSkillDir()`

The stripped `HomeService` constructor becomes:
```typescript
@injectable()
export class HomeService {
  getHomePath(): string { return getHomePath(); }
  async ensureDirectories(): Promise<void> { /* ... existing implementation ... */ }
  async isFirstRun(): Promise<boolean> { /* ... existing implementation ... */ }
  async ensureWorkspaceForProject(slug: string): Promise<string> { /* ... */ }
  private async copyBuiltinSkillsIfNeeded(): Promise<void> { /* ... */ }
  private async ensureSkillDir(...): Promise<void> { /* ... */ }
}
```

- [ ] **Step 4: Update callers that used HomeService delegation**

In `src/main/ipc/register.ts` and any handler files that called `homeService.saveTask(...)`, `homeService.getPendingTools()`, `homeService.getSkills()` etc.:

Add direct injection of `TaskPersistenceService`, `ToolApprovalService`, `SkillManagementService` from the container, and call them directly.

In `register.ts`:
```typescript
import { TaskPersistenceService } from "../services/TaskPersistenceService";
import { ToolApprovalService } from "../services/ToolApprovalService";
import { SkillManagementService } from "../services/SkillManagementService";

// inside registerIpcHandlers:
const taskPersistenceService = container.resolve(TaskPersistenceService);
const toolApprovalService = container.resolve(ToolApprovalService);
const skillManagementService = container.resolve(SkillManagementService);
```

Pass these to the relevant handler registration functions instead of `homeService`.

In `chat-handlers.ts`, the `proposeSkillFn` callback currently calls `homeService.savePendingTool(...)`. Update to call `toolApprovalService.savePendingTool(...)` directly.

- [ ] **Step 5: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(services): remove CrystallizationService, strip HomeService to directory-setup only"
```

---

### Task 10: Fix rate limiter race condition in `chat-handlers.ts`

**Files:**
- Modify: `src/main/ipc/chat-handlers.ts`
- Create: `src/main/ipc/__tests__/chat-handlers-throttle.test.ts`

The current bug: two concurrent `SEND_MESSAGE` calls both read `last = 0`, sleep 500ms, and both proceed — bypassing the throttle.

- [ ] **Step 1: Write failing test**

Create `src/main/ipc/__tests__/chat-handlers-throttle.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { SendThrottle } from "../send-throttle";

describe("SendThrottle", () => {
  it("serializes concurrent sends for same projectId", async () => {
    const order: number[] = [];
    const throttle = new SendThrottle(0); // 0ms interval for test
    
    const p1 = throttle.acquire("proj1").then(async (release) => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      release();
    });
    const p2 = throttle.acquire("proj1").then(async (release) => {
      order.push(3);
      release();
    });
    
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]); // p2 waits for p1 to finish
  });

  it("allows concurrent sends for different projectIds", async () => {
    const order: number[] = [];
    const throttle = new SendThrottle(0);
    
    const p1 = throttle.acquire("proj1").then(async (release) => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
      release();
    });
    const p2 = throttle.acquire("proj2").then(async (release) => {
      order.push(3);
      release();
    });
    
    await Promise.all([p1, p2]);
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
    // proj2 can run before proj1 finishes
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/ipc/__tests__/chat-handlers-throttle.test.ts
```

Expected: FAIL — `SendThrottle` not found.

- [ ] **Step 3: Create `src/main/ipc/send-throttle.ts`**

```typescript
export class SendThrottle {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly lastSendTimes = new Map<string, number>();
  private readonly MAX_KEYS = 500;

  constructor(private readonly throttleMs: number = 500) {}

  async acquire(projectId: string): Promise<() => void> {
    // Bounded cleanup to prevent memory leak
    if (this.locks.size > this.MAX_KEYS) {
      this.locks.clear();
      this.lastSendTimes.clear();
    }

    // Wait for any in-progress send for this project
    const existing = this.locks.get(projectId);
    if (existing) await existing;

    // Throttle: wait until minimum interval has elapsed
    const last = this.lastSendTimes.get(projectId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < this.throttleMs) {
      await new Promise<void>((r) => setTimeout(r, this.throttleMs - elapsed));
    }
    this.lastSendTimes.set(projectId, Date.now());

    // Register lock before returning so subsequent callers wait
    let release!: () => void;
    const lockPromise = new Promise<void>((r) => { release = r; });
    this.locks.set(projectId, lockPromise);

    const cleanup = () => {
      release();
      this.locks.delete(projectId);
    };

    return cleanup;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/main/ipc/__tests__/chat-handlers-throttle.test.ts
```

Expected: all pass.

- [ ] **Step 5: Replace module-scoped maps in `chat-handlers.ts` with `SendThrottle`**

In `src/main/ipc/chat-handlers.ts`:

Remove:
```typescript
const sendLocks = new Map<string, Promise<void>>();
const lastSendTimes = new Map<string, number>();
const THROTTLE_MS = 500;
```

Add at top of `registerChatHandler`:
```typescript
import { SendThrottle } from "./send-throttle";
// ...
const sendThrottle = new SendThrottle();
```

Replace the locking block in `SEND_MESSAGE` with:
```typescript
const release = await sendThrottle.acquire(projectId);
try {
  // ... rest of handler
} finally {
  release();
}
```

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/send-throttle.ts src/main/ipc/__tests__/chat-handlers-throttle.test.ts src/main/ipc/chat-handlers.ts
git commit -m "fix(ipc): replace race-prone module-scoped maps with SendThrottle in chat-handlers"
```

---

### Task 11: Create `PathJailFactory` and fix the `project.name` bug

**Files:**
- Create: `src/main/agent/path-jail-factory.ts`
- Create: `src/main/agent/__tests__/path-jail-factory.test.ts`
- Modify: `src/main/ipc/artifact-handlers.ts`

- [ ] **Step 1: Write failing test**

Create `src/main/agent/__tests__/path-jail-factory.test.ts`:

```typescript
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/types/project";
import { PathJailFactory } from "../path-jail-factory";

const mockAllowlist = { isAllowed: vi.fn(() => ({ allowed: true })) } as any;

describe("PathJailFactory", () => {
  const baseProject: Project = {
    id: "proj-1",
    name: "My Project",
    slug: "my-project-abc123",
    folderPath: "/home/user/myproject",
    projectPath: "/home/user/.scholar/projects/my-project-abc123",
    modelOverride: null,
    createdAt: new Date().toISOString(),
  };

  it("creates PathJail with projectPath not projectName", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const jail = factory.create(baseProject);
    expect(jail.projectId).toBe("proj-1");
    // Validate a path inside projectPath — should succeed
    expect(() => jail.validate(join(baseProject.projectPath!, "output.md"), "write")).not.toThrow();
  });

  it("falls back to slug-based path when projectPath is null", () => {
    const factory = new PathJailFactory(mockAllowlist);
    const project = { ...baseProject, projectPath: null };
    // Should not throw during construction
    expect(() => factory.create(project)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/agent/__tests__/path-jail-factory.test.ts
```

Expected: FAIL — `PathJailFactory` not found.

- [ ] **Step 3: Create `src/main/agent/path-jail-factory.ts`**

```typescript
import { join } from "node:path";
import { injectable, inject } from "tsyringe";
import type { Project } from "../../shared/types/project";
import { AllowlistService } from "../services/AllowlistService";
import { getScholarHome } from "../paths";
import { PathJail } from "./path-jail";

@injectable()
export class PathJailFactory {
  constructor(
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
  ) {}

  create(project: Project): PathJail {
    const projectPath =
      project.projectPath ?? join(getScholarHome(), "projects", project.slug ?? project.id);
    return new PathJail(
      project.id,
      project.slug ?? project.id,
      project.folderPath,
      projectPath,
      this.allowlistService,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/main/agent/__tests__/path-jail-factory.test.ts
```

Expected: all pass.

- [ ] **Step 5: Fix `artifact-handlers.ts` — replace manual PathJail construction**

In `src/main/ipc/artifact-handlers.ts`:
- Add `PathJailFactory` to the deps:
  ```typescript
  deps: { projectService: ProjectService; artifactService: ArtifactService; allowlistService: AllowlistService }
  ```
  Change to:
  ```typescript
  deps: { projectService: ProjectService; artifactService: ArtifactService; pathJailFactory: PathJailFactory }
  ```
- Replace all `new PathJail(project.id, project.slug ?? project.id, project.folderPath, project.name, allowlistService)` with `pathJailFactory.create(project)`.
- Update `register.ts` to resolve `PathJailFactory` and pass it.

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/path-jail-factory.ts src/main/agent/__tests__/path-jail-factory.test.ts \
  src/main/ipc/artifact-handlers.ts src/main/ipc/register.ts
git commit -m "fix(agent): add PathJailFactory, fix project.name passed as projectPath in artifact-handlers"
```

---

## Phase 4 — Agent Decomposition

### Task 12: Extract `ModelRegistry`

**Files:**
- Create: `src/main/agent/model-registry.ts`
- Create: `src/main/agent/__tests__/model-registry.test.ts`
- Modify: `src/main/agent/MessagePipeline.ts`

- [ ] **Step 1: Write failing test**

Create `src/main/agent/__tests__/model-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getContextWindow } from "../model-registry";

describe("getContextWindow", () => {
  it("returns 200_000 for claude-sonnet-4", () => {
    expect(getContextWindow("claude-sonnet-4-20250101")).toBe(200_000);
  });

  it("returns 200_000 for claude-3-opus", () => {
    expect(getContextWindow("claude-3-opus-20240229")).toBe(200_000);
  });

  it("returns 128_000 for gpt-4o", () => {
    expect(getContextWindow("gpt-4o-2024-11-20")).toBe(128_000);
  });

  it("returns 8_192 for gpt-4 base", () => {
    expect(getContextWindow("gpt-4-0613")).toBe(8_192);
  });

  it("returns 128_000 as default for unknown model", () => {
    expect(getContextWindow("unknown-model-xyz")).toBe(128_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/agent/__tests__/model-registry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/main/agent/model-registry.ts`**

```typescript
interface ModelEntry {
  pattern: string;
  contextWindow: number;
}

const MODEL_REGISTRY: ModelEntry[] = [
  { pattern: "claude-3-opus", contextWindow: 200_000 },
  { pattern: "claude-3-5-sonnet", contextWindow: 200_000 },
  { pattern: "claude-sonnet-4", contextWindow: 200_000 },
  { pattern: "claude-3-haiku", contextWindow: 200_000 },
  { pattern: "claude-haiku-4", contextWindow: 200_000 },
  { pattern: "gpt-4o", contextWindow: 128_000 },
  { pattern: "gpt-4-turbo", contextWindow: 128_000 },
  { pattern: "gpt-4", contextWindow: 8_192 },
  { pattern: "gpt-3.5", contextWindow: 16_384 },
];

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindow(modelId: string): number {
  const entry = MODEL_REGISTRY.find((e) => modelId.includes(e.pattern));
  return entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/main/agent/__tests__/model-registry.test.ts
```

Expected: all pass.

- [ ] **Step 5: Update `MessagePipeline.ts` to use `getContextWindow` from model-registry**

In `src/main/agent/MessagePipeline.ts`:
- Remove the local `getContextWindow` function (lines ~70–79)
- Add import: `import { getContextWindow } from "./model-registry";`

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/model-registry.ts src/main/agent/__tests__/model-registry.test.ts src/main/agent/MessagePipeline.ts
git commit -m "refactor(agent): extract ModelRegistry, replace hardcoded context window function"
```

---

### Task 13: Extract `MessageContextPruner`

**Files:**
- Create: `src/main/agent/message-context-pruner.ts`
- Create: `src/main/agent/__tests__/message-context-pruner.test.ts`
- Modify: `src/main/agent/MessagePipeline.ts`

- [ ] **Step 1: Write failing test**

Create `src/main/agent/__tests__/message-context-pruner.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pruneMessages } from "../message-context-pruner";

type Msg = { role: "user" | "assistant"; content: string };

const makeMsg = (role: "user" | "assistant", content: string): Msg => ({ role, content });

describe("pruneMessages", () => {
  it("returns all messages when total tokens under budget", () => {
    const messages = [makeMsg("user", "hi"), makeMsg("assistant", "hello")];
    const result = pruneMessages(messages as any, 200_000);
    expect(result).toHaveLength(2);
  });

  it("drops oldest messages when over budget", () => {
    // Budget of 40 tokens (160 chars), each message is 100 chars
    const messages = [
      makeMsg("user", "a".repeat(100)),
      makeMsg("assistant", "b".repeat(100)),
      makeMsg("user", "c".repeat(100)),
    ];
    const result = pruneMessages(messages as any, 40);
    // Should keep the last user message (minimum)
    expect(result.length).toBeLessThan(3);
    const last = result[result.length - 1];
    expect((last.content as string)[0]).toBe("c");
  });

  it("always keeps last user message even if over budget", () => {
    const messages = [makeMsg("user", "x".repeat(1000))];
    const result = pruneMessages(messages as any, 10);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/agent/__tests__/message-context-pruner.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/main/agent/message-context-pruner.ts`**

```typescript
import type { AgentMessage } from "@mariozechner/pi-agent-core";

const RESERVED_TOKENS = 6000;
const CHARS_PER_TOKEN = 4;

function extractMessageText(msg: { content: unknown }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ text?: string }>).map((c) => c?.text ?? "").join("");
  }
  return "";
}

export function pruneMessages(
  messages: AgentMessage[],
  contextWindow: number,
): AgentMessage[] {
  const availableTokens = contextWindow - RESERVED_TOKENS;
  let estimatedTokens = 0;
  const pruned: AgentMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = extractMessageText(msg);
    const msgTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    if (estimatedTokens + msgTokens > availableTokens) {
      if (msg.role === "user" && pruned.length === 0) pruned.unshift(msg);
      break;
    }
    estimatedTokens += msgTokens;
    pruned.unshift(msg);
  }
  return pruned;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/main/agent/__tests__/message-context-pruner.test.ts
```

Expected: all pass.

- [ ] **Step 5: Update `MessagePipeline.ts` to use `pruneMessages`**

Remove the `createTransformContext` function and the `extractMessageText` helper from `MessagePipeline.ts`.

Import:
```typescript
import { getContextWindow } from "./model-registry";
import { pruneMessages } from "./message-context-pruner";
```

Replace `createTransformContext(options.provider.model)` with:
```typescript
transformContext: async (messages) =>
  pruneMessages(messages, getContextWindow(options.provider.model)),
```

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/message-context-pruner.ts src/main/agent/__tests__/message-context-pruner.test.ts src/main/agent/MessagePipeline.ts
git commit -m "refactor(agent): extract MessageContextPruner pure function"
```

---

### Task 14: Extract `SystemPromptBuilder`

**Files:**
- Create: `src/main/agent/system-prompt-builder.ts`
- Create: `src/main/agent/__tests__/system-prompt-builder.test.ts`
- Modify: `src/main/agent/MessagePipeline.ts`

- [ ] **Step 1: Write failing test**

Create `src/main/agent/__tests__/system-prompt-builder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt-builder";

describe("buildSystemPrompt", () => {
  it("joins non-empty parts with double newline", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      memorySummary: "MEMORY",
      systemContext: "CONTEXT",
    });
    expect(result).toBe("BASE\n\nMEMORY\n\nCONTEXT");
  });

  it("omits empty parts", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      memorySummary: "",
      systemContext: undefined,
    });
    expect(result).toBe("BASE");
  });

  it("uses firstRunPrompt instead of basePrompt when isFirstRun is true", () => {
    const result = buildSystemPrompt({
      basePrompt: "BASE",
      firstRunPrompt: "FIRST_RUN",
      memorySummary: "",
      systemContext: "",
      isFirstRun: true,
    });
    expect(result).toBe("FIRST_RUN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/main/agent/__tests__/system-prompt-builder.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/main/agent/system-prompt-builder.ts`**

```typescript
export interface SystemPromptContext {
  basePrompt: string;
  firstRunPrompt?: string;
  memorySummary?: string;
  systemContext?: string;
  isFirstRun?: boolean;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const base = ctx.isFirstRun && ctx.firstRunPrompt ? ctx.firstRunPrompt : ctx.basePrompt;
  return [base, ctx.memorySummary, ctx.systemContext].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test src/main/agent/__tests__/system-prompt-builder.test.ts
```

Expected: all pass.

- [ ] **Step 5: Update `MessagePipeline.ts` to use `buildSystemPrompt`**

Import:
```typescript
import { buildSystemPrompt, type SystemPromptContext } from "./system-prompt-builder";
```

In the constructor, replace the inline `[..].filter(Boolean).join("\n\n")` for `systemPrompt` with:
```typescript
const systemPrompt = buildSystemPrompt({
  basePrompt: BASE_SYSTEM_PROMPT,
  firstRunPrompt: FIRST_RUN_SKILL,
  memorySummary: options.initialMemoryContext.summary,
  systemContext: options.systemContext,
  isFirstRun: options.isFirstRun,
});
```

In the `send()` method, replace the inline prompt rebuild:
```typescript
const newSystemPrompt = buildSystemPrompt({
  basePrompt: BASE_SYSTEM_PROMPT,
  memorySummary: memoryContext.summary,
  systemContext: await buildSystemContext(...),
});
```

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/system-prompt-builder.ts src/main/agent/__tests__/system-prompt-builder.test.ts src/main/agent/MessagePipeline.ts
git commit -m "refactor(agent): extract SystemPromptBuilder pure function"
```

---

### Task 15: Refactor `tools.ts` — introduce `ToolCapabilities` and `ToolContext`, remove `withDescription`

**Files:**
- Modify: `src/main/agent/tools.ts`

Goal: replace 14 conditional `tools.push()` calls with explicit `ToolCapabilities` config and `ToolContext` (required callbacks replacing loose optionals).

- [ ] **Step 1: Define `ToolCapabilities` and `ToolContext` interfaces**

In `src/main/agent/tools.ts`, replace `AgentToolsOptions` with:

```typescript
export interface ToolCapabilities {
  webAccess: boolean;
  memory: boolean;
  codeExecution: boolean;
  research: boolean;
  evaluation: boolean;
  spawn: boolean;
  proposeSkill: boolean;
  compression: boolean;
}

export interface ToolContext {
  projectId: string;
  slug: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  homePath: string;
  apiKey?: string;
  model?: string;
  allowlistService: AllowlistService;
  compressionService?: CompressionService;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  emitBlocked?: (payload: BlockedCommandPayload) => void;
  emitApprovalRequired?: (payload: { path: string; mode: "read" | "write"; projectId: string }) => void;
  startResearchFn?: (query: string, deep?: boolean) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>;
  spawnAgentFn?: (type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>;
  spawnAgentsParallelFn?: (agents: Array<{ type: AgentType; query: string; outputPath: string }>) => Promise<SpawnResult[]>;
  proposeSkillFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  saveMemoryFn?: (category: string, title: string, content: string, scope: "app" | "project") => Promise<{ path: string }>;
  readMemoryFn?: (options: { category?: string; query?: string; scope: "app" | "project" | "both" }) => Promise<string>;
  toolNames?: readonly AgentToolName[];
}
```

- [ ] **Step 2: Update `createAgentTools` signature**

Replace:
```typescript
export function createAgentTools(opts: AgentToolsOptions): AgentTool[]
```

With:
```typescript
export function createAgentTools(capabilities: ToolCapabilities, context: ToolContext): AgentTool[]

/** Convenience overload — infers capabilities from context for backward compat during migration */
export function createAgentTools(optsOrCaps: ToolCapabilities | ToolContext, context?: ToolContext): AgentTool[] {
  if (context === undefined) {
    // Legacy call: single opts object — derive capabilities
    const opts = optsOrCaps as ToolContext;
    const caps: ToolCapabilities = {
      webAccess: opts.webAccess ?? true,
      memory: !!(opts.saveMemoryFn || opts.readMemoryFn),
      codeExecution: true,
      research: !!opts.startResearchFn,
      evaluation: !!opts.requestEvaluationFn,
      spawn: !!(opts.spawnAgentFn || opts.spawnAgentsParallelFn),
      proposeSkill: !!opts.proposeSkillFn,
      compression: !!opts.compressionService,
    };
    return buildTools(caps, opts);
  }
  return buildTools(optsOrCaps as ToolCapabilities, context);
}
```

Add private `buildTools(caps, ctx)` that has the actual implementation. This keeps backward compat while callers migrate.

Note: The `AgentToolsOptions` type is preserved as an alias of `ToolContext` for the transition. Callers in `MessagePipeline.ts` and `worker-agent.ts` can be migrated to explicit `ToolCapabilities` in a follow-up.

- [ ] **Step 3: Remove `withDescription`**

The `withDescription` wrapper adds a `_description` field to every tool's schema but the extracted `_desc` is never logged or used. Remove it:

- Delete the `withDescription` function from `tools.ts`
- Remove the `.map(withDescription)` calls at the bottom of `createAgentTools` (or `buildTools`)
- The `beforeToolCall` in `MessagePipeline.ts` already reads `args._description` to populate `pendingToolDescriptions`. That logic can stay or be simplified to use `tool.label` directly; removing `withDescription` means `args._description` will always be undefined, so `tool.label ?? ctx.toolCall.name` becomes the effective description.

- [ ] **Step 4: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/MessagePipeline.ts
git commit -m "refactor(agent): introduce ToolCapabilities/ToolContext, remove unused withDescription wrapper"
```

---

> **Note — AgentFactory (deferred):** The spec calls for an `AgentFactory` to eliminate duplication between `MessagePipeline` (chat) and `worker-agent.ts` (background research). Both construct an `Agent` with subscription wiring and compression setup. This is a high-value refactor but requires thorough integration tests before the extract is safe. Defer to a follow-up PR once the critical-path tests in Phase 6 are in place.

---

## Phase 5 — Renderer Cleanup

### Task 16: Migrate renderer components to use `ipc` client

**Files:**
- Modify: `src/renderer/contexts/StreamStateContext.tsx`
- Modify: `src/renderer/components/layout/ResearchHistoryPanel.tsx`
- Modify: `src/renderer/hooks/usePendingItems.ts`
- Modify: all components that call `window.electronAPI.invoke()` or `window.electronAPI.on()`

This task replaces all `window.electronAPI.*` calls in the renderer with `ipc.*` calls.

- [ ] **Step 1: Update `StreamStateContext.tsx`**

Replace all `window.electronAPI.on(IPC.MESSAGE_CHUNK, ...)` etc. with `ipc.on(...)`:

```typescript
import { ipc } from "../../lib/ipc-client";

// Replace in useEffect:
const unsubChunk = ipc.on("MESSAGE_CHUNK", ({ projectId, delta }) => {
  if (!projectId) return;
  setStates((prev) => {
    // ... existing logic unchanged
  });
  startTimer(projectId);
});

const unsubDone = ipc.on("MESSAGE_DONE", ({ projectId }) => {
  if (!projectId) return;
  endStream(projectId);
});

const unsubProgress = ipc.on("AGENT_PROGRESS", ({ event }) => {
  if (event.kind === "tool_call_start") {
    const { projectId, toolCallId, toolName, description } = event;
    setStates((prev) => {
      const existing = prev[projectId];
      const segments = existing?.streamingSegments ? [...existing.streamingSegments] : [];
      segments.push({ type: "activity", toolCallId, toolName, description, status: "running" });
      return { ...prev, [projectId]: { streamingSegments: segments, processing: existing?.processing ?? true } };
    });
  } else if (event.kind === "tool_call_end") {
    const { projectId, toolCallId, isError } = event;
    setStates((prev) => {
      const existing = prev[projectId];
      if (!existing) return prev;
      const segments = existing.streamingSegments.map((seg) =>
        seg.type === "activity" && seg.toolCallId === toolCallId
          ? { ...seg, status: isError ? ("error" as const) : ("done" as const) }
          : seg,
      );
      return { ...prev, [projectId]: { ...existing, streamingSegments: segments } };
    });
  }
});

return () => {
  unsubChunk();
  unsubDone();
  unsubProgress();
  // ... timer cleanup unchanged
};
```

Remove imports of `decodeMessageChunk`, `decodeMessageDone`, `decodeToolStart`, `decodeToolEnd` from `ipc-guards`.

- [ ] **Step 2: Update `ResearchHistoryPanel.tsx`**

Replace `RESEARCH_STATUS_UPDATE` and `RESEARCH_COMPLETE` listeners with `AGENT_PROGRESS`:

```typescript
import { ipc } from "../../../lib/ipc-client";

const unsubProgress = ipc.on("AGENT_PROGRESS", ({ event }) => {
  if (event.kind === "research_started") {
    // equivalent to old RESEARCH_STATUS_UPDATE { status: "started" }
    setTasks((prev) => updateOrAdd(prev, {
      id: event.taskId, projectId: event.projectId, query: event.query, status: "in_progress",
    }));
  } else if (event.kind === "research_step") {
    // equivalent to old { status: "progress" }
    setProgress((prev) => ({ ...prev, [event.taskId]: event.message }));
  } else if (event.kind === "research_complete") {
    setTasks((prev) => updateOrAdd(prev, { id: event.taskId, status: "complete" }));
  } else if (event.kind === "research_failed") {
    setTasks((prev) => updateOrAdd(prev, { id: event.taskId, status: "failed", error: event.error }));
  }
});
```

Adjust the existing state update logic to match the new event structure. The display logic is unchanged.

- [ ] **Step 3: Update `usePendingItems.ts`**

Replace `window.electronAPI.on` with `ipc.on`:

```typescript
import { ipc } from "../../lib/ipc-client";
import type { IpcPushEvent } from "../../lib/ipc-client";

export interface UsePendingItemsOptions<T> {
  channel: IpcPushEvent["type"];
  decode: (event: IpcPushEvent) => T | null;
  getKey: (item: T) => string;
}

// In useEffect:
const unsub = ipc.on(channel as any, (event) => {
  const item = decode(event as IpcPushEvent);
  if (item) add(item);
});
```

Update callers (`PendingPathBanner`, `PendingCommandBanner`, `PendingToolBanner`) to pass the right `decode` function using the typed event:

```typescript
// PendingCommandBanner.tsx — decode from BASH_BLOCKED
decode: (event) => event.type === "BASH_BLOCKED" ? event : null,
```

- [ ] **Step 4: Update remaining `window.electronAPI.invoke` calls in renderer**

Search for all remaining `window.electronAPI.invoke` calls:
```bash
grep -rn "window.electronAPI.invoke\|window.electronAPI.on\|window.electronAPI.send" src/renderer --include="*.tsx" --include="*.ts"
```

Replace each with `ipc.invoke(...)` or `ipc.on(...)`. Every component and hook gets its `window.electronAPI` calls replaced. This includes:
- `LeftSidebar.tsx`
- `ChatPanel.tsx`
- `MessageInput.tsx`
- `useProviderSettings.ts`
- `useSkillManager.ts`
- `useAuditLog.ts`
- Any settings components

- [ ] **Step 5: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all tests pass. (Update any tests that mocked `window.electronAPI` to mock `ipc` instead.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "refactor(renderer): migrate all window.electronAPI calls to typed ipc client"
```

---

### Task 17: Convert `StreamStateContext` to `useReducer`

**Files:**
- Modify: `src/renderer/contexts/StreamStateContext.tsx`
- Modify: `src/renderer/contexts/__tests__/StreamStateContext.test.tsx`

- [ ] **Step 1: Write test for the reducer**

In `src/renderer/contexts/__tests__/StreamStateContext.test.tsx`, add reducer tests (or replace existing):

```typescript
import { describe, expect, it } from "vitest";
import { streamReducer, type StreamAction } from "../StreamStateContext";

describe("streamReducer", () => {
  const initial = {};

  it("START_STREAM sets processing true", () => {
    const next = streamReducer(initial, { type: "START_STREAM", projectId: "p1" });
    expect(next["p1"]?.processing).toBe(true);
  });

  it("END_STREAM clears segments and sets processing false", () => {
    const state = { p1: { processing: true, streamingSegments: [{ type: "text" as const, content: "hi" }] } };
    const next = streamReducer(state, { type: "END_STREAM", projectId: "p1" });
    expect(next["p1"]?.processing).toBe(false);
    expect(next["p1"]?.streamingSegments).toHaveLength(0);
  });

  it("ADD_TEXT_DELTA appends to last text segment", () => {
    const state = { p1: { processing: true, streamingSegments: [{ type: "text" as const, content: "hello" }] } };
    const next = streamReducer(state, { type: "ADD_TEXT_DELTA", projectId: "p1", delta: " world" });
    expect((next["p1"]?.streamingSegments[0] as any).content).toBe("hello world");
  });

  it("TOOL_START adds activity segment", () => {
    const next = streamReducer(initial, {
      type: "TOOL_START",
      projectId: "p1",
      toolCallId: "tc1",
      toolName: "read_file",
      description: "Reading",
    });
    const seg = next["p1"]?.streamingSegments[0];
    expect(seg?.type).toBe("activity");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test src/renderer/contexts/__tests__/StreamStateContext.test.tsx
```

Expected: FAIL — `streamReducer` not exported.

- [ ] **Step 3: Refactor `StreamStateContext.tsx` to use `useReducer`**

Extract the reducer:

```typescript
export type StreamAction =
  | { type: "START_STREAM"; projectId: string }
  | { type: "END_STREAM"; projectId: string }
  | { type: "TIMEOUT"; projectId: string }
  | { type: "ADD_TEXT_DELTA"; projectId: string; delta: string }
  | { type: "TOOL_START"; projectId: string; toolCallId: string; toolName: string; description: string }
  | { type: "TOOL_END"; projectId: string; toolCallId: string; isError: boolean };

export function streamReducer(
  state: Record<string, ProjectStreamState>,
  action: StreamAction,
): Record<string, ProjectStreamState> {
  switch (action.type) {
    case "START_STREAM": {
      const existing = state[action.projectId];
      return {
        ...state,
        [action.projectId]: { streamingSegments: existing?.streamingSegments ?? [], processing: true },
      };
    }
    case "END_STREAM":
    case "TIMEOUT":
      return {
        ...state,
        [action.projectId]: { streamingSegments: [], processing: false },
      };
    case "ADD_TEXT_DELTA": {
      const existing = state[action.projectId];
      const segments = existing?.streamingSegments ? [...existing.streamingSegments] : [];
      const last = segments[segments.length - 1];
      if (last?.type === "text") {
        segments[segments.length - 1] = { type: "text", content: last.content + action.delta };
      } else {
        segments.push({ type: "text", content: action.delta });
      }
      return { ...state, [action.projectId]: { streamingSegments: segments, processing: true } };
    }
    case "TOOL_START": {
      const existing = state[action.projectId];
      const segments = existing?.streamingSegments ? [...existing.streamingSegments] : [];
      segments.push({ type: "activity", toolCallId: action.toolCallId, toolName: action.toolName, description: action.description, status: "running" });
      return { ...state, [action.projectId]: { streamingSegments: segments, processing: existing?.processing ?? true } };
    }
    case "TOOL_END": {
      const existing = state[action.projectId];
      if (!existing) return state;
      const segments = existing.streamingSegments.map((seg) =>
        seg.type === "activity" && seg.toolCallId === action.toolCallId
          ? { ...seg, status: action.isError ? ("error" as const) : ("done" as const) }
          : seg,
      );
      return { ...state, [action.projectId]: { ...existing, streamingSegments: segments } };
    }
    default:
      return state;
  }
}
```

In the provider:

```typescript
export function StreamStateProvider({ children }: { children: ReactNode }) {
  const [states, dispatch] = useReducer(streamReducer, {});
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const STREAM_TIMEOUT_MS = 300_000;

  // ... timer management: startTimer dispatches TIMEOUT, clearTimer cancels
  
  useEffect(() => {
    const unsubChunk = ipc.on("MESSAGE_CHUNK", ({ projectId, delta }) => {
      if (!projectId) return;
      dispatchRef.current({ type: "ADD_TEXT_DELTA", projectId, delta });
      startTimer(projectId);
    });

    const unsubDone = ipc.on("MESSAGE_DONE", ({ projectId }) => {
      if (!projectId) return;
      clearTimer(projectId);
      dispatchRef.current({ type: "END_STREAM", projectId });
    });

    const unsubProgress = ipc.on("AGENT_PROGRESS", ({ event }) => {
      if (event.kind === "tool_call_start") {
        dispatchRef.current({ type: "TOOL_START", projectId: event.projectId, toolCallId: event.toolCallId, toolName: event.toolName, description: event.description });
      } else if (event.kind === "tool_call_end") {
        dispatchRef.current({ type: "TOOL_END", projectId: event.projectId, toolCallId: event.toolCallId, isError: event.isError });
      }
    });

    return () => {
      unsubChunk(); unsubDone(); unsubProgress();
      for (const t of Object.values(timersRef.current)) clearTimeout(t);
      timersRef.current = {};
    };
  }, [startTimer, clearTimer]);

  const startStream = useCallback((projectId: string) => {
    dispatch({ type: "START_STREAM", projectId });
    startTimer(projectId);
  }, [startTimer]);

  const endStream = useCallback((projectId: string) => {
    clearTimer(projectId);
    dispatch({ type: "END_STREAM", projectId });
  }, [clearTimer]);

  return (
    <StreamStateContext.Provider value={{ states, startStream, endStream }}>
      {children}
    </StreamStateContext.Provider>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test src/renderer/contexts/__tests__/StreamStateContext.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/contexts/StreamStateContext.tsx src/renderer/contexts/__tests__/StreamStateContext.test.tsx
git commit -m "refactor(renderer): convert StreamStateContext to useReducer with typed actions"
```

---

### Task 18: Add `useSettings` and `useProjects` hooks, fix `useProviderSettings` dep bug

**Files:**
- Create: `src/renderer/hooks/useSettings.ts`
- Create: `src/renderer/hooks/useProjects.ts`
- Modify: `src/renderer/hooks/useProviderSettings.ts`
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`

- [ ] **Step 1: Create `useSettings.ts`**

```typescript
import { useEffect, useRef, useState } from "react";
import type { SettingsResponse } from "../../shared/ipc-types";
import { ipc } from "../lib/ipc-client";

let cachedSettings: SettingsResponse | null = null;
let pendingPromise: Promise<SettingsResponse> | null = null;

export function useSettings(): SettingsResponse | null {
  const [settings, setSettings] = useState<SettingsResponse | null>(cachedSettings);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (!cachedSettings) {
      if (!pendingPromise) {
        pendingPromise = ipc.invoke("GET_SETTINGS").then((s) => {
          cachedSettings = s;
          pendingPromise = null;
          return s;
        });
      }
      pendingPromise.then((s) => {
        if (mounted.current) setSettings(s);
      });
    }

    const unsub = ipc.on("SETTINGS_UPDATED", ({ settings: updated }) => {
      cachedSettings = updated;
      if (mounted.current) setSettings(updated);
    });

    return () => {
      mounted.current = false;
      unsub();
    };
  }, []);

  return settings;
}
```

- [ ] **Step 2: Create `useProjects.ts`**

```typescript
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../shared/types/project";
import { ipc } from "../lib/ipc-client";

export function useProjects(): Project[] {
  const [projects, setProjects] = useState<Project[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    ipc.invoke("GET_PROJECTS").then((p) => {
      if (mounted.current) setProjects(p);
    });

    const unsub = ipc.on("SETTINGS_UPDATED", () => {
      ipc.invoke("GET_PROJECTS").then((p) => {
        if (mounted.current) setProjects(p);
      });
    });

    return () => {
      mounted.current = false;
      unsub();
    };
  }, []);

  return projects;
}
```

- [ ] **Step 3: Fix `useProviderSettings` — missing credential dep**

In `src/renderer/hooks/useProviderSettings.ts`, find the `useEffect` with the biome-ignore comment. Replace the dependency array:

```typescript
// Before
}, [enabled, activeProvider, fetchModels]);

// After — include the credential for the current provider
}, [enabled, activeProvider, credentials[activeProvider as keyof typeof credentials]?.apiKey, fetchModels]);
```

Remove the biome-ignore comment since the deps are now correct.

- [ ] **Step 4: Update `LeftSidebar.tsx` to use `useProjects`**

Replace the two `window.electronAPI.invoke(IPC.GET_PROJECTS)` calls with:

```typescript
import { useProjects } from "../../hooks/useProjects";

const projects = useProjects();
```

Remove the `useState`/`useEffect` pairs that were fetching projects manually.

- [ ] **Step 5: Run typecheck and tests**

```bash
bun run typecheck && bun run test
```

Expected: zero errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useSettings.ts src/renderer/hooks/useProjects.ts \
  src/renderer/hooks/useProviderSettings.ts src/renderer/components/layout/LeftSidebar.tsx \
  src/renderer/components/layout/chat/MessageInput.tsx
git commit -m "feat(renderer): add useSettings/useProjects hooks, fix useProviderSettings missing dep"
```

---

### Task 19: Add `ErrorBoundary` to `AppShell`

**Files:**
- Create: `src/renderer/components/ErrorBoundary.tsx`
- Modify: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Create `ErrorBoundary.tsx`**

```typescript
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: "center" }}>
          <p>Something went wrong.</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap `AppShell` with `ErrorBoundary`**

In `src/renderer/App.tsx` (or wherever `AppShell` is rendered), wrap:

```typescript
import { ErrorBoundary } from "./components/ErrorBoundary";

// In render:
<ErrorBoundary>
  <AppShell />
</ErrorBoundary>
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ErrorBoundary.tsx src/renderer/App.tsx
git commit -m "feat(renderer): add ErrorBoundary wrapping AppShell"
```

---

## Phase 6 — Critical Tests

### Task 20: Tests for `chat-handlers.ts` — SEND_MESSAGE core path

**Files:**
- Create: `src/main/ipc/__tests__/chat-handlers.test.ts`

- [ ] **Step 1: Write tests**

Create `src/main/ipc/__tests__/chat-handlers.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerChatHandler } from "../chat-handlers";
import { IPC } from "../../../shared/ipc-channels";

// Mock ipcMain
const handlers = new Map<string, (...args: any[]) => any>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...a: any[]) => any) => handlers.set(channel, handler),
    on: vi.fn(),
  },
}));

const mockWin = {
  webContents: { send: vi.fn() },
} as any;

const mockSession = {
  send: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  queueFollowUp: vi.fn().mockResolvedValue(undefined),
};

const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
};

const mockProject = {
  id: "proj-1",
  name: "Test",
  slug: "test-abc123",
  folderPath: null,
  projectPath: "/home/.scholar/projects/test-abc123",
  modelOverride: null,
};

const mockSettings = {
  activeProvider: "anthropic",
  defaultCloudProvider: "anthropic",
  providerCredentials: {
    anthropic: { apiKey: "sk-test", defaultModel: "claude-3-5-sonnet-20241022" },
    openrouter: { apiKey: null, defaultModel: "openai/gpt-4o" },
    openai: { apiKey: null, defaultModel: "gpt-4o" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  },
  langfuseEnabled: false,
  webAccessEnabled: true,
  theme: "system" as const,
};

const makeDeps = () => ({
  sessionManager: mockSessionManager,
  settingsService: { getSettings: vi.fn().mockResolvedValue(mockSettings) },
  eventBus: { on: vi.fn(), emit: vi.fn() },
  homeService: {
    isFirstRun: vi.fn().mockResolvedValue(false),
    getHomePath: vi.fn().mockReturnValue("/home/.scholar"),
    ensureDirectories: vi.fn(),
    savePendingTool: vi.fn(),
  },
  researchService: { startResearch: vi.fn(), startOrchestratedResearch: vi.fn() },
  memoryManager: { buildContext: vi.fn().mockResolvedValue({ summary: "", recentMessages: [] }) },
  messageService: {
    getHistory: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    deleteMessage: vi.fn(),
    updateMessage: vi.fn(),
  },
  projectService: { getProject: vi.fn().mockResolvedValue(mockProject) },
  outputNotificationService: { recordWrite: vi.fn() },
  memoryFileService: {} as any,
  allowlistService: { isAllowed: vi.fn().mockReturnValue({ allowed: true }) } as any,
  observabilityService: {} as any,
  toolApprovalService: { savePendingTool: vi.fn() },
});

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  mockSessionManager.get.mockReturnValue(undefined); // no existing session
});

describe("GET_MESSAGES", () => {
  it("returns message history for project", async () => {
    const deps = makeDeps();
    registerChatHandler(mockWin, deps as any);
    const handler = handlers.get(IPC.GET_MESSAGES);
    expect(handler).toBeDefined();
    const result = await handler?.({}, { projectId: "proj-1" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(deps.messageService.getHistory).toHaveBeenCalledWith("proj-1");
  });
});

describe("ABORT_MESSAGE", () => {
  it("calls session.abort() when session exists", async () => {
    mockSessionManager.get.mockReturnValue(mockSession);
    const deps = makeDeps();
    registerChatHandler(mockWin, deps as any);
    const handler = handlers.get(IPC.ABORT_MESSAGE);
    await handler?.({}, { projectId: "proj-1" });
    expect(mockSession.abort).toHaveBeenCalled();
  });

  it("does not throw when no session", async () => {
    mockSessionManager.get.mockReturnValue(undefined);
    const deps = makeDeps();
    registerChatHandler(mockWin, deps as any);
    const handler = handlers.get(IPC.ABORT_MESSAGE);
    await expect(handler?.({}, { projectId: "proj-1" })).resolves.not.toThrow();
  });
});

describe("SEND_MESSAGE — existing session", () => {
  it("sends message to existing session", async () => {
    mockSessionManager.get.mockReturnValue(mockSession);
    const deps = makeDeps();
    registerChatHandler(mockWin, deps as any);
    const handler = handlers.get(IPC.SEND_MESSAGE);
    const result = await handler?.({}, { projectId: "proj-1", content: "hello" });
    expect(result.ok).toBe(true);
    expect(mockSession.send).toHaveBeenCalledWith("hello");
  });

  it("emits error chunk when session.send throws", async () => {
    mockSession.send.mockRejectedValueOnce(new Error("agent error"));
    mockSessionManager.get.mockReturnValue(mockSession);
    const deps = makeDeps();
    registerChatHandler(mockWin, deps as any);
    const handler = handlers.get(IPC.SEND_MESSAGE);
    const result = await handler?.({}, { projectId: "proj-1", content: "hello" });
    // wrapIpc catches error, returns { ok: true, data: { messageId } }
    // Internal error is emitted as MESSAGE_CHUNK to renderer
    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      expect.stringMatching(/MESSAGE_CHUNK|AGENT_PROGRESS/),
      expect.anything(),
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun run test src/main/ipc/__tests__/chat-handlers.test.ts
```

Expected: all pass. (Adjust mock shapes if the handler signature changed in prior tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/__tests__/chat-handlers.test.ts
git commit -m "test(ipc): add chat-handlers tests for GET_MESSAGES, ABORT_MESSAGE, SEND_MESSAGE"
```

---

### Task 21: Tests for `wrapIpc`, `emitPush`, `IpcClient` integration

These were already written in Tasks 4 and 6. Verify they all still pass:

- [ ] **Step 1: Run the full test suite**

```bash
bun run test
```

Expected: all tests pass. Zero failures.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run lint**

```bash
bun run check
```

Expected: zero errors.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup — typecheck, lint, tests all green"
```

---

## Summary of Files Created / Modified

### New files
| File | Purpose |
|------|---------|
| `src/shared/__tests__/ipc-types.test.ts` | Type contract tests |
| `src/renderer/lib/ipc-client.ts` | Typed IPC client (replaces raw window.electronAPI) |
| `src/renderer/lib/__tests__/ipc-client.test.ts` | IpcClient tests |
| `src/renderer/hooks/useSettings.ts` | Deduplicated GET_SETTINGS hook |
| `src/renderer/hooks/useProjects.ts` | Deduplicated GET_PROJECTS hook |
| `src/renderer/components/ErrorBoundary.tsx` | React error boundary |
| `src/main/ipc/wrap-ipc.ts` | Unified handler wrapper |
| `src/main/ipc/emit-push.ts` | Typed push event emitter |
| `src/main/ipc/send-throttle.ts` | Fixed rate limiter |
| `src/main/ipc/__tests__/wrap-ipc.test.ts` | wrapIpc tests |
| `src/main/ipc/__tests__/chat-handlers-throttle.test.ts` | SendThrottle tests |
| `src/main/ipc/__tests__/chat-handlers.test.ts` | Chat handler tests |
| `src/main/agent/model-registry.ts` | Model context window config |
| `src/main/agent/message-context-pruner.ts` | Pure message pruning function |
| `src/main/agent/system-prompt-builder.ts` | Pure system prompt builder |
| `src/main/agent/path-jail-factory.ts` | PathJail factory (fixes constructor bug) |
| `src/main/agent/__tests__/model-registry.test.ts` | ModelRegistry tests |
| `src/main/agent/__tests__/message-context-pruner.test.ts` | Pruner tests |
| `src/main/agent/__tests__/system-prompt-builder.test.ts` | Prompt builder tests |
| `src/main/agent/__tests__/path-jail-factory.test.ts` | PathJailFactory tests |

### Modified files
| File | Change |
|------|--------|
| `src/shared/ipc-types.ts` | Add `IpcResult<T>`, `IpcRequestMap`, `AgentProgressEvent`, `IpcPushEvent` |
| `src/shared/ipc-channels.ts` | Add `AGENT_PROGRESS`, remove `TOOL_START`, `TOOL_END`, `RESEARCH_STATUS_UPDATE`, `RESEARCH_COMPLETE` |
| `src/main/ipc/*-handlers.ts` (all) | Wrap with `wrapIpc` |
| `src/main/ipc/event-forwarders.ts` | Use `emitPush`, consolidate to `AGENT_PROGRESS` |
| `src/main/ipc/chat-handlers.ts` | Use `emitPush`, `SendThrottle`, inject `ToolApprovalService` directly |
| `src/main/ipc/register.ts` | Resolve `PathJailFactory`, `TaskPersistenceService`, `SkillManagementService`, `ToolApprovalService` directly |
| `src/main/services/HomeService.ts` | Strip to directory-setup only |
| `src/main/bootstrap.ts` | Remove `CrystallizationService` registration |
| `src/main/agent/MessagePipeline.ts` | Use `getContextWindow`, `pruneMessages`, `buildSystemPrompt` |
| `src/main/agent/tools.ts` | Add `ToolCapabilities` / `ToolContext`, keep backward-compat overload |
| `src/renderer/contexts/StreamStateContext.tsx` | `useReducer`, use `ipc`, consume `AGENT_PROGRESS` |
| `src/renderer/hooks/usePendingItems.ts` | Use `ipc.on` |
| `src/renderer/hooks/useProviderSettings.ts` | Fix missing credential dep |
| `src/renderer/components/layout/ResearchHistoryPanel.tsx` | Consume `AGENT_PROGRESS` |
| All renderer components with `window.electronAPI.*` | Replace with `ipc.*` |

### Deleted files
| File | Reason |
|------|--------|
| `src/main/services/CrystallizationService.ts` | Dead code — registered but never injected or called |
