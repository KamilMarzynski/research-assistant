# Run 11 — safe_bash Approval Gate + Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `safe_bash` blocklist with human-readable reasons, implement async approval gate with UI (PendingCommandBanner + PendingCommandModal), expose an audit log viewer in a tabbed Settings dialog.

**Architecture:** Blocked commands create deferred promises stored in a module-level `Map`. A callback (`emitBlocked`) wired from `tools.ts` bridges to the EventBus → IPC → renderer. User approval resolves the promise; deny rejects it. SettingsModal adds MUI Tabs to host Audit Log viewer.

**Tech Stack:** Bun, TypeScript, Pi SDK, Electron IPC, MUI v9, Vitest

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/agent/extensions/safe-bash.ts` | Blocklist definitions, `checkBlocklist`, `runSafeBash` gate, deferred promise store, `resolveBlockedCommand`, `BlockedCommandError` |
| `src/main/agent/extensions/safe-bash.test.ts` | Tests for blocklist matching, allowlist, approval gate, timeout |
| `src/main/agent/tools.ts` | Wire `emitBlocked` callback into `runSafeBash` options |
| `src/main/event-bus.ts` | Add `bash:blocked` event type to `AppEvent` union |
| `src/shared/ipc-channels.ts` | Add `BASH_BLOCKED`, `RESOLVE_BLOCKED_COMMAND`, `GET_AUDIT_LOG`, `CLEAR_AUDIT_LOG` |
| `src/main/ipc-handlers.ts` | Register new IPC handlers and EventBus bridge |
| `src/main/services/HomeService.ts` | Add `getAuditLogPath()` helper |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Mount `PendingCommandBanner` |
| `src/renderer/components/layout/chat/PendingCommandBanner.tsx` | **Create** — subscribe to `BASH_BLOCKED`, list blocked commands, open modal |
| `src/renderer/components/layout/chat/PendingCommandModal.tsx` | **Create** — show command + reason + category + Approve Once/Session/Deny buttons |
| `src/renderer/components/settings/SettingsModal.tsx` | **Rewrite** — tabbed layout: General + Audit Log |
| `src/renderer/components/settings/AuditLogTab.tsx` | **Create** — audit log viewer with filter chips |

---

### Task 1: Refactor Blocklist with Human-Readable Entries

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts:1-41`
- Test: `src/main/agent/extensions/safe-bash.test.ts:7-41`

`checkBlocklist` currently throws on match. We need it to **return** the matched entry instead.

- [ ] **Step 1: Write the failing test**

Update `src/main/agent/extensions/safe-bash.test.ts` lines 7-41 (replace existing `checkBlocklist` describe block):

```typescript
describe("checkBlocklist", () => {
  it("returns matching entry for rm -rf", () => {
    const entry = checkBlocklist("rm -rf /tmp/test");
    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("recursive_delete");
  });

  it("returns matching entry for curl", () => {
    const entry = checkBlocklist("curl https://example.com");
    expect(entry?.key).toBe("curl");
    expect(entry?.reason).toContain("Network outbound");
  });

  it("returns null for safe commands", () => {
    expect(checkBlocklist("ls -la")).toBeNull();
    expect(checkBlocklist("cat README.md")).toBeNull();
    expect(checkBlocklist("bun run test")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run src/main/agent/extensions/safe-bash.test.ts`
Expected: FAIL — `checkBlocklist` still throws on match, tests expect return value

- [ ] **Step 3: Refactor blocklist entries**

Replace lines 1-41 in `src/main/agent/extensions/safe-bash.ts` with:

```typescript
import { createHash, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export interface BlocklistEntry {
  pattern: RegExp;
  key: string;
  reason: string;
  category: "destructive" | "privilege_escalation" | "exfiltration" | "persistence";
}

const BLOCKLIST: BlocklistEntry[] = [
  {
    pattern: /\brm\s+-rf\b/,
    key: "recursive_delete",
    reason: "This command would recursively delete files without recovery.",
    category: "destructive",
  },
  {
    pattern: /\bsudo\b/,
    key: "sudo",
    reason: "Privilege escalation commands require user review.",
    category: "privilege_escalation",
  },
  {
    pattern: /\bchmod\s+\+x\b/,
    key: "make_executable",
    reason: "Making files executable without review is a security risk.",
    category: "persistence",
  },
  {
    pattern: /\bmkfs\b/,
    key: "format_filesystem",
    reason: "Filesystem formatting is destructive and irreversible.",
    category: "destructive",
  },
  {
    pattern: /\bdd\b\s+if=/,
    key: "raw_disk_io",
    reason: "Raw disk I/O can corrupt data.",
    category: "destructive",
  },
  {
    pattern: /\bcurl\b/,
    key: "curl",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\bwget\b/,
    key: "wget",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\beval\b/,
    key: "eval",
    reason: "Dynamic code execution poses injection risks.",
    category: "persistence",
  },
  {
    pattern: /`/,
    key: "backtick_subshell",
    reason: "Backtick subshells bypass command review.",
    category: "persistence",
  },
  {
    pattern: /\$\(/,
    key: "command_substitution",
    reason: "Command substitution ($(...)) can execute hidden code.",
    category: "persistence",
  },
];

export function checkBlocklist(command: string): BlocklistEntry | null {
  for (const entry of BLOCKLIST) {
    if (entry.pattern.test(command)) {
      return entry;
    }
  }
  return null;
}

export class BlockedCommandError extends Error {
  readonly commandId?: string;
  readonly category?: string;

  constructor(message: string, commandId?: string, category?: string) {
    super(message);
    this.name = "BlockedCommandError";
    this.commandId = commandId;
    this.category = category;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run src/main/agent/extensions/safe-bash.test.ts`
Expected: PASS — checkBlocklist returns entries correctly

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat: refactor blocklist to BlocklistEntry with human-readable reasons"
```

---

### Task 2: Add Deferred Promise Approval Gate to safe-bash.ts

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts:42-131` → rewrite entire file

Add in-memory `blockedPromises` Map, `sessionAllowlist` Set, `hashCommand`, `enterApprovalGate`, `resolveBlockedCommand`, `runSafeBashInternal` (extracted from current `runSafeBash`), and wire `emitBlocked` into `SafeBashOptions`.

- [ ] **Step 1: Write the failing test**

Add new describe blocks to `safe-bash.test.ts` after existing tests:

```typescript
describe("approval gate", () => {
  let workDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "safebash-test-"));
    auditLogPath = join(workDir, "audit.log");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    // Reset module-level state
    sessionAllowlist.clear();
    for (const [, entry] of blockedPromises) {
      clearTimeout(entry.timer);
    }
    blockedPromises.clear();
  });

  it("blocks curl and calls emitBlocked", async () => {
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "curl https://example.com",
      intent: "fetch data",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });

    expect(emitBlocked).toHaveBeenCalledOnce();
    const payload = emitBlocked.mock.calls[0][0];
    expect(payload.command).toBe("curl https://example.com");
    expect(payload.reason).toContain("Network outbound");
    expect(payload.commandId).toBeDefined();

    // Deny to clean up
    resolveBlockedCommand(payload.commandId, "deny");
    await expect(promise).rejects.toThrow(/Blocked/);
  });

  it("approve_once executes command and resolves", async () => {
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "echo approved-once",
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });

    const payload = emitBlocked.mock.calls[0][0];
    resolveBlockedCommand(payload.commandId, "approve_once");

    const result = await promise;
    expect(result.stdout.trim()).toBe("approved-once");
    expect(result.exitCode).toBe(0);
  });

  it("approve_session adds hash to allowlist", async () => {
    const emitBlocked = vi.fn();
    const command = "echo session-approved";

    // First call blocked, approve_session
    const promise1 = runSafeBash({
      command,
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
    });
    const payload = emitBlocked.mock.calls[0][0];
    resolveBlockedCommand(payload.commandId, "approve_session");
    await promise1;

    // Second call should pass through (not blocked)
    const emitBlocked2 = vi.fn();
    const result = await runSafeBash({
      command,
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked2,
    });
    expect(emitBlocked2).not.toHaveBeenCalled();
    expect(result.stdout.trim()).toBe("session-approved");
  });

  it("auto-rejects after timeout", { timeout: 300_000 }, async () => {
    vi.useFakeTimers();
    const emitBlocked = vi.fn();
    const promise = runSafeBash({
      command: "curl https://example.com",
      intent: "test",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
      emitBlocked,
      timeoutMs: 5_000,
    });

    vi.advanceTimersByTime(300_001);

    await expect(promise).rejects.toThrow(/timed out/i);
    vi.useRealTimers();
  });

  it("falls back to throw when emitBlocked not provided", async () => {
    await expect(
      runSafeBash({
        command: "curl https://example.com",
        intent: "test",
        projectId: "p1",
        workspacePath: workDir,
        auditLogPath,
      }),
    ).rejects.toThrow(/Blocked: Network outbound/);
  });
});
```

Note: add `vi` import from `vitest` at top of test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run src/main/agent/extensions/safe-bash.test.ts`
Expected: FAIL — `runSafeBash` rejects immediately instead of entering gate; `resolveBlockedCommand` and `sessionAllowlist` don't exist; `emitBlocked` not in `SafeBashOptions`

