# Pre-Finalization Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 49 code review issues (7 critical, 12 high, 14 medium, 16 low) across 6 sequential batches before finalizing the codebase.

**Architecture:** Sequential batches — each batch is self-contained with typecheck/lint/test gates. No batch starts before previous passes. Structural changes (Batch 2-3) enable DRY work (Batch 4). Agent decoupling (Batch 5) depends on EventBus wiring from earlier batches.

**Tech Stack:** TypeScript strict, Electron, React 19 + MUI v9, TSyringe DI, Biome, Vitest, Bun

---

## Batch 1 — Critical Bugs (C1-C4)

### Task 1.1: C1 — Register AllowlistService as singleton, inject into PathJail

**Files:**
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/agent/path-jail.ts`
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/ipc/command-handlers.ts`
- Modify: `src/main/ipc/artifact-handlers.ts`

- [ ] **Step 1: Register AllowlistService singleton in bootstrap.ts**

In `src/main/bootstrap.ts`, add import:
```ts
import { AllowlistService } from "./services/AllowlistService";
```
Add after other singleton registrations (after `OutputNotificationService`):
```ts
appContainer.registerSingleton(AllowlistService);
```

- [ ] **Step 2: Add AllowlistService to PathJail constructor**

In `src/main/agent/path-jail.ts`, modify constructor:
```ts
import { AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";

export class PathJail {
  // ... existing private fields ...

  constructor(
    readonly projectId: string,
    folderPath: string | null,
    projectName: string,
    private readonly allowlistService: AllowlistService,
  ) {
    // ... existing body unchanged ...
  }
```

Remove the import of `AllowlistService` from the `validate` method body and replace line 64:
```ts
// Delete: const allowlistService = new AllowlistService();
// Replace with:
const result = this.allowlistService.isAllowed(this.projectId, resolved, mode, [
  ...readWriteZones,
  ...readOnlyZones,
]);
```

- [ ] **Step 3: Update PathJail instantiation in ResearchService**

In `src/main/services/ResearchService.ts`, add constructor injection:
```ts
import { AllowlistService } from "./AllowlistService";

constructor(
  @inject(EventBus) private readonly eventBus: EventBus,
  @inject(SettingsService) private readonly settingsService: SettingsService,
  @inject(HomeService) private readonly homeService: HomeService,
  @inject(AllowlistService) private readonly allowlistService: AllowlistService,
) {}
```

At line 264, change:
```ts
const jail = new PathJail(config.projectId, config.folderPath, config.projectName);
```
To:
```ts
const jail = new PathJail(config.projectId, config.folderPath, config.projectName, this.allowlistService);
```

- [ ] **Step 4: Update PathJail instantiation in artifact-handlers.ts**

In `src/main/ipc/artifact-handlers.ts`, where `PathJail` is constructed (2 sites at lines 62 and 171 and 231), resolve AllowlistService from container and pass it:
```ts
const allowlistService = container.resolve(AllowlistService);
const jail = new PathJail(projectId, folderPath, projectName, allowlistService);
```

- [ ] **Step 5: Update PathJail instantiation in command-handlers.ts**

In `src/main/ipc/command-handlers.ts`, find the PathJail construction site(s), resolve AllowlistService and pass it.

- [ ] **Step 6: Typecheck and test**

```bash
bun run typecheck && bun run check && bun run test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: inject AllowlistService singleton into PathJail (C1)

Session-level path approvals now survive across validate() calls.
AllowlistService registered as singleton in DI container.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.2: C2 — Replace safe-bash regex blocklist with binary allowlist

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts`

- [ ] **Step 1: Define ALLOWED_BINARIES and SHELL_METACHARS**

In `src/main/agent/extensions/safe-bash.ts`, replace the BLOCKLIST array (lines 12-73) with:

```ts
const ALLOWED_BINARIES = new Set([
  "ls", "cat", "grep", "find", "head", "tail", "wc", "sort", "uniq",
  "mkdir", "touch", "cp", "mv", "ln", "echo", "date", "which",
  "git", "node", "python3", "python", "bun", "npm", "npx",
  "sed", "awk", "cut", "tr", "tee", "diff", "xargs", "basename", "dirname",
  "realpath", "readlink", "file", "stat", "du", "df", "chmod", "chown",
  "tar", "gzip", "gunzip", "zip", "unzip",
]);

const SHELL_METACHARS = /[;|&`$(){}[\]#!~*?\\]/;
```

- [ ] **Step 2: Replace checkBlocklist with checkAllowedBinaries**

Replace the `checkBlocklist` function with:

```ts
export interface BlockedResult {
  key: string;
  reason: string;
  category: "destructive" | "privilege_escalation" | "exfiltration" | "persistence";
}

