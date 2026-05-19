# Tool Denial Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user denies any of the three tool approval gates (safe_bash, execute_code, path), they can optionally type a message that is returned to the agent as the tool's error/result content.

**Architecture:** `denyReason?: string` is threaded from the renderer (textarea in ReviewDialog) through IPC resolve payloads into each gate's resolution function, and from there into the tool's error message or result text that the agent reads. The ReviewDialog footer is redesigned: three vertically-stacked approve/deny buttons on the right, then a textarea + disabled-until-filled "Redirect" button as a full-width row below.

**Tech Stack:** TypeScript, Zod (validation), React (renderer), Electron IPC, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/shared/ipc-types.ts` | Add `denyReason?: string` to three RESOLVE payload interfaces |
| `src/main/ipc-validation.ts` | Add `denyReason: z.string().optional()` to three schemas |
| `src/main/agent/extensions/path-approval.ts` | Change gate promise type from `boolean` to `{ approved: boolean; denyReason?: string }` |
| `src/main/agent/tools/file-tools.ts` | Destructure new gate result at all three call sites; include denyReason in denial message |
| `src/main/agent/extensions/execute-code-approval.ts` | Change internal resolve type; thread denyReason through gate result |
| `src/main/agent/tools/execute-code-tool.ts` | Include denyReason in denial text and audit entry |
| `src/main/agent/extensions/safe-bash.ts` | Accept denyReason in resolveBlockedCommand; use it in BlockedCommandError message |
| `src/main/ipc/command-handlers.ts` | Extract denyReason from all three parsed payloads; pass to resolve functions |
| `src/renderer/components/layout/chat/ReviewDialog.tsx` | New footer layout; `onDeny(feedback?: string)` |
| `src/renderer/components/layout/chat/PendingCommandModal.tsx` | Update `onDeny` prop signature |
| `src/renderer/components/layout/chat/PendingExecuteCodeModal.tsx` | Update `onDeny` prop signature |
| `src/renderer/components/layout/chat/PendingPathModal.tsx` | Update `onDeny` prop signature |
| `src/renderer/components/layout/chat/PendingCommandBanner.tsx` | Pass denyReason through handleResolve |
| `src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx` | Pass denyReason through handleResolve |
| `src/renderer/components/layout/chat/PendingPathBanner.tsx` | Pass denyReason through handleResolve |

---

## Task 1: Shared types and validation schemas

**Files:**
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/main/ipc-validation.ts`

- [ ] **Step 1: Add `denyReason` to IPC invoke payload types**

In `src/shared/ipc-types.ts`, find the `IpcInvokePayloads` interface and update the three RESOLVE entries:

```ts
RESOLVE_BLOCKED_COMMAND: {
  commandId: string;
  action: "approve_once" | "approve_session" | "deny";
  projectId?: string;
  denyReason?: string;
};
RESOLVE_EXECUTE_CODE_APPROVAL: {
  executionId: string;
  action: "approve_once" | "deny";
  denyReason?: string;
};
RESOLVE_PATH_APPROVAL: {
  path: string;
  mode: "read" | "write";
  action: "approve_once" | "approve_session" | "deny";
  projectId: string;
  denyReason?: string;
};
```

- [ ] **Step 2: Add `denyReason` to Zod validation schemas**

In `src/main/ipc-validation.ts`, add `denyReason: z.string().optional()` to all three schemas:

```ts
export const ResolveBlockedCommandSchema = z.object({
  commandId: z.string(),
  action: z.enum(["approve_once", "approve_session", "deny"]),
  projectId: z.string().optional(),
  denyReason: z.string().optional(),
});

export const ResolveExecuteCodeApprovalSchema = z.object({
  executionId: z.string(),
  action: z.enum(["approve_once", "deny"]),
  denyReason: z.string().optional(),
});

export const ResolvePathApprovalSchema = z.object({
  path: z.string(),
  mode: z.enum(["read", "write"]),
  action: z.enum(["approve_once", "approve_session", "deny"]),
  projectId: z.string(),
  denyReason: z.string().optional(),
});
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-types.ts src/main/ipc-validation.ts
git commit -m "feat: add denyReason to tool denial IPC payloads"
```

