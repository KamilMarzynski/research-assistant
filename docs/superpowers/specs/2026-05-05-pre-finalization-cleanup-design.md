# Pre-Finalization Code Review Cleanup — Design

> Source: "04 Resources/AI/Research Assistant - Pre-Finalization Code Review 2026-05-05.md" in Obsidian
> Scope: 49 issues across 159 TS/TSX files — 7 critical, 12 high, 14 medium, 16 low

## Approach

6 sequential batches, each a self-contained commit. Bugs first, then structure, then polish. Each batch preserves existing public APIs — no breaking changes to IPC contract or component props.

---

## Batch 1 — Critical Bugs (C1-C4)

### C1: Inject AllowlistService into PathJail

**Problem:** `path-jail.ts:64` calls `new AllowlistService()` every `validate()` call. Fresh instance = empty `sessionAllowlists`. Session-level path approvals from `command-handlers.ts` populate different instance, silently fail.

**Fix:**
- Add `AllowlistService` as constructor parameter to `PathJail`
- Register `AllowlistService` as singleton in `bootstrap.ts`
- Update 2 call sites (`ResearchService.ts:264`, `command-handlers.ts`) to receive injected service
- `ResearchService` already uses DI — pass through constructor
- `command-handlers.ts` — resolve from container or receive via handler factory

### C2: Replace Safe-Bash Regex Blocklist with Allowlist

**Problem:** `safe-bash.ts:170` regex blocklist has multiple bypass vectors: ANSI-C quoting (`$'\163\165\144\157'` produces `sudo`), `chmod 755` evades `chmod\s+\+x`, `rm -rf /?` evades `rm -rf /*`, environment variable expansion, command chaining.

**Fix:**
- Define `ALLOWED_BINARIES`: Set of permitted binary names (ls, cat, grep, find, head, tail, wc, sort, uniq, mkdir, touch, cp, mv, ln, echo, date, which, git, node, python3, python, bun)
- Block shell metacharacters at syntax level: `|`, `;`, `&&`, `||`, backticks, `$(` before binary check
- Parse first word of command (after variable expansion stripping), check against allowlist
- Keep `BlockedCommandError` + approval gate pattern intact — only change what gets blocked
- Docker sandbox route deferred to Run 8

### C3: Symlink Escape Prevention

**Problem:** `path-jail.ts:36,50-51` — `resolve()` only resolves final path's symlinks. Parent directory symlinks not checked. Agent-created symlinks inside jail bypass jail entirely.

**Fix:**
- Split input path into components (`/a/b/c` → `["/", "/a", "/a/b", "/a/b/c"]`)
- Call `fs.realpathSync` on each component
- If any intermediate component resolves outside allowed zones → reject
- Non-terminal symlink = rejection even if final target inside jail

### C4: API Key Encryption — Error on safeStorage Unavailable

**Problem:** `SettingsService.ts:70-71` — when `safeStorage.isEncryptionAvailable()` returns false, falls back to base64 (plain text). User gets only `console.warn`.

**Fix:**
- Throw `new Error("safeStorage unavailable — cannot securely store API keys")`
- Before throw, call `dialog.showErrorBox("Encryption Unavailable", "Your system does not support secure credential storage. API keys cannot be saved.")`
- Remove base64 fallback path entirely from `encryptApiKey` and `decryptApiKey`

---

## Batch 2 — God Object Splits (C5-C7)

### C5: Split HomeService

**Extract TaskPersistenceService:**
- `saveTask`, `deleteTask`, `getInProgressTasks`, `updateTaskStatus`, `migrateTasksFromJson`
- Depends on: `DB_TOKEN`

**Extract SkillManagementService:**
- `getSkills`, `toggleSkill`, `deleteSkill`, `copyBuiltinSkillsIfNeeded`
- Depends on: `AGENT_HOME_PATH_TOKEN`

**Extract ToolApprovalService:**
- `savePendingTool`, `getPendingTools`, `approvePendingTool`, `rejectPendingTool`
- Depends on: `AGENT_HOME_PATH_TOKEN`

**HomeService retains:**
- `getHomePath`, `getAgentsPath`, `ensureDirectories`, `isFirstRun`, `ensureWorkspaceForProject`
- `ensureDirectories` delegates to `SkillManagementService.copyBuiltinSkillsIfNeeded`

### C6: Extract CrystallizationService from ResearchService

**CrystallizationService:**
- `evaluateForCrystallization(query, projectId, projectName, folderPath)` — the LLM call
- `createSkillFromResearch(skillName, skillDescription)` — skill file creation → delegates to `ToolApprovalService`
- Depends on: `SettingsService`, `HomeService`, `ToolApprovalService`

**ResearchService retains:**
- `startResearch`, `startOrchestratedResearch`, `_runResearch`, `cleanupOldWorkspaces`, `cleanupOldWorkspaces`
- Injects `CrystallizationService`, calls it in agent_end handler

