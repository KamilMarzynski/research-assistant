# Tool Denial Feedback

**Date:** 2026-05-19  
**Status:** Approved

## Summary

When a user denies a tool approval request, they can optionally type a message telling the agent what to do instead. The message is returned to the agent as the tool's error/result content, giving it actionable guidance rather than a bare denial.

## Problem

Currently all three approval gates (`safe_bash`, `execute_code`, `path`) resolve with a denial that carries no context. The agent only knows it was denied and must guess a different approach. This is especially wasteful mid-flight in nested worker agents where the user can see exactly what went wrong.

## Scope

All three approval types: `BASH_BLOCKED`, `EXECUTE_CODE_APPROVAL_REQUIRED`, `PATH_APPROVAL_REQUIRED`.

Nested agents: denial + reason flows into the nested agent's tool result. The parent agent is not notified — it sees only the nested agent's final summary. This is intentional and sufficient.

## Data Flow

### IPC payloads — renderer → main

Add `denyReason?: string` to all three RESOLVE payloads:

```ts
// ipc-types.ts
RESOLVE_BLOCKED_COMMAND:       { commandId: string; action: "approve_once" | "approve_session" | "deny"; projectId: string; denyReason?: string }
RESOLVE_EXECUTE_CODE_APPROVAL: { executionId: string; action: "approve_once" | "deny"; denyReason?: string }
RESOLVE_PATH_APPROVAL:         { path: string; mode: "read" | "write"; action: "approve_once" | "approve_session" | "deny"; projectId: string; denyReason?: string }
```

### Validation schemas — `ipc-validation.ts`

Add `denyReason: z.string().optional()` to `ResolveBlockedCommandSchema`, `ResolveExecuteCodeApprovalSchema`, `ResolvePathApprovalSchema`.

### Main-process gate functions

**`safe-bash.ts` — `resolveBlockedCommand`**

When `action === "deny"`, build the error message:
```ts
const msg = denyReason
  ? `Denied by user: ${denyReason}`
  : `Blocked: ${deferred.blockedResult.reason}`;
deferred.reject(new BlockedCommandError(msg, commandId, deferred.blockedResult.category));
```

**`execute-code-approval.ts` — `resolveExecuteCodeApproval`**

Gate result type gains `denyReason?: string`:
```ts
type ExecuteCodeGateResult = { approved: true; payload: ExecuteCodeApprovalPayload }
                           | { approved: false; denyReason?: string };
```

Resolve function passes it through:
```ts
pending.resolve(
  action === "approve_once"
    ? { approved: true, payload: pending.payload }
    : { approved: false, denyReason }
);
```

The execute-code tool, on `approved === false`, returns tool content:
```
"Code execution denied by user. [reason]"   // if reason present
"Code execution denied by user."             // if no reason
```

**`path-approval.ts` — `resolvePathApprovalGate`**

The gate currently resolves a boolean promise awaited by `path-jail.ts`. Change the resolved value to carry the reason:

```ts
// path-approval.ts promise resolves with:
type PathApprovalResult = { approved: true } | { approved: false; denyReason?: string };
```

`resolvePathApprovalGate` gains `denyReason?: string` and resolves accordingly. `path-jail.ts` reads the result and, on `approved === false`, returns tool content:
```
"Path access denied by user. [reason]"
"Path access denied by user."
```

**`command-handlers.ts`**

Pass `denyReason` from each parsed payload to the corresponding resolve function.

## UI

### `ReviewDialog.tsx`

New footer layout — two rows:

```
┌─────────────────────────────────────────┐
│  [modal content]                        │
├─────────────────────────────────────────┤
│                      [Approve Once    ] │
│                      [Approve Session ] │
│                      [Deny            ] │
│  [Tell agent what to do instead…][Redir]│
└─────────────────────────────────────────┘
```

- Buttons stacked right-aligned (vertical)
- Textarea + Redirect button as a full-width row below
- Redirect disabled until textarea has non-empty trimmed content
- `onDeny` signature changes to `onDeny(feedback?: string) => void`
- Clicking Deny: calls `onDeny(undefined)`
- Clicking Redirect: calls `onDeny(denyFeedback.trim())`
- Internal state: `denyFeedback: string` (empty default)
- Cancel: × button top-right of modal header

### Modal components

`PendingCommandModal`, `PendingExecuteCodeModal`, `PendingPathModal` — update `onDeny` prop signatures to `(feedback?: string) => void`. No other changes needed; they delegate directly to `ReviewDialog`.

### Banner components

`PendingCommandBanner`, `PendingExecuteCodeBanner`, `PendingPathBanner` — `handleResolve` passes `denyReason` through to the IPC invoke call when action is `"deny"`:

```ts
const handleResolve = async (item, action, denyReason?: string) => {
  await ipc.invoke(IPC.RESOLVE_BLOCKED_COMMAND, { commandId, action, projectId, denyReason });
  ...
};
```

## Error Handling

- Empty string from textarea treated as `undefined` (no reason appended)
- Reason only used when `action === "deny"` — approve paths ignore it entirely
- If `denyReason` is absent, behavior is identical to today

## Testing

- Unit tests for each gate function: verify error/result message includes reason when provided, omits it when absent
- Unit tests for `ReviewDialog`: Redirect disabled when textarea empty, enabled when filled, calls `onDeny` with trimmed text
- Existing approval/denial tests must continue to pass unchanged (no reason = same behavior)