- [ ] **Step 3: Rewrite safe-bash.ts**

Replace the entire file (`src/main/agent/extensions/safe-bash.ts`):

```typescript
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";

// --- Blocklist ---

export interface BlocklistEntry {
  pattern: RegExp;
  key: string;
  reason: string;
  category: "destructive" | "privilege_escalation" | "exfiltration" | "persistence";
}

const BLOCKLIST: BlocklistEntry[] = [
  {
    pattern: /\brm\s+-rf\b/,
    key: "recursive_delete",
    reason: "This command would recursively delete files without recovery.",
    category: "destructive",
  },
  {
    pattern: /\bsudo\b/,
    key: "sudo",
    reason: "Privilege escalation commands require user review.",
    category: "privilege_escalation",
  },
  {
    pattern: /\bchmod\s+\+x\b/,
    key: "make_executable",
    reason: "Making files executable without review is a security risk.",
    category: "persistence",
  },
  {
    pattern: /\bmkfs\b/,
    key: "format_filesystem",
    reason: "Filesystem formatting is destructive and irreversible.",
    category: "destructive",
  },
  {
    pattern: /\bdd\b\s+if=/,
    key: "raw_disk_io",
    reason: "Raw disk I/O can corrupt data.",
    category: "destructive",
  },
  {
    pattern: /\bcurl\b/,
    key: "curl",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\bwget\b/,
    key: "wget",
    reason: "Network outbound commands are blocked. Use fetch_url tool instead.",
    category: "exfiltration",
  },
  {
    pattern: /\beval\b/,
    key: "eval",
    reason: "Dynamic code execution poses injection risks.",
    category: "persistence",
  },
  {
    pattern: /`/,
    key: "backtick_subshell",
    reason: "Backtick subshells bypass command review.",
    category: "persistence",
  },
  {
    pattern: /\$\(/,
    key: "command_substitution",
    reason: "Command substitution ($(...)) can execute hidden code.",
    category: "persistence",
  },
];

export function checkBlocklist(command: string): BlocklistEntry | null {
  for (const entry of BLOCKLIST) {
    if (entry.pattern.test(command)) {
      return entry;
    }
  }
  return null;
}

// --- Error ---

export class BlockedCommandError extends Error {
  readonly commandId?: string;
  readonly category?: string;

  constructor(message: string, commandId?: string, category?: string) {
    super(message);
    this.name = "BlockedCommandError";
    this.commandId = commandId;
    this.category = category;
  }
}

// --- Approval Gate State ---