export function checkCommand(command: string): BlockedResult | null {
  const trimmed = command.trim();

  // Block shell metacharacters used for chaining/escaping
  if (SHELL_METACHARS.test(trimmed)) {
    // Allow harmless metacharacters in safe contexts: *, ?, ! inside quotes
    // Simple check: if the command contains unquoted ; | & $(
    if (/[;|&]/.test(trimmed.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ""))) {
      return {
        key: "shell_metachar",
        reason: "Command chaining (;, |, &&, ||) is not allowed.",
        category: "persistence",
      };
    }
    if (trimmed.includes("$(") || trimmed.includes("`")) {
      return {
        key: "command_substitution",
        reason: "Command substitution is not allowed.",
        category: "persistence",
      };
    }
  }

  // Block dangerous commands regardless of allowlist
  const dangerousCommands = [
    { pattern: /\bsudo\b/, key: "sudo", reason: "Privilege escalation.", category: "privilege_escalation" as const },
    { pattern: /\bsu\b/, key: "su", reason: "Privilege escalation.", category: "privilege_escalation" as const },
    { pattern: /\bmkfs\b/, key: "mkfs", reason: "Filesystem formatting.", category: "destructive" as const },
    { pattern: /\bdd\b/, key: "dd", reason: "Raw disk I/O.", category: "destructive" as const },
    { pattern: /\bcurl\b/, key: "curl", reason: "Network outbound. Use fetch_url instead.", category: "exfiltration" as const },
    { pattern: /\bwget\b/, key: "wget", reason: "Network outbound. Use fetch_url instead.", category: "exfiltration" as const },
    { pattern: /\beval\b/, key: "eval", reason: "Dynamic code execution.", category: "persistence" as const },
  ];

  for (const d of dangerousCommands) {
    if (d.pattern.test(trimmed)) {
      return { key: d.key, reason: d.reason, category: d.category };
    }
  }

  // Extract first binary word (skip leading variable assignments like KEY=val)
  const firstWord = trimmed.replace(/^\s*\w+=\S+\s+/, "").split(/\s+/)[0];
  if (!firstWord) return null;

  // Strip path prefix: /usr/bin/git → git
  const binary = firstWord.split("/").pop()!;

  if (!ALLOWED_BINARIES.has(binary)) {
    return {
      key: "unknown_binary",
      reason: `Binary "${binary}" is not in the allowed list.`,
      category: "persistence",
    };
  }

  return null;
}
```

- [ ] **Step 3: Update BlockedCommandError and runSafeBash to use new types**

Update `BlockedCommandError` to accept `BlockedResult`:

```ts
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

Update `runSafeBash` to use `checkCommand`:
```ts
export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const blocked = checkCommand(opts.command);

  if (!blocked) {
    return runSafeBashInternal(opts);
  }

  if (getProjectAllowlist(opts.projectId).has(hashCommand(opts.command))) {
    return runSafeBashInternal(opts);
  }

  if (opts.emitBlocked) {
    return enterApprovalGate(opts, blocked);
  }

  throw new BlockedCommandError(`Blocked: ${blocked.reason}`, undefined, blocked.category);
}
```

Update `enterApprovalGate` parameter type from `BlocklistEntry` to `BlockedResult`:
```ts
function enterApprovalGate(opts: SafeBashOptions, blocked: BlockedResult): Promise<SafeBashResult> {
  return new Promise<SafeBashResult>((resolve, reject) => {
    const commandId = randomUUID();
    const timer = setTimeout(() => {
      blockedPromises.delete(commandId);
      reject(new BlockedCommandError(`Approval timed out. ${blocked.reason}`, commandId, blocked.category));
    }, 300_000);

    blockedPromises.set(commandId, {
      commandId,
      options: opts,
      blocklistEntry: blocked,
      resolve,
      reject,
      timer,
    });

    if (opts.emitBlocked) {
      opts.emitBlocked({
        commandId,
        command: opts.command,
        reason: blocked.reason,
        category: blocked.category,
        key: blocked.key,
        projectId: opts.projectId,
        intent: opts.intent,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
```

Update `BlockedCommandPromise.blocklistEntry` type from `BlocklistEntry` to `BlockedResult`.

Remove `BlocklistEntry` interface entirely.

- [ ] **Step 4: Update resolveBlockedCommand**

The `blocklistEntry` field is now `BlockedResult` — update the type used inside the function. The field name `blocklistEntry` stays as-is for minimal diff.

- [ ] **Step 5: Update safe-bash.test.ts**

In `src/main/agent/extensions/safe-bash.test.ts`, update tests to use new `checkCommand` instead of `checkBlocklist`, update test cases for allowlist behavior.

- [ ] **Step 6: Typecheck and test**