---

## Task 2: Path approval gate — thread denyReason

**Files:**
- Modify: `src/main/agent/extensions/path-approval.ts`
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Write failing tests for denyReason in path gate**

Add to `src/main/agent/path-jail.test.ts` (at the end of the file, before the last closing `}`):

```ts
import { enterPathApprovalGate, resolvePathApprovalGate } from "../extensions/path-approval";

describe("path approval gate denyReason", () => {
  it("resolves with approved: true when approved", async () => {
    const promise = enterPathApprovalGate("proj-1", "/some/path", "read");
    resolvePathApprovalGate("proj-1", "/some/path", "read", true);
    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it("resolves with approved: false and no denyReason when denied without message", async () => {
    const promise = enterPathApprovalGate("proj-2", "/some/path", "read");
    resolvePathApprovalGate("proj-2", "/some/path", "read", false);
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.denyReason).toBeUndefined();
  });

  it("resolves with denyReason when denied with message", async () => {
    const promise = enterPathApprovalGate("proj-3", "/some/path", "write");
    resolvePathApprovalGate("proj-3", "/some/path", "write", false, "use the workspace dir instead");
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.denyReason).toBe("use the workspace dir instead");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/main/agent/path-jail.test.ts
```

Expected: the three new tests FAIL with type errors or assertion errors.

- [ ] **Step 3: Update path-approval.ts**

Replace the entire content of `src/main/agent/extensions/path-approval.ts`:

```ts
export type PathApprovalResult = { approved: true } | { approved: false; denyReason?: string };

const pendingGates = new Map<
  string,
  { resolve: (result: PathApprovalResult) => void; timer: ReturnType<typeof setTimeout> }
>();
const timeoutHandlers = new Map<string, Set<() => void>>();

function makeKey(projectId: string, path: string, mode: string): string {
  return `${projectId}:${path}:${mode}`;
}

export function enterPathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
): Promise<PathApprovalResult> {
  return new Promise<PathApprovalResult>((resolve) => {
    const key = makeKey(projectId, path, mode);
    const timer = setTimeout(() => {
      pendingGates.delete(key);
      const handlers = timeoutHandlers.get(key);
      timeoutHandlers.delete(key);
      handlers?.forEach((handler) => {
        handler();
      });
      resolve({ approved: false });
    }, 300_000);
    pendingGates.set(key, { resolve, timer });
  });
}

export function resolvePathApprovalGate(
  projectId: string,
  path: string,
  mode: "read" | "write",
  approved: boolean,
  denyReason?: string,
): void {
  const key = makeKey(projectId, path, mode);
  const gate = pendingGates.get(key);
  if (!gate) return;
  clearTimeout(gate.timer);
  pendingGates.delete(key);
  timeoutHandlers.delete(key);
  gate.resolve(approved ? { approved: true } : { approved: false, denyReason });
}

export function onPathApprovalTimeout(
  projectId: string,
  path: string,
  mode: "read" | "write",
  handler: () => void,
): () => void {
  const key = makeKey(projectId, path, mode);
  let handlers = timeoutHandlers.get(key);
  if (!handlers) {
    handlers = new Set();
    timeoutHandlers.set(key, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = timeoutHandlers.get(key);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      timeoutHandlers.delete(key);
    }
  };
}
```

- [ ] **Step 4: Update file-tools.ts — all three enterPathApprovalGate call sites**

In `src/main/agent/tools/file-tools.ts`, update the three call sites (lines ~137, ~301, ~492). Each follows the same pattern — change:

```ts
const approved = await enterPathApprovalGate(jail.projectId, err.path, err.mode);
if (!approved) {
  return {
    content: [
      {
        type: "text" as const,
        text: `User did not approve access to "${err.path}". Choose a different path or ask the user to allow it.`,
      },
    ],
    // ...details varies per call site, keep as-is
  };
}
```

to:

```ts
const gateResult = await enterPathApprovalGate(jail.projectId, err.path, err.mode);
if (!gateResult.approved) {
  const feedback = gateResult.denyReason ? ` ${gateResult.denyReason}` : "";
  return {
    content: [
      {
        type: "text" as const,
        text: `User did not approve access to "${err.path}". Choose a different path or ask the user to allow it.${feedback}`,
      },
    ],
    // ...details varies per call site, keep as-is
  };
}
```

Make this change at all three call sites. The `details` return value differs per call site (`null`, `[]`, and an object) — preserve exactly as it was.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/agent/path-jail.test.ts
```

Expected: all tests PASS including the three new ones.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/extensions/path-approval.ts src/main/agent/tools/file-tools.ts src/main/agent/path-jail.test.ts
git commit -m "feat: thread denyReason through path approval gate"
```

---

## Task 3: Execute-code approval gate — thread denyReason

**Files:**
- Modify: `src/main/agent/extensions/execute-code-approval.ts`
- Modify: `src/main/agent/tools/execute-code-tool.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/tools/__tests__/execute-code-tool.test.ts`, add two new tests after the existing "audits denied executions" test (around line 147):

```ts
it("includes denyReason in tool result when denied with feedback", async () => {
  const emitApprovalRequired = vi.fn();
  const tool = createExecuteCodeTool({
    projectId: "p1",
    homePath: tempDir,
    auditLogPath,
    allowlistService: new AllowlistService(),
    emitApprovalRequired,
  });

  const pending = tool.execute("tool-call", {
    intent: "try code",
    code: "print('nope')",
    language: "python",
  });

  await vi.waitFor(() => expect(emitApprovalRequired).toHaveBeenCalledTimes(1));
  const request = emitApprovalRequired.mock.calls[0][0];
  resolveExecuteCodeApproval(request.executionId, "deny", "use read_file instead");
  const result = await pending;

  expect(getText(result)).toBe("User denied code execution. use read_file instead");
});

it("omits denyReason from tool result when denied without feedback", async () => {
  const emitApprovalRequired = vi.fn();
  const tool = createExecuteCodeTool({
    projectId: "p1",
    homePath: tempDir,
    auditLogPath,
    allowlistService: new AllowlistService(),
    emitApprovalRequired,
  });

  const pending = tool.execute("tool-call", {
    intent: "try code",
    code: "print('nope')",
    language: "python",
  });

  await vi.waitFor(() => expect(emitApprovalRequired).toHaveBeenCalledTimes(1));
  const request = emitApprovalRequired.mock.calls[0][0];
  resolveExecuteCodeApproval(request.executionId, "deny");
  const result = await pending;

  expect(getText(result)).toBe("User denied code execution.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/main/agent/tools/__tests__/execute-code-tool.test.ts
```

