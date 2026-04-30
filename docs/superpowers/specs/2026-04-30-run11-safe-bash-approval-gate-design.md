# Run 11 — safe_bash Approval Gate + Audit Log

**Date:** 2026-04-30
**Scope:** Make the `safe_bash` blocklist visible to the user with an async approval gate and human-readable explanations, plus an audit log viewer in Settings.

---

## Goals

1. Refactor `safe_bash` blocklist from regex array to `BlocklistEntry[]` with `reason` strings
2. Implement async approval gate (promise-based pause) for blocked commands
3. Add IPC channels `BASH_BLOCKED` (main→renderer) and `RESOLVE_BLOCKED_COMMAND` (renderer→main)
4. Add EventBus event `bash:blocked` bridging EventBus → IPC
5. Build `PendingCommandBanner` + `PendingCommandModal` (`ChatPanel`, glassmorphism style)
6. Add session-scoped allowlist (`Set<string>` of command hashes, cleared on restart)
7. Add Auto-reject timeout on deferred promises (5 minutes)
8. Convert `SettingsModal` from single-page to tabbed layout (General | Audit Log)
9. Add `GET_AUDIT_LOG` + `CLEAR_AUDIT_LOG` IPC and viewer in Settings
10. Update `safe_bash` audit log schema to include `blocked` and `blockReason` when applicable
11. Vitest tests: blocklist matching, approval flow, audit log IPC

---

## Out of Scope

- Docker command gating (`run_in_docker` stays separate; this run only touches `safe_bash`)
- Per-project blocklist configurability (AGENTS.md parsing; deferred)
- Smart mode (LLM risk assessment; deferred — low priority from Hermes analysis)
- YOLO mode (deferred — low priority)
- OS notifications for blocked commands (deferred to Run 13)
- Any renderer changes beyond the approval gate components and Settings tabs

---

## Section 1 — Blocklist Refactor

### 1.1 New `BlocklistEntry` Shape

Replace `BLOCKLIST_PATTERNS: RegExp[]` in `safe-bash.ts` with:

```typescript
interface BlocklistEntry {
  pattern: RegExp;
  key: string;
  reason: string;
  category: 'destructive' | 'privilege_escalation' | 'exfiltration' | 'persistence';
}

const BLOCKLIST: BlocklistEntry[] = [
  {
    pattern: /\brm\s+-rf\b/,
    key: 'recursive_delete',
    reason: 'This command would recursively delete files without recovery.',
    category: 'destructive',
  },
  {
    pattern: /\bsudo\b/,
    key: 'sudo',
    reason: 'Privilege escalation commands require user review.',
    category: 'privilege_escalation',
  },
  {
    pattern: /\bchmod\s+\+x\b/,
    key: 'make_executable',
    reason: 'Making files executable without review is a security risk.',
    category: 'persistence',
  },
  {
    pattern: /\bmkfs\b/,
    key: 'format_filesystem',
    reason: 'Filesystem formatting is destructive and irreversible.',
    category: 'destructive',
  },
  {
    pattern: /\bdd\b\s+if=/,
    key: 'raw_disk_io',
    reason: 'Raw disk I/O can corrupt data.',
    category: 'destructive',
  },
  {
    pattern: /\bcurl\b/,
    key: 'curl',
    reason: 'Network outbound commands are blocked. Use fetch_url tool instead.',
    category: 'exfiltration',
  },
  {
    pattern: /\bwget\b/,
    key: 'wget',
    reason: 'Network outbound commands are blocked. Use fetch_url tool instead.',
    category: 'exfiltration',
  },
  {
    pattern: /\beval\b/,
    key: 'eval',
    reason: 'Dynamic code execution poses injection risks.',
    category: 'persistence',
  },
  {
    pattern: /`/,
    key: 'backtick_subshell',
    reason: 'Backtick subshells bypass command review.',
    category: 'persistence',
  },
  {
    pattern: /\$\(/,
    key: 'command_substitution',
    reason: 'Command substitution ($(...)) can execute hidden code.',
    category: 'persistence',
  },
];
```

### 1.2 `checkBlocklist` Return Type

```typescript
function checkBlocklist(command: string): BlocklistEntry | null
```

Returns the matching `BlocklistEntry` instead of throwing. Calling code then decides whether to execute immediately (no match) or enter the approval gate.

---

## Section 2 — Approval Gate (Promise-Based Pause)

### 2.1 Problem Statement

Currently, a blocked command throws synchronously. The Pi SDK treats a thrown tool execution as a tool error, and the agent's message continues. The user sees nothing.

### 2.2 Solution: Tool-Level Deferred Promise

`runSafeBash()` is refactored into a two-phase flow:

```typescript
interface SafeBashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