```bash
bun run typecheck && bun run check && bun run test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: replace safe-bash regex blocklist with binary allowlist (C2)

Shell metachar bypass vectors eliminated. Only whitelisted binaries
allowed. Dangerous commands (sudo, curl, wget, eval) still blocked.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.3: C3 — Walk path components to prevent symlink escape

**Files:**
- Modify: `src/main/agent/path-jail.ts`

- [ ] **Step 1: Add component-level symlink checking**

In `src/main/agent/path-jail.ts`, add import:
```ts
import { realpathSync } from "node:fs";
```

Replace the `validate` method's `inZone` check (lines 50-51) with component-walking:

```ts
validate(inputPath: string, mode: "read" | "write"): string {
  const resolved = resolve(normalize(inputPath));

  // Walk each path component with realpathSync to catch symlink escapes.
  // The final (terminal) component is NOT resolved — it may not exist yet for writes.
  const components = resolved.split("/").filter(Boolean);
  const isAbsolute = resolved.startsWith("/");

  let walked = isAbsolute ? "/" : "";
  for (let i = 0; i < components.length - 1; i++) {
    walked = join(walked, components[i]);
    let real: string;
    try {
      real = realpathSync(walked);
    } catch {
      // Path doesn't exist yet — trust the intended path
      real = walked;
    }
    // Check that the real path is within allowed zones for this intermediate component
    if (!this.isInAnyZone(real)) {
      throw new Error(
        `Path component "${components[i]}" at "${walked}" resolves outside allowed zones (resolved: ${real}). Symlinks in parent directories are not permitted.`,
      );
    }
  }

  // Now check the resolved full path (terminal component resolved)
  let finalResolved: string;
  try {
    finalResolved = realpathSync(resolved);
  } catch {
    finalResolved = resolved;
  }

  if (this.isInZone(finalResolved, this.readWriteZones)) return finalResolved;

  if (this.isInZone(finalResolved, this.readOnlyZones)) {
    if (mode === "write") {
      throw new Error(
        `Path "${finalResolved}" is in a read-only zone (skills directory). Use a workspace or project folder path instead.`,
      );
    }
    return finalResolved;
  }

  const result = this.allowlistService.isAllowed(this.projectId, finalResolved, mode, [
    ...this.readWriteZones,
    ...this.readOnlyZones,
  ]);
  if (result.allowed) return finalResolved;
  if (result.needsApproval) {
    throw new ApprovalRequiredError(finalResolved, mode);
  }

  throw new Error(
    `Path "${finalResolved}" is not allowed. Permitted zones: workspace (${this.workspace}), project folder${this.projectFolder ? ` (${this.projectFolder})` : " (none linked)"}, projects dir (${this.projectsDir}), skills directories.`,
  );
}

private get readWriteZones(): string[] {
  return [
    this.workspace,
    this.projectsDir,
    ...(this.projectFolder ? [this.projectFolder] : []),
  ];
}

private get readOnlyZones(): string[] {
  return [
    this.homeSkills,
    this.agentsSkills,
    ...(this.projectAgentsSkills ? [this.projectAgentsSkills] : []),
    ...(this.projectHomeSkills ? [this.projectHomeSkills] : []),
  ];
}

private isInZone(target: string, zones: string[]): boolean {
  return zones.some((z) => target.startsWith(`${z}/`) || target === z);
}

private isInAnyZone(target: string): boolean {
  return this.isInZone(target, this.readWriteZones) || this.isInZone(target, this.readOnlyZones);
}
```

- [ ] **Step 2: Update path-jail.test.ts**

Add test for symlink escape prevention:
```ts
test("rejects path with symlink in parent directory chain", () => {
  // Create a symlink inside jail pointing outside
  // symlink: jail/sym → /etc
  // path: jail/sym/passwd → should be rejected
});
```

- [ ] **Step 3: Typecheck and test**

```bash
bun run typecheck && bun run check && bun run test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: walk path components to prevent symlink escape (C3)

Each intermediate path component checked with realpathSync.
Non-terminal symlinks outside allowed zones rejected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1.4: C4 — Throw error when safeStorage unavailable

**Files:**
- Modify: `src/main/services/SettingsService.ts`

- [ ] **Step 1: Replace base64 fallback with error + dialog**

In `src/main/services/SettingsService.ts`, add import:
```ts
import { dialog } from "electron";
```

Replace `encryptApiKey` function (lines 65-72):
```ts
function encryptApiKey(key: string | null): string | undefined {
  if (key === null) return undefined;
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showErrorBox(
      "Encryption Unavailable",
      "Your system does not support secure credential storage. API keys cannot be saved.",
    );
    throw new Error("safeStorage unavailable — cannot securely store API keys");
  }
  return safeStorage.encryptString(key).toString("base64");
}
```

Replace `decryptApiKey` function (lines 74-81):
```ts
function decryptApiKey(encrypted: string | undefined): string | null {
  if (!encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showErrorBox(
      "Encryption Unavailable",
      "Your system does not support secure credential storage. Saved API keys cannot be decrypted.",
    );
    throw new Error("safeStorage unavailable — cannot decrypt stored API keys");
  }
  const buf = Buffer.from(encrypted, "base64");
  return safeStorage.decryptString(buf);
}
```

- [ ] **Step 2: Typecheck and test**