### C7: Extract MemoryCompressionService

**MemoryCompressionService:**
- `compress(projectId, store)` — the 116-line `maybeCompress` method
- Depends on: `SettingsService`, `AGENT_HOME_PATH_TOKEN`

**MemoryManager retains:**
- `buildContext`, `save`, store initialization
- Calls `this.compression.compress(projectId, store)` from `save`

---

## Batch 3 — Dead Code Removal + DI Gaps (H2, H3, H5, H11, M2, M6)

### H5: Delete makeTool
- Remove `src/main/agent/tools/make-tool.ts`
- Find 11 call sites: `grep -r "makeTool" src/`
- Remove `makeTool(...)` wrapper, export tool object directly
- `AgentTool<TParams, TDetails>` return type annotations already provide type safety

### H2: DI Registration for Bootstrap Services
- `MemoryFileService`: add `@injectable()`, register singleton with constructor-injected config tokens for paths
- `MemorySummaryService`: deleted in M2, skip
- `SkillWatcherService`: wrap in `@injectable()` class, constructor-inject `EventBus` + `SKILL_WATCHER_CONFIG_TOKEN`
- Register all 3 (or remaining 2) as singletons in `bootstrap.ts`

### H3: Replace Dynamic Imports with Constructor Injection
- In `command-handlers.ts`, `admin-handlers.ts`, `artifact-handlers.ts`, `settings-handlers.ts`, `tools.ts`
- Find `await import(...)` — replace with top-level imports (Node.js built-ins) or constructor-injected services
- Handler files that need DI: convert to classes or receive deps via closure from `registerIpcHandlers`

### H11: Register MemoryManager Against Token
- `bootstrap.ts`: change `registerSingleton(MemoryManager)` → `register(MEMORY_MANAGER_TOKEN, { useClass: MemoryManager })`
- Find injection sites using `@inject(MemoryManager)` → change to `@inject(MEMORY_MANAGER_TOKEN) IMemoryManager`

### M2: Delete MemorySummaryService
- Remove `src/main/services/MemorySummaryService.ts` + test file if exists
- Remove registration from `bootstrap.ts`
- Verify no imports remain

### M6: Delete NotFoundError
- Remove from `src/main/services/errors.ts:8-13`
- Verify no imports exist

---

## Batch 4 — DRY + Hardening (H1, H6-H9, H12, M1, M3-M5, M7-M14)

### H1: Add sandbox: true
- `src/main/index.ts:13`: add `sandbox: true` to webPreferences
- Preload already uses only `contextBridge` — should work
- Test all IPC paths (chat, projects, artifacts, settings, research, skills)

### H6: BaseDrizzleRepository
- Abstract class with `db`, `clock`, `table`, `rowToEntity`, `id()`, `now()`
- Concrete repos extend, provide table definition + row mapping
- `MonotonicClock` injected via `CLOCK_TOKEN`

### H7: Split SettingsModal
- `useProviderSettings(provider)` hook — model, apiKey, host state
- `useAuditLog()` hook — log entries fetch
- `useSkillManager()` hook — skills CRUD
- SettingsModal owns `tab` + `open` state only

### H8: SEND_MESSAGE → ipcMain.handle
- Convert from `ipcMain.on` + `event.sender.send` to `ipcMain.handle`
- Return `{ messageId: string }` from handler
- Add per-project mutex (`Map<string, Promise<void>>`) for session creation serialization
- Renderer: `invoke(SEND_MESSAGE, payload)` instead of `send(SEND_MESSAGE, payload)`

### H9: MemoryFileService Through PathJail
- Inject `PathJail` factory or `AllowlistService` into `MemoryFileService`
- Before `writeFile`, call `jail.validate(path, "write")`
- `ApprovalRequiredError` → surface to renderer via EventBus

### H12: Zod IPC Guards
- Create `src/shared/ipc-guards.ts` with typed decoder functions
- One Zod schema per IPC push channel payload
- Replace 6 bare `as` casts in renderer with guard calls
- Malformed payload → log error, return null, no crash

### M1: Deduplicate toSlug
- Export `toSlug` from `context.ts` (already defined there)
- Import in `MemoryFileService.ts` instead of redefining

### M3: GenericPendingApprovalBanner<T>
- Parameterized by: item type T, channel name, key extractor fn, modal component
- 3 banners (Command, Path, Tool) use same skeleton with different type params

### M4: ReviewDialog Component
- Content slot pattern for PendingCommandModal + PendingPathModal
- Shared: dialog shell, approve/deny buttons, session checkbox
- Slot: item-specific content (command text vs path breadcrumbs)

### M5: ModelAutocomplete Component
- Single `<ModelAutocomplete provider="openrouter|openai|ollama" />`
- Used 3× in ModelProviderTab — currently copy-pasted