interface BlockedCommandPromise {
  commandId: string;
  resolve: (result: SafeBashResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
```

In-memory state (module-level, safe for single-threaded Node.js):

```typescript
const blockedPromises = new Map<string, BlockedCommandPromise>();
const sessionAllowlist = new Set<string>(); // command hashes

function hashCommand(command: string): string {
  // SHA-256 of trimmed + lowercase+normalized command string
  return createHash('sha256').update(command.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');
}
```

### 2.3 Execution Flow

**Phase A: Command received**

```typescript
export async function runSafeBash(options: SafeBashOptions): Promise<SafeBashResult> {
  const match = checkBlocklist(options.command);

  if (match) {
    // Session allowlist bypass
    if (sessionAllowlist.has(hashCommand(options.command))) {
      return runSafeBashInternal(options);
    }

    return enterApprovalGate(options, match);
  }

  return runSafeBashInternal(options);
}
```

**Phase B: Approval gate**

```typescript
function enterApprovalGate(options: SafeBashOptions, entry: BlocklistEntry): Promise<SafeBashResult> {
  return new Promise((resolve, reject) => {
    const commandId = crypto.randomUUID();

    // Auto-reject after 5 minutes to prevent zombie promises
    const timer = setTimeout(() => {
      blockedPromises.delete(commandId);
      reject(new BlockedCommandError(`Approval timed out. ${entry.reason}`));
    }, 300_000);

    blockedPromises.set(commandId, { commandId, resolve, reject, timer });

    // Emit event for the rest of the app (IPC rendering, audit log, etc.)
    eventBus?.emit({
      type: 'bash:blocked',
      payload: {
        commandId,
        command: options.command,
        reason: entry.reason,
        category: entry.category,
        key: entry.key,
        projectId: options.projectId,
        intent: options.intent,
        timestamp: new Date().toISOString(),
      },
    });
  });
}
```

Note: `eventBus` instance needs to be injected into `safe-bash.ts`. Currently `safe-bash.ts` has no DI. The cleanest approach: accept `emitBlocked?: (payload: BlockedPayload) => void` as an optional parameter in `SafeBashOptions`, and wire it from `tools.ts` (which already has access to services via closure).

**Phase C: Resolution**

```typescript
export function resolveBlockedCommand(
  commandId: string,
  action: 'approve_once' | 'approve_session' | 'deny',
  options: SafeBashOptions,
  entry: BlocklistEntry,
): void {
  const deferred = blockedPromises.get(commandId);
  if (!deferred) return;

  clearTimeout(deferred.timer);
  blockedPromises.delete(commandId);

  if (action === 'deny') {
    deferred.reject(new BlockedCommandError(`Blocked: ${entry.reason}`));
    return;
  }

  if (action === 'approve_session') {
    sessionAllowlist.add(hashCommand(options.command));
  }

  // Execute the command and resolve the promise with the result
  runSafeBashInternal(options).then(deferred.resolve, deferred.reject);
}
```

### 2.4 `BlockedCommandError` Class

```typescript
class BlockedCommandError extends Error {
  readonly commandId?: string;
  readonly category?: string;

  constructor(message: string, commandId?: string, category?: string) {
    super(message);
    this.name = 'BlockedCommandError';
    this.commandId = commandId;
    this.category = category;
  }
}
```

---

## Section 3 — IPC + EventBus Wiring

### 3.1 New Channels

Add to `src/shared/ipc-channels.ts`:

```typescript
export const IPC = {
  // ... existing channels ...
  BASH_BLOCKED: 'bash-blocked',
  RESOLVE_BLOCKED_COMMAND: 'resolve-blocked-command',
  GET_AUDIT_LOG: 'get-audit-log',
  CLEAR_AUDIT_LOG: 'clear-audit-log',
} as const;
```

### 3.2 EventBus Type

Add to `src/main/event-bus.ts`:

```typescript
type AppEvent =
  // ... existing events ...
  | {
      type: 'bash:blocked';
      payload: {
        commandId: string;
        command: string;
        reason: string;
        category: string;
        key: string;
        projectId: string;
        intent: string;
        timestamp: string;
      };
    };
```

### 3.3 IPC Handlers in `ipc-handlers.ts`

Register at startup ( alongside existing handlers):

```typescript
// EventBus → IPC bridge for bash:blocked
eventBus.on('bash:blocked', (payload) => {
  win.webContents.send(IPC.BASH_BLOCKED, payload);
});

// Renderer → main: resolve a blocked command
ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, async (_event, payload: unknown) => {
  assertIsObject(payload);
  const { commandId, action } = payload as { commandId: string; action: string };
  const commandIdStr = String(commandId);
  if (!['approve_once', 'approve_session', 'deny'].includes(action)) {
    throw new Error(`Invalid action: ${action}`);
  }

  // The deferred promise and its options are stored in safe-bash.ts's module state.
  // resolveBlockedCommand needs access to the original SafeBashOptions.
  // Solution: store options alongside the promise in blockedPromises Map.
  // Refactoring deferred entry to include options:
  // interface BlockedCommandEntry {
  //   commandId: string;
  //   options: SafeBashOptions;
  //   entry: BlocklistEntry;
  //   resolve, reject, timer;
  // }
  resolveBlockedCommand(commandIdStr, action);
});

// Audit log IPC handlers
ipcMain.handle(IPC.GET_AUDIT_LOG, async (_event, payload) => {
  const limit = (payload as { limit?: number })?.limit;
  const path = join(app.getPath('userData'), '..', '.research-assistant', 'audit.log');
  // Alternative: accept auditLogPath via DI or HomeService
});

ipcMain.handle(IPC.CLEAR_AUDIT_LOG, async () => {
  const path = /* derive audit log path via HomeService */;
  await writeFile(path, '', 'utf-8');
});
```

Note on `ipc-handlers.ts` injection: `ipc-handlers.ts` is a module-side-effect file that depends on `win` (BrowserWindow). The `resolveBlockedCommand` and `auditLogPath` need to resolve through `HomeService`. The cleanest approach is to import and call the exported functions from `safe-bash.ts` directly, passing the needed parameters.

---

## Section 4 — Renderer Components

### 4.1 `PendingCommandBanner.tsx`

Mounts in `ChatPanel.tsx` between `ResearchStatusBar` and `PendingToolBanner`:

```tsx
interface BlockedCommand {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  projectId: string;
  intent: string;
  timestamp: string;
}

export default function PendingCommandBanner() {
  const [blocked, setBlocked] = useState<BlockedCommand[]>([]);
  const [selected, setSelected] = useState<BlockedCommand | null>(null);

  useEffect(() => {
    const unsub = window.electronAPI.on(IPC.BASH_BLOCKED, (data) => {
      const cmd = data as BlockedCommand;
      setBlocked((prev) => {
        if (prev.some((c) => c.commandId === cmd.commandId)) return prev;
        return [...prev, cmd];
      });
    });
    return unsub;
  }, []);

  // ... handleResolve maps to invoke(IPC.RESOLVE_BLOCKED_COMMAND) ...
  // ... renders glassSx banner per blocked command ...
  // ... clicking Review opens PendingCommandModal ...
}
```

### 4.2 `PendingCommandModal.tsx`

Mirrors `PendingToolModal.tsx` with three action buttons:

```tsx
interface PendingCommandModalProps {
  command: BlockedCommand;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
}
```

Shows:
- Command string in `<pre>` block
- Human-readable reason
- Category badge (color-coded: destructive=red, privilege_escalation=orange, exfiltration=yellow, persistence=purple)
- Three buttons: `[Approve Once]` | `[Approve Session]` | `[Deny]`

### 4.3 `ChatPanel.tsx` Integration

```tsx
import PendingCommandBanner from './PendingCommandBanner';
// ...
<ResearchStatusBar />
<PendingCommandBanner />
<PendingToolBanner />
```

---

## Section 5 — SettingsModal Tabbed Redesign + Audit Log

### 5.1 Tabbed Layout

Replace the flat `SettingsModal` with MUI `Tabs` + `TabPanel`:

```tsx
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [auditLogEntries, setAuditLogEntries] = useState<AuditLogEntry[]>([]);
  const [auditLogFilter, setAuditLogFilter] = useState<'all' | 'executed' | 'blocked' | 'docker'>('all');

  // ... useEffect for GET_SETTINGS + GET_AUDIT_LOG on mount ...
  // ... handleSave, handleClearLog ...

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: glassSx }}>
      <DialogTitle>Settings</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="General" />
        <Tab label="Audit Log" />
      </Tabs>
      {tab === 0 && <GeneralTab ... />}
      {tab === 1 && <AuditLogTab entries={auditLogEntries} filter={auditLogFilter} onFilterChange={setAuditLogFilter} onClear={handleClearLog} />}
    </Dialog>
  );
}
```

### 5.2 Audit Log Tab

Reads from `GET_AUDIT_LOG` IPC on mount and on tab switch.

Displays:
- Filter chips: All | Executed | Blocked | Docker
- Scrollable monospace list
- Each row: timestamp | status badge | command | projectId | exitCode / reason
- "Clear log" button with confirmation Dialog

---

## Section 6 — Audit Log Schema Update

### 6.1 Blocked Entry Shape

When a blocked command is encountered (before execution), `safe-bash.ts` appends:

```json
{"ts":"2026-04-30T10:25:43.000Z","projectId":"p1","intent":"Fetch API","command":"curl https://example.com","exitCode":null,"blocked":true,"blockReason":"Network outbound blocked","blockKey":"curl","blockCategory":"exfiltration"}
```

On approve, a follow-up entry is written:

```json
{"ts":"2026-04-30T10:26:12.000Z","projectId":"p1","intent":"Fetch API","command":"curl https://example.com","exitCode":0,"blocked":false}
```

### 6.2 Audit Log Type

```typescript
interface AuditLogEntry {
  ts: string;
  projectId: string;
  intent: string;
  command: string;
  exitCode: number | null;
  blocked?: boolean;
  blockReason?: string;
  blockKey?: string;
  blockCategory?: string;
}
```

---

## Section 7 — Tool Handlers in `tools.ts`

### 7.1 Wiring `emitBlocked`

`AgentToolsOptions` gets an optional `eventBus?: EventBus` (or `emitBlocked?: BlockedPayload => void`):

```typescript
export interface AgentToolsOptions {
  projectId: string;
  folderPath: string | null;
  proposeToolFn?: ...;
  toolNames?: AgentToolName[];
  eventBus?: EventBus; // for safe_bash approval gate
}
```

In `createAgentTools()`, wired to `runSafeBash`:

```typescript
const result = await runSafeBash({
  command,
  intent,
  projectId,
  workspacePath,
  auditLogPath,
  emitBlocked: opts.eventBus
    ? (payload) => opts.eventBus!.emit({ type: 'bash:blocked', payload })
    : undefined,
});
```

Note: if `emitBlocked` is undefined (e.g. unit tests or agents without EventBus), blocked commands fall back to the current behavior (immediate throw with reason). This preserves backward compatibility.

### 7.2 Handle Blocked Sentinel

```typescript
execute: async (_id, { command, intent }) => {
  await mkdir(workspacePath, { recursive: true });
  const result = await runSafeBash({ ... });

  if (result === 'BLOCKED') {
    // The tool result is returned to the agent with a placeholder message.
    // The deferred promise resolves later and the agent continues.
    return {
      content: [{ type: 'text', text: '⏳ Command blocked. Waiting for user approval...' }],
    };
  }

  const summary = [/* ... existing formatting ... */];
  return { content: [{ type: 'text', text: summary }], details: result };
},
```

Actually, with the promise-based approach, `runSafeBash` itself **is** the promise. It doesn't return early — it just resolves later. The `tools.ts` tool handler naturally awaits it. No sentinel needed; just return normally:

```typescript
execute: async (_id, { command, intent }) => {
  await mkdir(workspacePath, { recursive: true });
  const result = await runSafeBash({
    command,
    intent,
    projectId,
    workspacePath,
    auditLogPath,
    emitBlocked: opts.eventBus
      ? (payload) => {
          opts.eventBus!.emit({ type: 'bash:blocked', payload });
        }
      : undefined,
  });

  const summary = [/* ... format result ... */];
  return { content: [{ type: 'text', text: summary }], details: result };
},
```

The `runSafeBash` promise resolves after user approval and returns a full `SafeBashResult`. That's it — transparent to `tools.ts`.

---

## Section 8 — Tests

### 8.1 `safe-bash.test.ts`

- **blocklist matching:** each entry matches expected strings, allows expected strings
- **reason matching:** `checkBlocklist` returns correct `reason` string per key
- **session allowlist:** after `sessionAllowlist.add(hash)`, previously blocked command executes
- **approval gate promise:** mocked `emitBlocked` called, promise remains pending until resolution
- **auto-reject timeout:** promise rejects after 5 min (use fake timers)
- **blocked audit log entry:** JSONL entry contains `blocked: true`, `blockReason`, `blockKey`, `blockCategory`

### 8.2 IPC + Renderer Tests

- `PendingCommandBanner` renders on `BASH_BLOCKED` event
- `PendingCommandModal` fires correct IPC invoke on button click
- `resolveBlockedCommand` main-side handler looks up and resolves the deferred promise
- `GET_AUDIT_LOG` returns parsed JSONL entries
- `CLEAR_AUDIT_LOG` truncates file

### 8.3 SettingsModal Tests

- Tab switching works
- Audit Log tab renders entries
- Filter chips filter by `blocked`/`executed`/`docker`
- Clear button shows confirmation

---

## Section 9 — Files Changed

| File | Change |
|---|---|
| `src/main/agent/extensions/safe-bash.ts` | Refactor blocklist → `BlocklistEntry[]`, add approval gate logic, `resolveBlockedCommand`, `sessionAllowlist` |
| `src/main/agent/extensions/safe-bash.test.ts` | Update tests for new blocklist shape, add approval gate tests |
| `src/main/agent/tools.ts` | Wire `emitBlocked` from `eventBus` into `runSafeBash` options |
| `src/main/agent/tools.test.ts` | Add tool-level blocked command test |
| `src/main/event-bus.ts` | Add `bash:blocked` event type |
| `src/shared/ipc-channels.ts` | Add `BASH_BLOCKED`, `RESOLVE_BLOCKED_COMMAND`, `GET_AUDIT_LOG`, `CLEAR_AUDIT_LOG` |
| `src/main/ipc-handlers.ts` | Register new handlers + EventBus bridge |
| `src/main/services/HomeService.ts` | Helper to resolve audit log path |
| `src/main/services/FileService.ts` | New: `readFileLines(path, limit)` for audit log |
| `src/renderer/components/layout/chat/PendingCommandBanner.tsx` | New |
| `src/renderer/components/layout/chat/PendingCommandModal.tsx` | New |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Import + mount `PendingCommandBanner` |
| `src/renderer/components/settings/SettingsModal.tsx` | Tabbed layout + Audit Log tab |
| `src/renderer/components/settings/audit-log/*` | New components (optional subdirectory) |

---

## Related Notes

- [[Research Assistant - Hermes Agent Safety Analysis]] — high priority items: async approval gate, human-readable blocklist, audit log surfacing
- [[Research Assistant - Next Iteration Specification]] — Run 11 specification (this document implements it)
- [[Research Assistant - Current State]] — baseline as of 2026-04-29
- `src/main/agent/extensions/safe-bash.ts` — existing implementation
- `src/renderer/components/layout/chat/PendingToolBanner.tsx` — pattern being mirrored