```bash
bun run typecheck && bun run check && bun run test
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: throw error when safeStorage unavailable (C4)

Replaced base64 fallback with dialog.showErrorBox + thrown error.
API keys never persisted without OS-level encryption.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Batch 2 — God Object Splits (C5-C7)

### Task 2.1: C5 — Extract TaskPersistenceService from HomeService

**Files:**
- Create: `src/main/services/TaskPersistenceService.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Create TaskPersistenceService**

```ts
import { eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import { z } from "zod/v4";
import type { DrizzleDB } from "../db/client";
import { tasks } from "../db/schema";
import { DB_TOKEN } from "../di/tokens";

export interface ResearchTask {
  taskId: string;
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
  startedAt: string;
}

const ResearchTaskSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  query: z.string(),
  folderPath: z.string().nullable(),
  startedAt: z.string(),
});

@injectable()
export class TaskPersistenceService {
  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async saveTask(task: ResearchTask): Promise<void> {
    await this.db
      .insert(tasks)
      .values({
        id: task.taskId,
        projectId: task.projectId,
        projectName: task.projectName,
        query: task.query,
        folderPath: task.folderPath,
        status: "in_progress",
        createdAt: new Date(task.startedAt),
        updatedAt: new Date(task.startedAt),
      })
      .onConflictDoNothing();
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.status, "in_progress"));
    return rows.map((r) => ({
      taskId: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      query: r.query,
      folderPath: r.folderPath,
      startedAt: new Date(r.createdAt).toISOString(),
    }));
  }

  async updateTaskStatus(
    taskId: string,
    status: "pending" | "in_progress" | "complete" | "failed",
    error?: string,
  ): Promise<void> {
    await this.db
      .update(tasks)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
  }

  async migrateTasksFromJson(dir: string): Promise<void> {
    const { readdir, readFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    let entries: string[] = [];
    try {
      entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    } catch {
      return;
    }
    for (const entry of entries) {
      try {
        const raw = await readFile(join(dir, entry), "utf-8");
        const parsed = JSON.parse(raw);
        const task = ResearchTaskSchema.parse(parsed);
        await this.saveTask(task);
        await unlink(join(dir, entry));
      } catch (err) {
        console.error(`[TaskPersistenceService] migrateTasksFromJson: skipping malformed file ${entry}:`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Update HomeService to delegate to TaskPersistenceService**

In `HomeService`, add import: `import { TaskPersistenceService } from "./TaskPersistenceService";`

Change constructor:
```ts
constructor(
  @inject(DB_TOKEN) private readonly db: DrizzleDB,
  @inject(TaskPersistenceService) private readonly taskPersistence: TaskPersistenceService,
) {}
```

Replace body of `saveTask`, `deleteTask`, `getInProgressTasks`, `updateTaskStatus`, `migrateTasksFromJson` with delegation calls.

Remove imports of `drizzle-orm`, `zod/v4`, `db/schema`, `db/client` types. Remove `ResearchTask` interface and `ResearchTaskSchema` (import from TaskPersistenceService).

- [ ] **Step 3: Register TaskPersistenceService in bootstrap.ts**

```ts
import { TaskPersistenceService } from "./services/TaskPersistenceService";
// Add: appContainer.registerSingleton(TaskPersistenceService);
```

- [ ] **Step 4: Typecheck and test**

```bash
bun run typecheck && bun run check && bun run test
```

- [ ] **Step 5: Commit**

---

### Task 2.2: C5 — Extract SkillManagementService from HomeService

**Files:**
- Create: `src/main/services/SkillManagementService.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Create SkillManagementService**

New file `src/main/services/SkillManagementService.ts` with: `getSkills`, `toggleSkill`, `deleteSkill`, `copyBuiltinSkillsIfNeeded` methods extracted from HomeService. Depends on `AGENT_HOME_PATH_TOKEN`.

- [ ] **Step 2: Update HomeService to delegate**

Inject `SkillManagementService`, delegate `getSkills`, `toggleSkill`, `deleteSkill`. Move `copyBuiltinSkillsIfNeeded` call in `ensureDirectories` to delegate. Move `ensureSkillFile` private method.

- [ ] **Step 3: Register in bootstrap**

- [ ] **Step 4: Typecheck and test, commit**

---

### Task 2.3: C5 — Extract ToolApprovalService from HomeService

**Files:**
- Create: `src/main/services/ToolApprovalService.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Create ToolApprovalService**

New file with: `savePendingTool`, `getPendingTools`, `approvePendingTool`, `rejectPendingTool`. Depends on `AGENT_HOME_PATH_TOKEN`.

- [ ] **Step 2: Update HomeService + register in bootstrap**

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 2.4: C6 — Extract CrystallizationService from ResearchService

**Files:**
- Create: `src/main/services/CrystallizationService.ts`
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Create CrystallizationService**

Extract `evaluateForCrystallization` and skill creation logic from `ResearchService` into `CrystallizationService`. Constructor injects `SettingsService`, `HomeService`, `ToolApprovalService`.

- [ ] **Step 2: Update ResearchService to inject and delegate**

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 2.5: C7 — Extract MemoryCompressionService from MemoryManager

**Files:**
- Create: `src/main/services/MemoryCompressionService.ts`
- Modify: `src/main/services/MemoryManager.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Create MemoryCompressionService**