Expected: the two new tests FAIL (resolveExecuteCodeApproval doesn't accept a third arg yet).

- [ ] **Step 3: Update execute-code-approval.ts**

Replace the type and the two functions that need changing. The full file becomes:

```ts
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { AuditLogEntry, ExecuteCodeApprovalPayload } from "../../../shared/ipc-types";

type ExecuteCodeApprovalAction = "approve_once" | "deny";

export type ExecuteCodeGateResult =
  | { approved: true; payload: ExecuteCodeApprovalPayload }
  | { approved: false; denyReason?: string };

interface ExecuteCodeApprovalPromise {
  payload: ExecuteCodeApprovalPayload;
  resolve: (result: ExecuteCodeGateResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, ExecuteCodeApprovalPromise>();

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf-8").digest("hex");
}

export async function appendAuditEntry(auditLogPath: string, entry: AuditLogEntry): Promise<void> {
  try {
    await appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (err) {
    console.error("[execute-code] audit log append failed:", err);
  }
}

export function enterExecuteCodeApprovalGate(
  payload: Omit<ExecuteCodeApprovalPayload, "executionId" | "timestamp">,
  emitApprovalRequired: (payload: ExecuteCodeApprovalPayload) => void,
): Promise<ExecuteCodeGateResult> {
  return new Promise((resolve, reject) => {
    const executionId = randomUUID();
    const fullPayload: ExecuteCodeApprovalPayload = {
      ...payload,
      executionId,
      timestamp: new Date().toISOString(),
    };

    const timer = setTimeout(() => {
      pendingApprovals.delete(executionId);
      reject(new Error("Execute code approval timed out."));
    }, 300_000);

    pendingApprovals.set(executionId, {
      payload: fullPayload,
      resolve: (result) => resolve(result),
      reject,
      timer,
    });

    emitApprovalRequired(fullPayload);
  });
}

export function resolveExecuteCodeApproval(
  executionId: string,
  action: ExecuteCodeApprovalAction,
  denyReason?: string,
): void {
  const pending = pendingApprovals.get(executionId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingApprovals.delete(executionId);

  if (action === "approve_once") {
    pending.resolve({ approved: true, payload: pending.payload });
  } else {
    pending.resolve({ approved: false, denyReason });
  }
}

export function resolvePendingExecuteCodeApprovalsForProject(
  projectId: string,
  action: ExecuteCodeApprovalAction = "approve_once",
): number {
  const executionIds = Array.from(pendingApprovals.entries())
    .filter(([, pending]) => pending.payload.projectId === projectId)
    .map(([executionId]) => executionId);

  for (const executionId of executionIds) {
    resolveExecuteCodeApproval(executionId, action);
  }

  return executionIds.length;
}
```

- [ ] **Step 4: Update execute-code-tool.ts denial block**

In `src/main/agent/tools/execute-code-tool.ts`, find the `if (!approval.approved)` block (around line 127) and update it:

```ts
if (!approval.approved) {
  const denyReason = approval.denyReason;
  const msg = denyReason
    ? `User denied code execution. ${denyReason}`
    : "User denied code execution.";
  await appendAuditEntry(options.auditLogPath, {
    ts: startedAt,
    projectId: options.projectId,
    tool: "execute_code",
    intent,
    language,
    code,
    codeHash,
    networkEnabled: networkEnabled === true,
    workspaceFiles: requestedWorkspaceFiles,
    inlineFiles: inlineFileNames,
    exitCode: null,
    blocked: true,
    blockReason: msg,
    blockKey: "execute_code_denied",
    blockCategory: "code_execution",
  });
  return {
    content: [{ type: "text" as const, text: msg }],
    details: { stdout: "", outputFiles: [], error: msg },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/agent/tools/__tests__/execute-code-tool.test.ts
```

Expected: all tests PASS including the two new ones.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/extensions/execute-code-approval.ts src/main/agent/tools/execute-code-tool.ts src/main/agent/tools/__tests__/execute-code-tool.test.ts
git commit -m "feat: thread denyReason through execute-code approval gate"
```

---

## Task 4: Safe-bash — include denyReason in BlockedCommandError

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/extensions/safe-bash.test.ts`, find the test around line 497 that does `resolveBlockedCommand(payload.commandId, "deny")`. Add two new tests after it:

```ts
it("uses denyReason in error message when user provides feedback", async () => {
  const emitBlocked = vi.fn();
  const promise = runSafeBash("curl https://example.com", {
    projectId: "proj-1",
    intent: "fetch data",
    emitBlocked,
  });

  const payload = await getBlockedPayload(emitBlocked);
  resolveBlockedCommand(payload.commandId, "deny", undefined, "use the web_search tool instead");
  await expect(promise).rejects.toThrow("Denied by user: use the web_search tool instead");
});

it("keeps original block reason when denied without feedback", async () => {
  const emitBlocked = vi.fn();
  const promise = runSafeBash("curl https://example.com", {
    projectId: "proj-1",
    intent: "fetch data",
    emitBlocked,
  });

  const payload = await getBlockedPayload(emitBlocked);
  resolveBlockedCommand(payload.commandId, "deny");
  await expect(promise).rejects.toThrow("Blocked:");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts
```

Expected: the first new test FAILs (resolveBlockedCommand doesn't accept denyReason yet); the second should still pass.

- [ ] **Step 3: Update resolveBlockedCommand in safe-bash.ts**

Find the `resolveBlockedCommand` function (around line 608) and update its signature and denial branch:

```ts
export function resolveBlockedCommand(
  commandId: string,
  action: "approve_once" | "approve_session" | "deny",
  projectId?: string,
  denyReason?: string,
): void {
  const deferred = blockedPromises.get(commandId);
  if (!deferred) return;

  clearTimeout(deferred.timer);
  blockedPromises.delete(commandId);

  if (action === "deny") {
    const msg = denyReason
      ? `Denied by user: ${denyReason}`
      : `Blocked: ${deferred.blockedResult.reason}`;
    deferred.reject(
      new BlockedCommandError(
        msg,
        commandId,
        deferred.blockedResult.category,
      ),
    );
    return;
  }

  if (action === "approve_session") {
    const resolvedProjectId = projectId ?? deferred.options.projectId;
    getProjectAllowlist(resolvedProjectId).add(hashCommand(deferred.options.command));
  }

  void runSafeBashInternal(deferred.options).then(deferred.resolve, deferred.reject);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat: include denyReason in BlockedCommandError message"
```

---

## Task 5: Command handlers — pass denyReason from IPC payloads

**Files:**
- Modify: `src/main/ipc/command-handlers.ts`

- [ ] **Step 1: Update all three IPC handlers to extract and pass denyReason**

In `src/main/ipc/command-handlers.ts`, update the three `ipcMain.handle` blocks:

**RESOLVE_BLOCKED_COMMAND** (around line 30):
```ts
ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { commandId, action, projectId, denyReason } = parseOrThrow(
      ResolveBlockedCommandSchema,
      payload,
      "RESOLVE_BLOCKED_COMMAND",
    );
    resolveBlockedCommand(commandId, action, projectId, denyReason);
  }),
);
```

**RESOLVE_EXECUTE_CODE_APPROVAL** (around line 41):
```ts
ipcMain.handle(IPC.RESOLVE_EXECUTE_CODE_APPROVAL, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { executionId, action, denyReason } = parseOrThrow(
      ResolveExecuteCodeApprovalSchema,
      payload,
      "RESOLVE_EXECUTE_CODE_APPROVAL",
    );
    resolveExecuteCodeApproval(executionId, action, denyReason);
  }),
);
```

**RESOLVE_PATH_APPROVAL** (around line 58):
```ts
ipcMain.handle(IPC.RESOLVE_PATH_APPROVAL, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { path, mode, action, projectId, denyReason } = parseOrThrow(
      ResolvePathApprovalSchema,
      payload,
      "RESOLVE_PATH_APPROVAL",
    );
    const key = `${projectId}:${path}:${mode}`;
    pendingPathApprovals.delete(key);
    pendingPathApprovalCleanup.get(key)?.();
    pendingPathApprovalCleanup.delete(key);

    const approved = action === "approve_once" || action === "approve_session";
    if (approved) {
      allowlistService.approveSession(projectId, path, mode);
    }
    resolvePathApprovalGate(projectId, path, mode as "read" | "write", approved, denyReason);
  }),
);
```

- [ ] **Step 2: Typecheck + full test suite**

```bash
bun run typecheck && bun run test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/command-handlers.ts
git commit -m "feat: pass denyReason from IPC resolution handlers to gate functions"
```

---

## Task 6: ReviewDialog — new footer layout

**Files:**
- Modify: `src/renderer/components/layout/chat/ReviewDialog.tsx`
- Create: `src/renderer/components/layout/chat/__tests__/ReviewDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/components/layout/chat/__tests__/ReviewDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReviewDialog from "../ReviewDialog";

function renderDialog(overrides: Partial<Parameters<typeof ReviewDialog>[0]> = {}) {
  const onDeny = vi.fn();
  const onApproveOnce = vi.fn();
  const onClose = vi.fn();

  render(
    <ReviewDialog
      title="Test Dialog"
      onApproveOnce={onApproveOnce}
      onDeny={onDeny}
      onClose={onClose}
      dataTestid="test-dialog"
      {...overrides}
    >
      <div>content</div>
    </ReviewDialog>,
  );

  return { onDeny, onApproveOnce, onClose };
}

describe("ReviewDialog", () => {
  it("renders Approve Once, Deny buttons and Redirect button", () => {
    renderDialog();
    expect(screen.getByTestId("approve-once-btn")).toBeInTheDocument();
    expect(screen.getByTestId("deny-btn")).toBeInTheDocument();
    expect(screen.getByTestId("redirect-btn")).toBeInTheDocument();
  });

  it("Redirect button is disabled when textarea is empty", () => {
    renderDialog();
    expect(screen.getByTestId("redirect-btn")).toBeDisabled();
  });

  it("Redirect button enables when textarea has text", () => {
    renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "use read_file" } });
    expect(screen.getByTestId("redirect-btn")).not.toBeDisabled();
  });

  it("clicking Redirect calls onDeny with trimmed feedback text", () => {
    const { onDeny } = renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "  use read_file  " } });
    fireEvent.click(screen.getByTestId("redirect-btn"));
    expect(onDeny).toHaveBeenCalledWith("use read_file");
  });

  it("clicking Deny calls onDeny with no argument", () => {
    const { onDeny } = renderDialog();
    fireEvent.click(screen.getByTestId("deny-btn"));
    expect(onDeny).toHaveBeenCalledWith(undefined);
  });

  it("Redirect stays disabled when textarea contains only whitespace", () => {
    renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(screen.getByTestId("redirect-btn")).toBeDisabled();
  });

  it("renders Approve Session button when onApproveSession provided", () => {
    renderDialog({ onApproveSession: vi.fn() });
    expect(screen.getByTestId("approve-session-btn")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/renderer/components/layout/chat/__tests__/ReviewDialog.test.tsx
```

Expected: tests FAIL (redirect-btn doesn't exist yet, onDeny signature mismatch).

- [ ] **Step 3: Rewrite ReviewDialog.tsx**

Replace the entire content of `src/renderer/components/layout/chat/ReviewDialog.tsx`:

```tsx
import { Dialog } from "@mui/material";
import { useState } from "react";

const paperSx = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
  overflow: "hidden",
} as const;

interface ReviewDialogProps {
  title: string;
  children: React.ReactNode;
  onApproveOnce: () => void;
  onApproveSession?: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
  dataTestid: string;
}

export default function ReviewDialog({
  title,
  children,
  onApproveOnce,
  onApproveSession,
  onDeny,
  onClose,
  dataTestid,
}: ReviewDialogProps) {
  const [feedback, setFeedback] = useState("");
  const trimmed = feedback.trim();

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: paperSx } }}
      data-testid={dataTestid}
    >
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          ✕
        </button>
      </div>
      <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>{children}</div>
      <div
        style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onDeny(undefined)}
            data-testid="deny-btn"
          >
            Deny
          </button>
          {onApproveSession && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={onApproveSession}
              data-testid="approve-session-btn"
            >
              Approve Session
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={onApproveOnce}
            data-testid="approve-once-btn"
          >
            Approve Once
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell agent what to do instead…"
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 13,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <button
            type="button"
            className="btn btn--outline"
            disabled={!trimmed}
            onClick={() => onDeny(trimmed)}
            data-testid="redirect-btn"
          >
            Redirect
          </button>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/renderer/components/layout/chat/__tests__/ReviewDialog.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors. (Modal components will show type errors until Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/chat/ReviewDialog.tsx src/renderer/components/layout/chat/__tests__/ReviewDialog.test.tsx
git commit -m "feat: redesign ReviewDialog with vertical buttons and Redirect input"
```

---

## Task 7: Modal components — update onDeny signatures

**Files:**
- Modify: `src/renderer/components/layout/chat/PendingCommandModal.tsx`
- Modify: `src/renderer/components/layout/chat/PendingExecuteCodeModal.tsx`
- Modify: `src/renderer/components/layout/chat/PendingPathModal.tsx`

- [ ] **Step 1: Update PendingCommandModal.tsx**

Change the `onDeny` prop type from `() => void` to `(feedback?: string) => void`:

```ts
interface PendingCommandModalProps {
  command: BlockedCommandPayload;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
}
```

The component body passes `onDeny` directly to `ReviewDialog` — no other change needed.

- [ ] **Step 2: Update PendingExecuteCodeModal.tsx**

Change the `onDeny` prop type:

```ts
interface PendingExecuteCodeModalProps {
  request: ExecuteCodeApprovalPayload;
  onApprove: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
}
```

- [ ] **Step 3: Update PendingPathModal.tsx**

Change the `onDeny` prop type in the interface:

```ts
interface PendingPathModalProps {
  request: PathApprovalPayload;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: (feedback?: string) => void;
  onClose: () => void;
}
```

The component body passes `onDeny` directly to `ReviewDialog` — no other change needed.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors. (Banner components will have type errors until Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/chat/PendingCommandModal.tsx src/renderer/components/layout/chat/PendingExecuteCodeModal.tsx src/renderer/components/layout/chat/PendingPathModal.tsx
git commit -m "feat: update modal onDeny signatures to accept optional feedback"
```

---

## Task 8: Banner components — pass denyReason through handleResolve

**Files:**
- Modify: `src/renderer/components/layout/chat/PendingCommandBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingPathBanner.tsx`

- [ ] **Step 1: Update PendingCommandBanner.tsx**

Update `handleResolve` and the modal's `onDeny` prop:

```ts
const handleResolve = async (
  cmd: BlockedCommandPayload,
  action: "approve_once" | "approve_session" | "deny",
  denyReason?: string,
) => {
  try {
    await ipc.invoke(IPC.RESOLVE_BLOCKED_COMMAND, {
      commandId: cmd.commandId,
      action,
      projectId: cmd.projectId,
      denyReason,
    });
  } catch {
    // Handler may throw if commandId already resolved
  }
  remove(cmd);
  setSelected(null);
};
```

And the modal's `onDeny`:
```tsx
onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
```

- [ ] **Step 2: Update PendingExecuteCodeBanner.tsx**

Update `handleResolve` and the modal's `onDeny` prop:

```ts
const handleResolve = async (
  request: ExecuteCodeApprovalPayload,
  action: "approve_once" | "deny",
  denyReason?: string,
) => {
  try {
    await ipc.invoke(IPC.RESOLVE_EXECUTE_CODE_APPROVAL, {
      executionId: request.executionId,
      action,
      denyReason,
    });
  } catch {
    // Handler may throw if executionId already resolved
  }
  remove(request);
  setSelected(null);
};
```

And the modal's `onDeny`:
```tsx
onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
```

- [ ] **Step 3: Update PendingPathBanner.tsx**

Update `handleResolve` and the modal's `onDeny` prop:

```ts
const handleResolve = async (
  req: PathApprovalPayload,
  action: "approve_once" | "approve_session" | "deny",
  denyReason?: string,
) => {
  try {
    await ipc.invoke(IPC.RESOLVE_PATH_APPROVAL, {
      path: req.path,
      mode: req.mode,
      action,
      projectId: req.projectId,
      denyReason,
    });
  } catch {
    // Handler may throw if already resolved
  }
  remove(req);
  setSelected(null);
};
```

And the modal's `onDeny`:
```tsx
onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
```

- [ ] **Step 4: Typecheck + full test suite**

```bash
bun run typecheck && bun run test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 5: Check lint**

```bash
bun run check
```

Expected: zero lint/format issues.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/chat/PendingCommandBanner.tsx src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx src/renderer/components/layout/chat/PendingPathBanner.tsx
git commit -m "feat: wire denyReason from banner modals through IPC to gate resolution"
```

---

## Final verification

- [ ] **Run full suite**

```bash
bun run typecheck && bun run check && bun run test && bun run test:coverage
```

Expected: zero errors, zero lint issues, all tests pass, ≥90% coverage thresholds met.

- [ ] **Manual smoke test**

Start the app with `bun run dev`. Trigger a blocked command or path approval from an agent. In the modal:
1. Click **Deny** — agent receives tool error with original block reason, no user message appended.
2. Type something in the textarea — **Redirect** button enables.
3. Click **Redirect** — agent receives tool error with `"Denied by user: [typed text]"`.