### M7: Singleton MonotonicClock
- Register as singleton in DI
- Define `CLOCK_TOKEN` in tokens.ts
- Inject into 3 Drizzle repositories

### M8: Fix migrate.ts Error Swallowing
- In catch block, check `err.message?.includes("SQLITE_ERROR")` + duplicate column
- Re-throw all other errors

### M9: parseOrThrow Typing
- Use `z.ZodType<T>` parameter for proper generic inference
- Preserve structured error info (path, expected, received)

### M10: Delete ArtifactSection
- File is pass-through — renders FileExplorer with no added logic
- Use FileExplorer directly in DetailsPanel
- Remove file

### M11: Push Filter to Repository
- Add `findUnacknowledged(projectId)` method to `IArtifactRepository` + implementation
- ArtifactService calls `repo.findUnacknowledged(projectId)` instead of filtering in memory

### M12: Standardize Zod Import
- Grep for `from "zod"` (not v4), replace with `from "zod/v4"`
- Affected: `worker-agent.ts`, others

### M13: Standardize Test Placement
- Remove co-located `file-tools.test.ts` duplicate
- Keep `__tests__/` version
- Document convention

### M14: Barrel Exports
- Add `index.ts` in `services/`, `repositories/drizzle/`, `ipc/`
- Re-export all public classes/interfaces

---

## Batch 5 — Agent Decoupling (H4, H10)

### H4: AgentSession → EventBus
- Remove `BrowserWindow` from AgentSession constructor
- Inject `EventBus`
- Replace `this.browserWindow.webContents.send(channel, data)` with `this.eventBus.emit({ type: "agent:chunk", payload: data })`
- IPC layer subscribes: `eventBus.on("agent:chunk", (p) => win.webContents.send(IPC.MESSAGE_CHUNK, p))`
- Enables testing AgentSession without Electron

### H10: Langfuse Warning
- In SettingsModal langfuse toggle section, add warning text: "Traces are routed through cloud.langfuse.com"
- In `model-factory.ts`, log warning when Langfuse enabled
- No blocking — informed consent only

---

## Batch 6 — Low Polish (L1-L16)

- **L1:** Add Ollama host health check on settings save. If unreachable, warn via dialog.
- **L2:** In `frontmatter.ts` catch block, `console.warn("Failed to parse frontmatter YAML:", err)` before returning `{}`.
- **L3:** Replace emoji strings `"📂"`, `"📁"`, `"📄"` with MUI `FolderOpenIcon`, `FolderIcon`, `InsertDriveFileIcon` in FileExplorer.
- **L4:** Move `/// <reference types="vite/client" />` from `vite-env.d.ts` into `electron.d.ts`. Delete `vite-env.d.ts`.
- **L5:** Validate `ELECTRON_RENDERER_URL` starts with `http://localhost:` or `file://`. Add `Content-Security-Policy` header in production (non-dev) mode.
- **L6:** Add 1-second per-project throttle in chat-handlers. Cap message content at 100KB. Return error if exceeded.
- **L7:** Add comment in `time.ts:5-7`: "MonotonicClock may drift under NTP correction. Acceptable for single-user desktop app — clock ordering is per-session, not distributed."
- **L8:** Add `.max(100)` to `CreateProjectSchema.name` in `ipc-validation.ts`.
- **L9:** Move `glass.ts` styles into `theme.ts`. Delete `glass.ts`.
- **L10:** Remove `PaperProps` cast in `PendingToolModal`, use `data-testid` directly on Dialog.
- **L11:** Add comment in `startup-tasks.ts:13`: "Intentionally non-blocking — startup tasks run in background."
- **L12:** Remove unused `_projectId` parameter from `buildSystemContext` signature.
- **L13:** Define `DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4-6"` in `src/shared/constants.ts`. Import in 4 files.
- **L14:** Replace HTML scraping in `web-search.ts` with DuckDuckGo Instant Answer API (`api.duckduckgo.com/?q=...&format=json`).
- **L15:** In Ollama model provider, if configured host is not localhost/127.0.0.1, log warning about unencrypted connection.
- **L16:** Remove blocked-command list from `safe-bash-tool.ts` description string. Replace with generic "potentially dangerous commands require approval."

---

## Order of Operations

1. **Batch 1** — Critical bugs. No structural changes, just fixes.
2. **Batch 2** — God object splits. New classes, DI wiring, backward-compat facades.
3. **Batch 3** — Dead code removal + DI gaps. Cleanest after Batch 2 structure is in place.
4. **Batch 4** — DRY + hardening. Bulk of the work. Uses new service structure from Batch 2.
5. **Batch 5** — Agent decoupling. Touches AgentSession, needs EventBus wiring from Batch 2/3.
6. **Batch 6** — Polish. Scattered small fixes. Safe to do last.

Each batch: typecheck → lint → test → commit. No batch pushes until previous batch's tests pass.