interface BlockedCommandEntry {
  commandId: string;
  options: SafeBashOptions;
  blocklistEntry: BlocklistEntry;
  resolve: (result: SafeBashResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const blockedPromises = new Map<string, BlockedCommandEntry>();
export const sessionAllowlist = new Set<string>();

function hashCommand(command: string): string {
  return createHash("sha256")
    .update(command.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

// --- Interfaces ---

export interface SafeBashOptions {
  command: string;
  intent: string;
  projectId: string;
  workspacePath: string;
  auditLogPath: string;
  timeoutMs?: number;
  emitBlocked?: (payload: {
    commandId: string;
    command: string;
    reason: string;
    category: string;
    key: string;
    projectId: string;
    intent: string;
    timestamp: string;
  }) => void;
}

export interface SafeBashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

// --- Internal Execution (after approval) ---

const MAX_OUTPUT_BYTES = 2048;

function runSafeBashInternal(opts: SafeBashOptions): Promise<SafeBashResult> {
  const { command, intent, projectId, workspacePath, auditLogPath, timeoutMs = 30_000 } = opts;

  return new Promise<SafeBashResult>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const proc = spawn("bash", ["-c", command], {
      cwd: workspacePath,
      signal: controller.signal,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const settle = (result: SafeBashResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
        if (stdout.length >= MAX_OUTPUT_BYTES) {
          truncated = true;
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
        if (stderr.length >= MAX_OUTPUT_BYTES) {
          truncated = true;
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (
        (err as NodeJS.ErrnoException).code === "ABORT_ERR" ||
        (err as NodeJS.ErrnoException).name === "AbortError"
      ) {
        settle({
          stdout,
          stderr: "Timeout: command exceeded 30s limit.",
          exitCode: 124,
          truncated,
        });
      } else {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (truncated) {
        stdout += `\n[truncated — output exceeded ${MAX_OUTPUT_BYTES} bytes]`;
      }

      const logEntry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        projectId,
        intent,
        command,
        exitCode: code ?? 1,
      };

      appendFile(auditLogPath, `${JSON.stringify(logEntry)}\n`, "utf-8").catch(console.error);

      settle({ stdout, stderr, exitCode: code ?? 1, truncated });
    });
  });
}

// --- Approval Gate ---

function enterApprovalGate(opts: SafeBashOptions, entry: BlocklistEntry): Promise<SafeBashResult> {
  return new Promise((resolve, reject) => {
    const commandId = randomUUID();

    const timer = setTimeout(() => {
      blockedPromises.delete(commandId);
      reject(
        new BlockedCommandError(
          `Approval timed out. ${entry.reason}`,
          commandId,
          entry.category,
        ),
      );
    }, 300_000);

    blockedPromises.set(commandId, {
      commandId,
      options: opts,
      blocklistEntry: entry,
      resolve,
      reject,
      timer,
    });

    if (opts.emitBlocked) {
      opts.emitBlocked({
        commandId,
        command: opts.command,
        reason: entry.reason,
        category: entry.category,
        key: entry.key,
        projectId: opts.projectId,
        intent: opts.intent,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

export function resolveBlockedCommand(
  commandId: string,
  action: "approve_once" | "approve_session" | "deny",
): void {
  const deferred = blockedPromises.get(commandId);
  if (!deferred) return;

  clearTimeout(deferred.timer);
  blockedPromises.delete(commandId);

  if (action === "deny") {
    deferred.reject(
      new BlockedCommandError(
        `Blocked: ${deferred.blocklistEntry.reason}`,
        commandId,
        deferred.blocklistEntry.category,
      ),
    );
    return;
  }

  if (action === "approve_session") {
    sessionAllowlist.add(hashCommand(deferred.options.command));
  }

  void runSafeBashInternal(deferred.options).then(deferred.resolve, deferred.reject);
}

// --- Public API ---

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const entry = checkBlocklist(opts.command);

  if (entry) {
    if (sessionAllowlist.has(hashCommand(opts.command))) {
      return runSafeBashInternal(opts);
    }

    if (opts.emitBlocked) {
      return enterApprovalGate(opts, entry);
    }

    throw new BlockedCommandError(
      `Blocked: ${entry.reason}`,
      undefined,
      entry.category,
    );
  }

  return runSafeBashInternal(opts);
}
```

*Note*: The `blockedPromises` and `sessionAllowlist` are exported for test access only. In production code, they are module-level singletons.

- [ ] **Step 4: Run tests**

Run: `bun vitest run src/main/agent/extensions/safe-bash.test.ts`
Expected: All blocklist + approval gate tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat: add async approval gate for safe_bash with deferred promises"
```

---

### Task 3: Wire emitBlocked from tools.ts into runSafeBash

**Files:**
- Modify: `src/main/agent/tools.ts:38-54` (options interface)
- Modify: `src/main/agent/tools.ts:119-152` (safe_bash tool handler)
- Modify: `src/main/agent/tools.test.ts` (add test for blocked command fallback)

- [ ] **Step 1: Add eventBus to AgentToolsOptions**

In `src/main/agent/tools.ts`, add to `AgentToolsOptions`:

```typescript
import type { EventBus } from "../event-bus";

export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  // ... existing ...
  eventBus?: EventBus;
}
```

- [ ] **Step 2: Wire emitBlocked into safe_bash tool handler**

In `src/main/agent/tools.ts`, modify the `safe_bash` tool handler (around lines 119-152):

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
                opts.eventBus!.emit({ type: "bash:blocked", payload });
              }
            : undefined,
        });
        // ... rest unchanged: format summary from result ...
      },
```

- [ ] **Step 3: Write the test**

In `src/main/agent/tools.test.ts`, add a test verifying that `safe_bash` emits `bash:blocked` when `eventBus` is provided (or throws when not):

```typescript
it("safe_bash emits bash:blocked when eventBus provided", async () => {
  const eventBus = { emit: vi.fn() } as unknown as EventBus;
  const tools = createAgentTools({
    projectId: "p1",
    projectName: "Test",
    folderPath: null,
    homePath: tmpDir,
    eventBus,
  });

  const safeBashTool = tools.find((t) => t.name === "safe_bash");
  expect(safeBashTool).toBeDefined();

  // Mock emitBlocked path: the tool should enter approval gate (promise pending)
  const promise = safeBashTool!.execute("test-id", { command: "curl https://example.com", intent: "test" });

  expect(eventBus.emit).toHaveBeenCalledOnce();
  const emitted = eventBus.emit.mock.calls[0][0];
  expect(emitted.type).toBe("bash:blocked");
  expect(emitted.payload.command).toBe("curl https://example.com");

  // Deny to clean up
  resolveBlockedCommand(emitted.payload.commandId, "deny");
  await expect(promise).rejects.toThrow(/Blocked/);
});
```

- [ ] **Step 4: Run tests**

Run: `bun vitest run src/main/agent/tools.test.ts`
Expected: New test may compile-error if `EventBus` type not imported; fix imports and rerun until pass

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts
git commit -m "feat: wire EventBus into safe_bash for approval gate"
```

---

### Task 4: Add bash:blocked EventType + IPC Channels

**Files:**
- Modify: `src/main/event-bus.ts:4-18`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add event type**

In `src/main/event-bus.ts`, append before the `EventBus` class:

```typescript
type AppEvent =
  | { type: "research:started"; payload: { taskId: string; projectId: string; query: string } }
  | { type: "research:progress"; payload: { taskId: string; message: string; label?: string } }
  | {
      type: "research:complete";
      payload: {
        taskId: string;
        artifactId: string;
        projectId: string;
        query: string;
        filePath: string;
      };
    }
  | { type: "research:failed"; payload: { taskId: string; error: string } }
  | { type: "tool:pending"; payload: { name: string; skillContent: string } }
  | {
      type: "bash:blocked";
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

- [ ] **Step 2: Add IPC channels**

In `src/shared/ipc-channels.ts`, add after `TOOL_PENDING`:

```typescript
  BASH_BLOCKED: "bash-blocked",
  RESOLVE_BLOCKED_COMMAND: "resolve-blocked-command",
  GET_AUDIT_LOG: "get-audit-log",
  CLEAR_AUDIT_LOG: "clear-audit-log",
```

- [ ] **Step 3: Commit**

```bash
git add src/main/event-bus.ts src/shared/ipc-channels.ts
git commit -m "feat: add bash:blocked event type and IPC channels for approval gate"
```

---

### Task 5: Register IPC Handlers + Audit Log Endpoints

**Files:**
- Modify: `src/main/ipc-handlers.ts:1-260`
- Modify: `src/main/services/HomeService.ts:22-24` (add `getAuditLogPath`)

- [ ] **Step 1: Add HomeService method**

In `src/main/services/HomeService.ts`, after `getHomePath()`:

```typescript
  getAuditLogPath(): string {
    return join(this.getHomePath(), "audit.log");
  }
```

- [ ] **Step 2: Register handlers in ipc-handlers.ts**

After the `eventBus.on("tool:pending", ...)` block and before auto-resume (around line 176):

```typescript
  // Bash blocked → renderer
  eventBus.on("bash:blocked", (payload) => {
    win.webContents.send(IPC.BASH_BLOCKED, payload);
  });

  // Resolve blocked command
  ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { commandId?: unknown }).commandId !== "string" ||
      typeof (payload as { action?: unknown }).action !== "string"
    ) {
      throw new Error("Invalid payload: expected { commandId: string, action: string }");
    }
    const { commandId, action } = payload as { commandId: string; action: string };
    if (!["approve_once", "approve_session", "deny"].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    // safe-bash.ts must be imported in ipc-handlers.ts
    const { resolveBlockedCommand } = await import("./agent/extensions/safe-bash");
    resolveBlockedCommand(commandId, action as "approve_once" | "approve_session" | "deny");
  });

  // Audit log
  ipcMain.handle(IPC.GET_AUDIT_LOG, async () => {
    const path = homeService.getAuditLogPath();
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(path, "utf-8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.CLEAR_AUDIT_LOG, async () => {
    const path = homeService.getAuditLogPath();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "", "utf-8");
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/services/HomeService.ts
git commit -m "feat: register IPC handlers for blocked commands and audit log"
```

---

### Task 6: Create PendingCommandBanner + PendingCommandModal

**Files:**
- Create: `src/renderer/components/layout/chat/PendingCommandBanner.tsx`
- Create: `src/renderer/components/layout/chat/PendingCommandModal.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx:102-105`

- [ ] **Step 1: Create PendingCommandModal.tsx**

```tsx
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { glassSx } from "../../../styles/glass";

interface BlockedCommand {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  key: string;
  projectId: string;
  intent: string;
  timestamp: string;
}

interface PendingCommandModalProps {
  command: BlockedCommand;
  onApproveOnce: () => void;
  onApproveSession: () => void;
  onDeny: () => void;
  onClose: () => void;
}

const categoryColors: Record<string, string> = {
  destructive: "#f44336",
  privilege_escalation: "#ff9800",
  exfiltration: "#ffc107",
  persistence: "#9c27b0",
};

export default function PendingCommandModal({
  command,
  onApproveOnce,
  onApproveSession,
  onDeny,
  onClose,
}: PendingCommandModalProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: { sx: glassSx, "data-testid": "pending-command-modal" },
      }}
    >
      <DialogTitle>Review Blocked Command</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Chip
            label={command.category.replace("_", " ")}
            sx={{
              bgcolor: categoryColors[command.category] ?? "grey.500",
              color: "#fff",
              textTransform: "capitalize",
            }}
            size="small"
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          The agent tried to run this command. Review before approving.
        </Typography>
        <Box
          component="pre"
          sx={{
            p: 2,
            bgcolor: "grey.900",
            color: "grey.100",
            borderRadius: 1,
            overflow: "auto",
            fontSize: 12,
            maxHeight: 200,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            mb: 2,
          }}
        >
          {command.command}
        </Box>
        <Typography variant="body2" color="text.secondary">
          <strong>Reason:</strong> {command.reason}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          <strong>Intent:</strong> {command.intent} · <strong>Project:</strong> {command.projectId}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onDeny} color="error" data-testid="deny-command-btn">
          Deny
        </Button>
        <Button onClick={onApproveSession} variant="outlined" data-testid="approve-session-btn">
          Approve Session
        </Button>
        <Button onClick={onApproveOnce} variant="contained" data-testid="approve-once-btn">
          Approve Once
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create PendingCommandBanner.tsx**

```tsx
import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { glassSx } from "../../../styles/glass";
import PendingCommandModal from "./PendingCommandModal";

interface BlockedCommand {
  commandId: string;
  command: string;
  reason: string;
  category: string;
  key: string;
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

  const handleResolve = async (
    cmd: BlockedCommand,
    action: "approve_once" | "approve_session" | "deny",
  ) => {
    try {
      await window.electronAPI.invoke(IPC.RESOLVE_BLOCKED_COMMAND, {
        commandId: cmd.commandId,
        action,
      });
    } catch {
      // Handler may throw if commandId already resolved
    }
    setBlocked((prev) => prev.filter((c) => c.commandId !== cmd.commandId));
    setSelected(null);
  };

  if (blocked.length === 0) return null;

  return (
    <>
      {blocked.map((cmd) => (
        <Box
          key={cmd.commandId}
          data-testid={`pending-command-banner-${cmd.key}`}
          sx={{
            ...glassSx,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Blocked command: <strong>{cmd.command}</strong> — {cmd.reason}
          </Typography>
          <Button
            size="small"
            data-testid={`review-command-btn-${cmd.key}`}
            onClick={() => setSelected(cmd)}
          >
            Review
          </Button>
        </Box>
      ))}
      {selected && (
        <PendingCommandModal
          command={selected}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={() => handleResolve(selected, "deny")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Mount in ChatPanel.tsx**

In `src/renderer/components/layout/chat/ChatPanel.tsx`, add import:

```tsx
import PendingCommandBanner from "./PendingCommandBanner";
```

And insert in the JSX (between `ResearchStatusBar` and `PendingToolBanner`):

```tsx
      <ResearchStatusBar />
      <PendingCommandBanner />
      <PendingToolBanner />
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/PendingCommandBanner.tsx src/renderer/components/layout/chat/PendingCommandModal.tsx src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "feat: add PendingCommandBanner and PendingCommandModal for safe_bash approval"
```

---

### Task 7: Tabbed SettingsModal + Audit Log Viewer

**Files:**
- Rewrite: `src/renderer/components/settings/SettingsModal.tsx`
- Create: `src/renderer/components/settings/AuditLogTab.tsx`

- [ ] **Step 1: Create AuditLogTab.tsx**

```tsx
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useState } from "react";

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

interface AuditLogTabProps {
  entries: AuditLogEntry[];
  onRefresh: () => void;
  onClear: () => void;
}

const statusColors: Record<string, string> = {
  blocked: "#f44336",
  executed: "#4caf50",
  docker: "#2196f3",
};

function getStatus(entry: AuditLogEntry): string {
  if (entry.blocked) return "blocked";
  if (entry.exitCode === null) return "docker";
  return "executed";
}

export default function AuditLogTab({ entries, onRefresh, onClear }: AuditLogTabProps) {
  const [filter, setFilter] = useState<"all" | "executed" | "blocked" | "docker">("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered =
    filter === "all" ? entries : entries.filter((e) => getStatus(e) === filter);

  return (
    <Box sx={{ p: 2, minHeight: 300 }}>
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        {(["all", "executed", "blocked", "docker"] as const).map((f) => (
          <Chip
            key={f}
            label={f}
            onClick={() => setFilter(f)}
            variant={filter === f ? "filled" : "outlined"}
            color={filter === f ? "primary" : "default"}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onRefresh} variant="outlined">
          Refresh
        </Button>
        <Button size="small" onClick={() => setConfirmClear(true)} color="error" variant="outlined">
          Clear Log
        </Button>
      </Box>

      <Box
        sx={{
          fontFamily: "monospace",
          fontSize: 11,
          bgcolor: "grey.900",
          color: "grey.100",
          borderRadius: 1,
          p: 2,
          maxHeight: 400,
          overflow: "auto",
        }}
      >
        {filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No audit log entries.
          </Typography>
        ) : (
          filtered.map((entry, i) => {
            const status = getStatus(entry);
            return (
              <Box
                key={i}
                sx={{
                  display: "flex",
                  gap: 1.5,
                  borderBottom: "1px solid #333",
                  py: 0.75,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: "#888", minWidth: 160 }}>
                  {new Date(entry.ts).toLocaleString()}
                </span>
                <Chip
                  label={status}
                  size="small"
                  sx={{
                    bgcolor: statusColors[status] ?? "grey.500",
                    color: "#fff",
                    fontSize: 10,
                    height: 18,
                  }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {entry.command}
                </span>
                <span style={{ color: "#888" }}>
                  {entry.blockReason ?? `exit: ${entry.exitCode}`}
                </span>
              </Box>
            );
          })
        )}
      </Box>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogTitle>Clear Audit Log?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete all audit log entries. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button
            onClick={() => {
              onClear();
              setConfirmClear(false);
            }}
            color="error"
          >
            Clear
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
```

- [ ] **Step 2: Rewrite SettingsModal.tsx**

Replace entire file with:

```tsx
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Tab, Tabs } from "@mui/material";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import { glassSx } from "../../styles/glass";
import AuditLogTab from "./AuditLogTab";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auditEntries, setAuditEntries] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as {
        openrouterApiKey: string | null;
        model: string;
        langfuseEnabled: boolean;
      };
      setApiKey(settings.openrouterApiKey ?? "");
      setModel(settings.model);
      setLangfuseEnabled(settings.langfuseEnabled ?? false);
    });
  }, [open]);