Extract the 116-line `maybeCompress` method + `compressLocks` map. Constructor injects `SettingsService`, `AGENT_HOME_PATH_TOKEN`.

- [ ] **Step 2: Update MemoryManager to inject and delegate**

```ts
constructor(
  @inject(USER_DATA_PATH_TOKEN) userDataPath: string,
  @inject(SettingsService) private readonly settingsService: SettingsService,
  @inject(MemoryCompressionService) private readonly compressionService: MemoryCompressionService,
) {
  this.dbPath = join(userDataPath, "research-assistant.db");
}
```

In `save` method, replace `void this.maybeCompress(projectId, store)` with `void this.compressionService.compress(projectId, store)`.

Remove `maybeCompress` method and `compressLocks` map from MemoryManager.

- [ ] **Step 3: Typecheck and test, commit**

---

## Batch 3 — Dead Code Removal + DI Gaps (H2, H3, H5, H11, M2, M6)

### Task 3.1: H5 — Delete makeTool and all call sites

**Files:**
- Delete: `src/main/agent/tools/make-tool.ts`
- Modify: 10 files in `src/main/agent/tools/` (propose-tool.ts, memory-tools.ts, file-tools.ts, compress-tool.ts, safe-bash-tool.ts, orchestrator-tools.ts, artifact-tools.ts, docker-tool.ts, research-tools.ts, eval-tools.ts)

- [ ] **Step 1: Remove makeTool wrapper from all 10 call sites**

For each file, remove `import { makeTool } from "./make-tool";` and unwrap `makeTool({...})` → `{...}`.

- [ ] **Step 2: Delete make-tool.ts**

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 3.2: H2 — Register MemoryFileService as DI singleton

**Files:**
- Modify: `src/main/services/MemoryFileService.ts`
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/di/tokens.ts`

- [ ] **Step 1: Add tokens for MemoryFileService paths**

```ts
export const MEMORY_FILE_PATH_TOKEN: InjectionToken<string> = Symbol("memoryFilePath");
export const FALLBACK_MEMORY_PATH_TOKEN: InjectionToken<string> = Symbol("fallbackMemoryPath");
```

- [ ] **Step 2: Make MemoryFileService injectable**

Add `@injectable()` decorator. Constructor uses `@inject(MEMORY_FILE_PATH_TOKEN)` and `@inject(FALLBACK_MEMORY_PATH_TOKEN)`.

- [ ] **Step 3: Update bootstrap to register tokens + singleton**

Replace manual instantiation with:
```ts
appContainer.registerInstance(MEMORY_FILE_PATH_TOKEN, join(homePath, "app-memory"));
appContainer.registerInstance(FALLBACK_MEMORY_PATH_TOKEN, homePath);
appContainer.registerSingleton(MemoryFileService);
```

- [ ] **Step 4: Typecheck and test, commit**

---

### Task 3.3: H2 — Register SkillWatcherService as DI singleton

**Files:**
- Modify: `src/main/services/SkillWatcherService.ts`
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/di/tokens.ts`

- [ ] **Step 1: Add config token, make class injectable**

Add `SKILL_WATCHER_CONFIG_TOKEN` to tokens.ts. Make `SkillWatcherService` use `@injectable()` with constructor injection of config + `EventBus`.

- [ ] **Step 2: Update bootstrap**

Replace manual instantiation with `registerSingleton(SkillWatcherService)`.

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 3.4: H3 — Replace dynamic imports with top-level imports + DI

**Files:**
- Modify: `src/main/ipc/command-handlers.ts`
- Modify: `src/main/ipc/admin-handlers.ts`
- Modify: `src/main/ipc/artifact-handlers.ts`
- Modify: `src/main/ipc/settings-handlers.ts`

- [ ] **Step 1: Replace dynamic imports in each handler**

For `node:` built-ins → move to top-level static imports.
For app modules (`../paths`, `../agent/path-jail`, `../agent/extensions/safe-bash`, `../agent/model-provider`) → inject via constructor or receive from container parameter already passed to handler registration functions.

- [ ] **Step 2: Typecheck and test, commit**

---

### Task 3.5: H11 — Register MemoryManager against MEMORY_MANAGER_TOKEN

**Files:**
- Modify: `src/main/bootstrap.ts`
- Modify: All files injecting `MemoryManager` directly

- [ ] **Step 1: Change registration in bootstrap**

Replace `appContainer.registerSingleton(MemoryManager)` with:
```ts
appContainer.register(MEMORY_MANAGER_TOKEN, { useClass: MemoryManager });
```

- [ ] **Step 2: Update injection sites**

Find all `@inject(MemoryManager)` → `@inject(MEMORY_MANAGER_TOKEN)`. Type as `IMemoryManager`.

Check: `session.ts` (not using DI — manual construction, leave for now), `ResearchService.ts` (doesn't inject MemoryManager), `MessageService.ts`, `chat-handlers.ts`.

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 3.6: M2 + M6 — Delete MemorySummaryService and NotFoundError

**Files:**
- Delete: `src/main/services/MemorySummaryService.ts`
- Modify: `src/main/services/errors.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Delete MemorySummaryService**

Remove file. Remove import + registration from `bootstrap.ts`. Remove any test file.

- [ ] **Step 2: Delete NotFoundError from errors.ts**

Keep `NotImplementedError` (still used). Delete `NotFoundError` class (lines 1-6).

- [ ] **Step 3: Typecheck and test, commit**

---

## Batch 4 — DRY + Hardening (H1, H6-H9, H12, M1, M3-M5, M7-M14)

### Task 4.1: H1 — Add sandbox: true to webPreferences

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add sandbox: true**

At `src/main/index.ts:17`, add `sandbox: true`:
```ts
webPreferences: {
  preload: join(import.meta.dirname, "../preload/index.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
},
```

- [ ] **Step 2: Test all IPC paths**

```bash
bun run typecheck && bun run test
```

- [ ] **Step 3: Commit**

---

### Task 4.2: H6 — Extract BaseDrizzleRepository

**Files:**
- Create: `src/main/repositories/drizzle/BaseDrizzleRepository.ts`
- Modify: `DrizzleProjectRepository.ts`, `DrizzleMessageRepository.ts`, `DrizzleArtifactRepository.ts`
- Modify: `src/main/di/tokens.ts` (add CLOCK_TOKEN)

- [ ] **Step 1: Add CLOCK_TOKEN**

```ts
import type { MonotonicClock } from "../utils/time";
export const CLOCK_TOKEN: InjectionToken<MonotonicClock> = Symbol("MonotonicClock");
```

- [ ] **Step 2: Create BaseDrizzleRepository**

```ts
import { randomUUID } from "node:crypto";
import { inject, injectable } from "tsyringe";
import { CLOCK_TOKEN, DB_TOKEN } from "../../di/tokens";
import type { DrizzleDB } from "../../db/client";
import type { MonotonicClock } from "../../utils/time";

@injectable()
export abstract class BaseDrizzleRepository<TSelect, TInsert, TEntity> {
  constructor(
    @inject(DB_TOKEN) protected readonly db: DrizzleDB,
    @inject(CLOCK_TOKEN) protected readonly clock: MonotonicClock,
  ) {}

  protected abstract rowToEntity(row: TSelect): TEntity;
  protected id(): string { return randomUUID(); }
  protected now(): Date { return this.clock.now(); }
}
```

- [ ] **Step 3: Refactor 3 repositories to extend BaseDrizzleRepository**

Each repo removes: `MonotonicClock` field, `crypto.randomUUID()`, `this.clock.now()`. Uses `this.id()`, `this.now()` from base. Removes `@inject(DB_TOKEN)` from constructor, calls `super(db, clock)`.

- [ ] **Step 4: Register MonotonicClock as singleton in bootstrap**

```ts
import { MonotonicClock } from "./utils/time";
import { CLOCK_TOKEN } from "./di/tokens";
appContainer.registerSingleton(CLOCK_TOKEN, MonotonicClock);
```

Actually for TSyringe, registering a plain class as singleton:
```ts
appContainer.register(CLOCK_TOKEN, { useClass: MonotonicClock }).asSingleton();
```
Wait — `MonotonicClock` doesn't have `@injectable()`. Let me use a simpler approach:
```ts
appContainer.registerInstance(CLOCK_TOKEN, new MonotonicClock());
```

- [ ] **Step 5: Typecheck and test, commit**

---

### Task 4.3: H7 — Split SettingsModal with custom hooks

**Files:**
- Create: `src/renderer/hooks/useProviderSettings.ts`
- Create: `src/renderer/hooks/useAuditLog.ts`
- Create: `src/renderer/hooks/useSkillManager.ts`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Create hooks**

`useProviderSettings(provider)` — manages model, apiKey, host state + change handlers.
`useAuditLog()` — manages log entries fetch state.
`useSkillManager()` — manages skills list, toggle, delete.

- [ ] **Step 2: Refactor SettingsModal**

Replace 25+ useState calls with 3 hook calls. Modal owns `tab` + `open` only.

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 4.4: H8 — Convert SEND_MESSAGE to ipcMain.handle

**Files:**
- Modify: `src/main/ipc/chat-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/` (component calling sendMessage)

- [ ] **Step 1: Change main process handler**

Replace `ipcMain.on(IPC.SEND_MESSAGE, ...)` with `ipcMain.handle(IPC.SEND_MESSAGE, async (event, payload) => { ... })`. Add per-project mutex. Return `{ messageId: string }`.

- [ ] **Step 2: Update preload bridge**

Change `send(channel, ...args)` to `invoke(channel, ...args)` for SEND_MESSAGE.

- [ ] **Step 3: Update renderer caller**

Change fire-and-forget to `await window.electronAPI.sendMessage(payload)`.

- [ ] **Step 4: Typecheck and test, commit**

---

### Task 4.5: H9 — Route MemoryFileService through PathJail

**Files:**
- Modify: `src/main/services/MemoryFileService.ts`

- [ ] **Step 1: Add AllowlistService dependency**

Inject `AllowlistService`. Before `writeFile`, call `allowlistService.isAllowed(projectId, resolvedPath, "write", [])`. If `needsApproval`, emit via `EventBus`.

- [ ] **Step 2: Typecheck and test, commit**

---

### Task 4.6: H12 — Add Zod runtime validation at IPC push boundaries

**Files:**
- Create: `src/shared/ipc-guards.ts`
- Modify: 6 renderer components (App.tsx, ResearchStatusBar.tsx, PendingToolBanner.tsx, PendingPathBanner.tsx, PendingCommandBanner.tsx, FileExplorer.tsx, ArtifactViewer.tsx)

- [ ] **Step 1: Create ipc-guards.ts with Zod schemas**

Define Zod schemas for each IPC push payload type (ModelFallbackPayload, ResearchStatusUpdatePayload, ResearchCompletePayload, PendingTool, PathApprovalPayload, BlockedCommandPayload, FileNode). Each gets a `decode*` function that returns the typed object or null (logging on failure).

- [ ] **Step 2: Replace `as` casts with guard calls**

In each component, replace `data as Foo` with `decodeFoo(data)`, guard null result.

- [ ] **Step 3: Typecheck and test, commit**

---

### Task 4.7: M1, M3-M5, M7-M14 — DRY + medium fixes

**Files (M1):**
- Modify: `src/main/services/MemoryFileService.ts` — remove duplicate `toSlug`, import from context.ts

**Files (M3):**
- Create: `src/renderer/components/chat/GenericPendingApprovalBanner.tsx`
- Modify: `PendingCommandBanner.tsx`, `PendingPathBanner.tsx`, `PendingToolBanner.tsx` — extend generic

**Files (M4):**
- Create: `src/renderer/components/chat/ReviewDialog.tsx`
- Modify: `PendingCommandModal.tsx`, `PendingPathModal.tsx` — use ReviewDialog

**Files (M5):**
- Create: `src/renderer/components/settings/ModelAutocomplete.tsx`
- Modify: `ModelProviderTab.tsx` — use 3 instances

**Files (M8):**
- Modify: `src/main/db/migrate.ts` — check SQLITE_ERROR specifically

**Files (M9):**
- Modify: `src/main/ipc/parse-util.ts` — use z.ZodType<T>

**Files (M10):**
- Delete: `src/renderer/components/layout/ArtifactSection.tsx`
- Modify: `DetailsPanel.tsx` — use FileExplorer directly

**Files (M11):**
- Modify: `src/main/repositories/IArtifactRepository.ts` — add `findUnacknowledged`
- Modify: `DrizzleArtifactRepository.ts` — implement with WHERE filter
- Modify: `ArtifactService.ts` — call repo method

**Files (M12):**
- Modify: `worker-agent.ts` — change `zod` → `zod/v4`

**Files (M13):**
- Delete: `src/main/agent/tools/file-tools.test.ts` (co-located duplicate, keep `__tests__/` version)

**Files (M14):**
- Create: `src/main/services/index.ts`, `src/main/repositories/drizzle/index.ts`, `src/main/ipc/index.ts` — barrel exports

- [ ] **Step 1: Fix M1 (toSlug dedup)**
- [ ] **Step 2: Extract M3 GenericPendingApprovalBanner**
- [ ] **Step 3: Extract M4 ReviewDialog**
- [ ] **Step 4: Extract M5 ModelAutocomplete**
- [ ] **Step 5: Fix M7 (singleton clock — already done in Task 4.2)**
- [ ] **Step 6: Fix M8 (migrate.ts error swallowing)**
- [ ] **Step 7: Fix M9 (parseOrThrow typing)**
- [ ] **Step 8: Fix M10 (delete ArtifactSection)**
- [ ] **Step 9: Fix M11 (push filter to repo)**
- [ ] **Step 10: Fix M12 (standardize zod/v4)**
- [ ] **Step 11: Fix M13 (remove duplicate test)**
- [ ] **Step 12: Fix M14 (barrel exports)**
- [ ] **Step 13: Typecheck and test, commit**

---

## Batch 5 — Agent Decoupling (H4, H10)

### Task 5.1: H4 — AgentSession emits via EventBus instead of BrowserWindow

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/ipc/chat-handlers.ts`
- Modify: `src/shared/ipc-channels.ts` (add agent event types if needed)

- [ ] **Step 1: Remove BrowserWindow from AgentSession, add EventBus**

- Remove `win: BrowserWindow` from `AgentSessionOptions`
- Make `eventBus: EventBus` required (not optional)
- Replace `this.win.webContents.send(IPC.MESSAGE_CHUNK, ...)` with `this.eventBus.emit({ type: "agent:chunk", payload: {...} })`
- Replace `this.win.webContents.send(IPC.MESSAGE_DONE, ...)` with `this.eventBus.emit({ type: "agent:done", payload: {...} })`
- Remove `BrowserWindow` import

- [ ] **Step 2: Wire IPC layer to bridge EventBus → webContents**

In `chat-handlers.ts`, after creating AgentSession, subscribe to `agent:chunk` and `agent:done` events on EventBus, forward to `win.webContents.send`.

- [ ] **Step 3: Update all AgentSession construction sites**

- [ ] **Step 4: Typecheck and test, commit**

---

### Task 5.2: H10 — Add Langfuse warning

**Files:**
- Modify: `src/main/agent/model-factory.ts`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add warning text in SettingsModal next to langfuse toggle**

```tsx
<Typography variant="caption" color="text.secondary">
  Tracing data is routed through cloud.langfuse.com. Your prompts and responses will be visible to a third-party service.
</Typography>
```

- [ ] **Step 2: Add warning log in model-factory.ts when Langfuse enabled**

```ts
if (langfuseEnabled) {
  console.warn("[model-factory] Langfuse tracing enabled — data routed through cloud.langfuse.com");
}
```

- [ ] **Step 3: Typecheck and test, commit**

---

## Batch 6 — Low Polish (L1-L16)

### Task 6.1: L1-L16 — Polish fixes (single task, scattered changes)

**Files:** Various (see each sub-step)

- [ ] **Step 1: L1 — Ollama health check**

In `SettingsService.ts`, add startup health check for Ollama host on settings load. If unreachable, log warning.

- [ ] **Step 2: L2 — Log frontmatter parse failures**

In `src/main/utils/frontmatter.ts:13`, add `console.warn("Failed to parse frontmatter YAML:", err)` in catch block.

- [ ] **Step 3: L3 — Replace emoji with MUI icons**

In `FileExplorer.tsx:50`, replace `"📂"`, `"📁"`, `"📄"` with `<FolderOpenIcon />`, `<FolderIcon />`, `<InsertDriveFileIcon />`.

- [ ] **Step 4: L4 — Merge vite-env.d.ts into electron.d.ts**

Move `/// <reference types="vite/client" />` into `electron.d.ts`. Delete `vite-env.d.ts`.

- [ ] **Step 5: L5 — Validate ELECTRON_RENDERER_URL, add CSP**

In `index.ts`, validate URL before loading. Add CSP header in production.

- [ ] **Step 6: L6 — Rate limiting + message caps**

Add 1s per-project throttle in chat-handlers. Cap content at 100KB.

- [ ] **Step 7: L7 — Document NTP drift**

Add comment in `time.ts`.

- [ ] **Step 8: L8 — Max project name length**

Add `.max(100)` to `CreateProjectSchema.name` in `ipc-validation.ts`.

- [ ] **Step 9: L9 — Inline glass.ts into theme.ts**

Move styles, delete `glass.ts`.

- [ ] **Step 10: L10 — Fix PendingToolModal PaperProps**

Use `data-testid` on Dialog directly.

- [ ] **Step 11: L11 — Document startup tasks intent**

Add comment: "Intentionally non-blocking — startup tasks run in background."

- [ ] **Step 12: L12 — Remove unused _projectId param**

From `buildSystemContext` in `context.ts:42`.

- [ ] **Step 13: L13 — Define DEFAULT_OPENROUTER_MODEL**

In `src/shared/constants.ts`. Import in 4 files.

- [ ] **Step 14: L14 — DuckDuckGo Instant Answer API**

Replace HTML scraping in `web-search.ts`.

- [ ] **Step 15: L15 — Ollama remote host warning**

In model-provider.ts, warn if host is not localhost.

- [ ] **Step 16: L16 — Remove blocklist from tool description**

In `safe-bash-tool.ts:17-18`, replace:
```ts
description: "Execute a bash command in the project workspace. Always state your intent. Potentially dangerous commands require approval.",
```

- [ ] **Step 17: Typecheck and test, commit**

---

## Execution Order

1. Batch 1 (Tasks 1.1-1.4) — Critical bugs. Run sequentially within batch.
2. Batch 2 (Tasks 2.1-2.5) — God object splits. Run sequentially.
3. Batch 3 (Tasks 3.1-3.6) — Dead code + DI gaps. Task 3.6 can run parallel with 3.1-3.5.
4. Batch 4 (Tasks 4.1-4.7) — DRY + hardening. Tasks 4.1, 4.5, 4.7 can parallel.
5. Batch 5 (Tasks 5.1-5.2) — Agent decoupling.
6. Batch 6 (Task 6.1) — Polish.

Gate after each batch: `bun run typecheck && bun run check && bun run test`