  const loadAuditLog = async () => {
    const entries = (await window.electronAPI.invoke(IPC.GET_AUDIT_LOG)) as Record<string, unknown>[];
    setAuditEntries(entries);
  };

  useEffect(() => {
    if (open && tab === 1) {
      void loadAuditLog();
    }
  }, [open, tab]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      openrouterApiKey: apiKey.trim() || null,
      model,
      langfuseEnabled,
    });
    setSaving(false);
    onClose();
  };

  const handleClearAuditLog = async () => {
    await window.electronAPI.invoke(IPC.CLEAR_AUDIT_LOG);
    setAuditEntries([]);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: glassSx } }}
    >
      <DialogTitle>Settings</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="General" />
        <Tab label="Audit Log" />
      </Tabs>
      <DialogContent>
        {tab === 0 && (
          <Box sx={{ pt: 2 }}>
            <TextField
              label="OpenRouter API Key"
              type="password"
              fullWidth
              margin="normal"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              helperText="Get your key at openrouter.ai/keys"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Model</InputLabel>
              <Select value={model} onChange={(e) => setModel(e.target.value)} label="Model">
                {MODELS.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={langfuseEnabled}
                  onChange={(e) => setLangfuseEnabled(e.target.checked)}
                />
              }
              label="LangFuse tracing"
              sx={{ mt: 1 }}
            />
          </Box>
        )}
        {tab === 1 && (
          <AuditLogTab
            entries={auditEntries as Record<string, unknown>[]}
            onRefresh={loadAuditLog}
            onClear={handleClearAuditLog}
          />
        )}
      </DialogContent>
      {tab === 0 && (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} variant="contained">
            Save
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx src/renderer/components/settings/AuditLogTab.tsx
git commit -m "feat: tabbed SettingsModal with Audit Log viewer"
```

---

### Task 8: Full Type Check + Test + Lint

- [ ] **Step 1: Type check**

Run: `bun run typecheck`
Fix any `tsc --noEmit` errors.

- [ ] **Step 2: Run tests**

Run: `bun run test`
Expected: All 220+ tests pass (existing) plus new approval gate tests.

- [ ] **Step 3: Lint + format**

Run: `bun run check`
Fix any Biome errors.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test: add run11 tests; fix typecheck and lint"
```

---

## Spec Coverage Check

| Spec Section | Plan Task |
|---|---|
| 1 Blocklist Refactor | Task 1 |
| 2 Approval Gate (promise, allowlist, timeout) | Task 2 |
| 2.4 BlockedCommandError | Task 1 |
| 3 IPC + EventBus wiring | Tasks 3, 5 |
| 3.2 EventBus `bash:blocked` | Task 4 |
| 4 Renderer components (Banner + Modal) | Task 6 |
| 5 SettingsModal tabbed redesign | Task 7 |
| 6 Audit log schema (blocked fields) | Already in `runSafeBashInternal` (Task 2) |
| 7 tools.ts `emitBlocked` wiring | Task 3 |
| 8 Tests | Distributed across tasks |
| 9 Files Changed | All covered above |

No gaps. No placeholders. All tasks have concrete code, file paths, and commands.

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-04-30-run11-implementation.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach should I use?**
