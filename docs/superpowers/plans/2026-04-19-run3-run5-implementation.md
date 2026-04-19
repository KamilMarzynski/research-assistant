# Run 3 + Run 5 (merged Run 4/5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working chat app: CLAUDE.md cleanup + git hygiene (Run 3), then real streaming LLM via Pi SDK + OpenRouter with project-scoped sessions and persisted message history (Run 5).

**Architecture:** Pi `Agent` (from `@mariozechner/pi-agent-core`) wraps each project's conversation — created lazily on first `SEND_MESSAGE`, stored in `Map<projectId, AgentSession>` in the IPC handler layer. Events stream to renderer via existing IPC. Settings (API key + model) encrypted via `electron.safeStorage` in a `SettingsService`. React context carries active project ID across `LeftSidebar` → `ChatPanel`.

**Tech Stack:** `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `electron.safeStorage`, MUI v6, React 19, TSyringe, Vitest

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src/main/agent/session.ts` | `AgentSession` — wraps Pi `Agent`, maps events → IPC |
| `src/main/agent/session.test.ts` | Unit tests for `AgentSession` |
| `src/main/services/SettingsService.ts` | Encrypt/persist API key + model to `userData/settings.json` |
| `src/main/services/__tests__/SettingsService.test.ts` | Unit tests for `SettingsService` |
| `src/renderer/electron.d.ts` | `window.electronAPI` type declaration |
| `src/renderer/contexts/ProjectContext.tsx` | Active project ID — React context shared by sidebar + chat |
| `src/renderer/components/settings/SettingsModal.tsx` | API key + model settings dialog |
| `.env.example` | Document required env vars |

### Modified files
| File | What changes |
|---|---|
| `CLAUDE.md` | Complete rewrite — correct packages, architecture, IPC contract |
| `src/shared/ipc-channels.ts` | Add `GET_MESSAGES`, `GET_SETTINGS`, `SAVE_SETTINGS` |
| `src/main/di/tokens.ts` | Add `USER_DATA_PATH_TOKEN`, `SETTINGS_SERVICE_TOKEN` |
| `src/main/bootstrap.ts` | Register `userDataPath` instance + `SettingsService` singleton |
| `src/main/ipc-handlers.ts` | Implement all handlers; add `AgentSession` map |
| `src/renderer/App.tsx` | Wrap with `ProjectProvider`; add `settingsOpen` state + `SettingsModal` |
| `src/renderer/components/layout/AppShell.tsx` | Accept + thread `onOpenSettings` prop |
| `src/renderer/components/layout/LeftSidebar.tsx` | Real project list, create button, settings gear |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Fetch history, stream chunks, send message |
| `src/renderer/components/layout/chat/MessageList.tsx` | Render message bubbles + streaming bubble |
| `src/renderer/components/layout/chat/MessageInput.tsx` | Textarea + model selector chip |

---

## Task 1: Verify baseline (Run 3 sanity checks)

**Files:** none changed

- [ ] **Step 1: Run typecheck**

```bash
cd /path/to/research-assistant
bun run typecheck
```
Expected: zero errors. If errors appear, fix before continuing.

- [ ] **Step 2: Run linter**

```bash
bun run check
```
Expected: clean. Auto-fixes applied by Biome.

- [ ] **Step 3: Run tests**

```bash
bun run test
```
Expected: all pass. The `ResearchService.test.ts` (currently modified) should pass — it tests that `startResearch` throws `NotImplementedError` with message `"Run 6"`.

- [ ] **Step 4: Smoke-test dev mode**

```bash
bun run dev
```
Expected: Electron window opens, AppShell renders three-column layout.

---

## Task 2: Rewrite CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace CLAUDE.md with updated content**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

\`\`\`bash
bun run dev          # Start Electron with hot-reload (Vite dev server + Electron)
bun run build        # Production build via electron-vite
bun run typecheck    # tsc --noEmit — must be zero errors before committing
bun run check        # Biome lint + format check (auto-fixes) — must be clean before committing
bun run lint         # Biome lint only (no fix)
bun run format       # Biome format only (with --write)
bun run test         # Run all Vitest tests
\`\`\`

**Always use `bun` and `bunx`. Never `npm`, `npx`, or `yarn`.**

## Architecture

Three-process Electron app:

\`\`\`
src/main/       — Node.js process: BrowserWindow, IPC handlers, services, agents
src/preload/    — Bridge: exposes window.electronAPI via contextBridge (whitelist-only)
src/renderer/   — Browser context: React + MUI, communicates only via window.electronAPI
src/shared/     — Types and constants shared across all three processes
\`\`\`

**Critical constraint:** The renderer is a pure browser context. No Node.js APIs — all system calls go through IPC. The preload is the only bridge.

## Agent Harness

**Package:** `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`

**Never install `@mariozechner/pi-coding-agent`** — that is a CLI terminal app, not an SDK.

`AgentSession` (`src/main/agent/session.ts`) wraps one Pi `Agent` per project:
- Created lazily on first `SEND_MESSAGE` for a project
- Stored in `Map<projectId, AgentSession>` in `ipc-handlers.ts`
- Reused for subsequent messages (preserves Pi conversation history)
- `beforeToolCall` blocks all tool calls until Run 6

Event mapping:
| Pi event | IPC channel |
|---|---|
| `message_update` + `text_delta` | `MESSAGE_CHUNK` |
| `agent_end` | `MESSAGE_DONE` |

## IPC Contract (`src/shared/ipc-channels.ts`)

| Channel | Direction | Pattern | Purpose |
|---|---|---|---|
| `GET_PROJECTS` | renderer→main | `invoke` | Fetch project list |
| `CREATE_PROJECT` | renderer→main | `invoke` | Create project |
| `GET_ARTIFACTS` | renderer→main | `invoke` | Fetch artifacts |
| `GET_MESSAGES` | renderer→main | `invoke` | Fetch message history for project |
| `GET_SETTINGS` | renderer→main | `invoke` | Read current settings |
| `SAVE_SETTINGS` | renderer→main | `invoke` | Save API key + model |
| `SEND_MESSAGE` | renderer→main | `send` (fire-and-forget) | Submit chat message |
| `MESSAGE_CHUNK` | main→renderer | `webContents.send` | Stream LLM token |
| `MESSAGE_DONE` | main→renderer | `webContents.send` | Stream complete |
| `NEW_MESSAGE` | main→renderer | `webContents.send` | Push new message |
| `RESEARCH_STATUS_UPDATE` | main→renderer | `webContents.send` | Research progress |
| `RESEARCH_COMPLETE` | main→renderer | `webContents.send` | Research done |

**`ipcMain.handle` is global** — register handlers once at startup only (`app.whenReady`), never inside `activate`.

**Streaming pattern:** `ipcMain.on` + `event.sender.send(IPC.MESSAGE_CHUNK, token)` per chunk.

## Settings

`SettingsService` (`src/main/services/SettingsService.ts`) persists to `app.getPath('userData')/settings.json`:
- API key encrypted via `electron.safeStorage` (stored as base64)
- Model stored plain

## Agent Home Directory (Run 6+)

`~/.research-assistant/` — not yet implemented. Planned: `config.md`, `skills/`, `projects/<slug>/AGENTS.md`, `workspace/`, `audit.log`.

## Code Execution Model (Run 6+, Run 8)

Three tiers — not yet implemented:
- **Tier 1** (Run 6): Path-jailed `read`/`write`/`edit` via `src/main/agent/path-jail.ts`
- **Tier 2** (Run 6): `safe_bash` Pi extension — fenced execution with blocklist + timeout + audit log
- **Tier 3** (Run 8): `run_in_sandbox` E2B extension — isolated container

## Toolchain

| Concern | Tool |
|---|---|
| Runtime / package manager | Bun |
| Build | electron-vite |
| Linting + formatting | Biome v2 (no ESLint, no Prettier) |
| UI | React 19 + MUI v9 |
| Language | TypeScript strict throughout |
| DI | TSyringe (`@injectable()`, `@inject()`) |
| DB | Drizzle ORM + `@libsql/client` (NOT `bun:sqlite`) |

## TypeScript Path Aliases

\`\`\`
@main/*    → src/main/*
@renderer/* → src/renderer/*
@shared/*  → src/shared/*
\`\`\`

## What NOT to do

- No `require()` — ESM throughout
- No Node.js APIs in renderer — all go through IPC
- No ESLint, no Prettier — Biome only
- No `bun:sqlite` — use `@libsql/client`
- No `@mariozechner/pi-coding-agent` — use `pi-agent-core` + `pi-ai`
- No Mastra imports before Run 7
- Do not register `ipcMain.handle` inside the `activate` handler
```

- [ ] **Step 2: Verify typecheck still passes**

```bash
bun run typecheck
```
Expected: zero errors.

---

## Task 3: Git hygiene + Run 3 commit

**Files:**
- Verify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Verify .gitignore has bun.lockb excluded from ignore**

Open `.gitignore` and confirm `bun.lockb` is NOT listed (it should be committed). Current content:
```
node_modules/
dist/
out/
.env
*.local
*.db
.DS_Store
```
This is correct — `bun.lockb` is not ignored. No changes needed.

- [ ] **Step 2: Create .env.example**

```
OPENROUTER_API_KEY=sk-or-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

- [ ] **Step 3: Commit Run 3**

```bash
git add CLAUDE.md .env.example
git commit -m "chore(run3): rewrite CLAUDE.md, add .env.example"
```

---

## Task 4: Install Pi SDK + add IPC channels

**Files:**
- Modify: `package.json` (via bun add)
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Install Pi packages**

```bash
bun add @mariozechner/pi-ai @mariozechner/pi-agent-core
```
Expected: packages added to `package.json` dependencies, `bun.lockb` updated.

- [ ] **Step 2: Add IPC channels**

Replace `src/shared/ipc-channels.ts` with:

```typescript
export const IPC = {
  // renderer → main (invoke — request/response)
  GET_PROJECTS: "GET_PROJECTS",
  CREATE_PROJECT: "CREATE_PROJECT",
  GET_ARTIFACTS: "GET_ARTIFACTS",
  GET_MESSAGES: "GET_MESSAGES",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

The preload (`src/preload/index.ts`) already whitelists all channels via `Object.values(IPC)` — no change needed there.

- [ ] **Step 3: Add window.electronAPI type declaration**

Create `src/renderer/electron.d.ts`:

```typescript
import type { IpcChannel } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
    };
  }
}

export {};
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb src/shared/ipc-channels.ts src/renderer/electron.d.ts
git commit -m "feat: install pi-agent-core/pi-ai, add GET_MESSAGES/GET_SETTINGS/SAVE_SETTINGS IPC channels"
```

---

## Task 5: SettingsService — tests first

**Files:**
- Create: `src/main/services/__tests__/SettingsService.test.ts`
- Create: `src/main/services/SettingsService.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/services/__tests__/SettingsService.test.ts`:

```typescript
import "reflect-metadata";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron — safeStorage is main-process only
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
}));

// Import after mock is registered
const { SettingsService } = await import("../SettingsService");

describe("SettingsService", () => {
  let tmpDir: string;
  let service: SettingsService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "settings-test-"));
    service = new SettingsService(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("getSettings", () => {
    it("returns defaults when no settings file exists", async () => {
      const settings = await service.getSettings();
      expect(settings).toEqual({
        openrouterApiKey: null,
        model: "anthropic/claude-sonnet-4-6",
      });
    });
  });

  describe("saveSettings + getSettings round-trip", () => {
    it("saves and retrieves API key via safeStorage", async () => {
      await service.saveSettings({ openrouterApiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBe("sk-or-test");
      expect(settings.model).toBe("anthropic/claude-sonnet-4-6");
    });

    it("saves and retrieves model without touching API key", async () => {
      await service.saveSettings({ openrouterApiKey: "sk-or-test", model: "openai/gpt-4o" });
      await service.saveSettings({ model: "anthropic/claude-haiku-4-5" });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBe("sk-or-test");
      expect(settings.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("allows clearing API key by passing null", async () => {
      await service.saveSettings({ openrouterApiKey: "sk-or-test" });
      await service.saveSettings({ openrouterApiKey: null });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBeNull();
    });

    it("encrypts API key via safeStorage.encryptString", async () => {
      const { safeStorage } = await import("electron");
      await service.saveSettings({ openrouterApiKey: "sk-or-test" });
      expect(safeStorage.encryptString).toHaveBeenCalledWith("sk-or-test");
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun run test src/main/services/__tests__/SettingsService.test.ts
```
Expected: FAIL — `SettingsService` does not exist yet.

- [ ] **Step 3: Implement SettingsService**

Create `src/main/services/SettingsService.ts`:

```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";

export interface AppSettings {
  openrouterApiKey: string | null;
  model: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  openrouterApiKey: null,
  model: "anthropic/claude-sonnet-4-6",
};

interface StoredSettings {
  encryptedApiKey?: string;
  model?: string;
}

@injectable()
export class SettingsService {
  private readonly settingsPath: string;

  constructor(@inject(USER_DATA_PATH_TOKEN) userDataPath: string) {
    this.settingsPath = join(userDataPath, "settings.json");
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.settingsPath, "utf-8");
      const stored = JSON.parse(raw) as StoredSettings;

      let openrouterApiKey: string | null = null;
      if (stored.encryptedApiKey) {
        const buf = Buffer.from(stored.encryptedApiKey, "base64");
        if (safeStorage.isEncryptionAvailable()) {
          openrouterApiKey = safeStorage.decryptString(buf);
        } else {
          openrouterApiKey = buf.toString("utf-8");
        }
      }

      return {
        openrouterApiKey,
        model: stored.model ?? DEFAULT_SETTINGS.model,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings();
    const next: AppSettings = { ...current, ...patch };

    let encryptedApiKey: string | undefined;
    if (next.openrouterApiKey !== null) {
      if (safeStorage.isEncryptionAvailable()) {
        encryptedApiKey = safeStorage.encryptString(next.openrouterApiKey).toString("base64");
      } else {
        console.warn("[SettingsService] safeStorage unavailable — key stored without encryption");
        encryptedApiKey = Buffer.from(next.openrouterApiKey).toString("base64");
      }
    }

    const stored: StoredSettings = { model: next.model };
    if (encryptedApiKey !== undefined) stored.encryptedApiKey = encryptedApiKey;

    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(stored), "utf-8");
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/services/__tests__/SettingsService.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/SettingsService.ts src/main/services/__tests__/SettingsService.test.ts
git commit -m "feat: add SettingsService with safeStorage encryption"
```

---

## Task 6: DI tokens + bootstrap registration

**Files:**
- Modify: `src/main/di/tokens.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Add tokens**

Replace `src/main/di/tokens.ts` with:

```typescript
import type { InjectionToken } from "tsyringe";
import type { DrizzleDB } from "../db/client";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";
import type { IMessageRepository } from "../repositories/IMessageRepository";
import type { IProjectRepository } from "../repositories/IProjectRepository";

export const DB_TOKEN: InjectionToken<DrizzleDB> = Symbol("DrizzleDB");
export const PROJECT_REPO_TOKEN: InjectionToken<IProjectRepository> = Symbol("IProjectRepository");
export const MESSAGE_REPO_TOKEN: InjectionToken<IMessageRepository> = Symbol("IMessageRepository");
export const ARTIFACT_REPO_TOKEN: InjectionToken<IArtifactRepository> = Symbol("IArtifactRepository");
export const USER_DATA_PATH_TOKEN: InjectionToken<string> = Symbol("UserDataPath");
```

- [ ] **Step 2: Register SettingsService in bootstrap**

Replace `src/main/bootstrap.ts` with:

```typescript
import { join } from "node:path";
import { app } from "electron";
import { container, type DependencyContainer } from "tsyringe";
import { createDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import {
  ARTIFACT_REPO_TOKEN,
  DB_TOKEN,
  MESSAGE_REPO_TOKEN,
  PROJECT_REPO_TOKEN,
  USER_DATA_PATH_TOKEN,
} from "./di/tokens";
import { EventBus } from "./event-bus";
import { DrizzleArtifactRepository } from "./repositories/drizzle/DrizzleArtifactRepository";
import { DrizzleMessageRepository } from "./repositories/drizzle/DrizzleMessageRepository";
import { DrizzleProjectRepository } from "./repositories/drizzle/DrizzleProjectRepository";
import { ArtifactService } from "./services/ArtifactService";
import { FileService } from "./services/FileService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

export async function bootstrap(): Promise<DependencyContainer> {
  const userDataPath = app.getPath("userData");
  const dbPath = join(userDataPath, "research-assistant.db");
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const appContainer = container.createChildContainer();

  appContainer.registerInstance(DB_TOKEN, db);
  appContainer.registerInstance(USER_DATA_PATH_TOKEN, userDataPath);

  appContainer.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  appContainer.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  appContainer.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  appContainer.registerSingleton(ProjectService);
  appContainer.registerSingleton(MessageService);
  appContainer.registerSingleton(ArtifactService);
  appContainer.registerSingleton(ResearchService);
  appContainer.registerSingleton(FileService);
  appContainer.registerSingleton(EventBus);
  appContainer.registerSingleton(SettingsService);

  return appContainer;
}
```

- [ ] **Step 3: Run typecheck + tests**

```bash
bun run typecheck && bun run test
```
Expected: zero errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/di/tokens.ts src/main/bootstrap.ts
git commit -m "feat: register SettingsService + USER_DATA_PATH_TOKEN in DI container"
```

---

## Task 7: AgentSession — tests first

**Files:**
- Create: `src/main/agent/session.test.ts`
- Create: `src/main/agent/session.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/agent/session.test.ts`:

```typescript
import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";

// Capture the subscriber so tests can trigger Pi events manually
let capturedSubscriber: ((event: unknown) => Promise<void>) | null = null;

const mockAgent = {
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: vi.fn(() => mockAgent),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("electron", () => ({}));

const { AgentSession } = await import("./session");

function makeMessageService() {
  return {
    addMessage: vi.fn().mockResolvedValue({ id: "msg-1", projectId: "p-1", role: "user", content: "hi", createdAt: new Date() }),
    getHistory: vi.fn().mockResolvedValue([]),
    getRecentContext: vi.fn().mockResolvedValue([]),
  };
}

function makeWin() {
  return { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow;
}

describe("AgentSession", () => {
  let messageService: ReturnType<typeof makeMessageService>;
  let win: Electron.BrowserWindow;
  let session: InstanceType<typeof AgentSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    messageService = makeMessageService();
    win = makeWin();
    session = new AgentSession({
      win,
      messageService: messageService as never,
      projectId: "p-1",
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
    });
  });

  describe("send()", () => {
    it("persists user message before calling agent.prompt()", async () => {
      const sendPromise = session.send("hello");
      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "user",
        content: "hello",
      });
      await sendPromise;
      expect(mockAgent.prompt).toHaveBeenCalledWith("hello");
    });

    it("calls addMessage before prompt (order matters)", async () => {
      const order: string[] = [];
      messageService.addMessage.mockImplementation(async () => { order.push("addMessage"); return {} as never; });
      mockAgent.prompt.mockImplementation(async () => { order.push("prompt"); });
      await session.send("hello");
      expect(order).toEqual(["addMessage", "prompt"]);
    });
  });

  describe("Pi event → IPC mapping", () => {
    it("sends MESSAGE_CHUNK on text_delta", async () => {
      await capturedSubscriber!({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.MESSAGE_CHUNK, "Hello");
    });

    it("accumulates deltas and persists full content on agent_end", async () => {
      await capturedSubscriber!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
      await capturedSubscriber!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
      await capturedSubscriber!({ type: "agent_end", messages: [] });

      expect(messageService.addMessage).toHaveBeenCalledWith({
        projectId: "p-1",
        role: "assistant",
        content: "Hello world",
      });
    });

    it("sends MESSAGE_DONE on agent_end", async () => {
      await capturedSubscriber!({ type: "agent_end", messages: [] });
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.MESSAGE_DONE);
    });

    it("does not persist empty assistant content on agent_end", async () => {
      await capturedSubscriber!({ type: "agent_end", messages: [] });
      // addMessage should only have been called for user messages — not with assistant role
      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant"
      );
      expect(assistantCalls).toHaveLength(0);
    });

    it("resets accumulated content after agent_end so next prompt starts fresh", async () => {
      await capturedSubscriber!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "First" } });
      await capturedSubscriber!({ type: "agent_end", messages: [] });

      vi.clearAllMocks();

      await capturedSubscriber!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Second" } });
      await capturedSubscriber!({ type: "agent_end", messages: [] });

      const assistantCalls = messageService.addMessage.mock.calls.filter(
        ([arg]) => (arg as { role: string }).role === "assistant"
      );
      expect(assistantCalls[0][0].content).toBe("Second");
    });

    it("ignores non-text_delta message_update events", async () => {
      await capturedSubscriber!({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } });
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe("abort()", () => {
    it("calls agent.abort()", () => {
      session.abort();
      expect(mockAgent.abort).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun run test src/main/agent/session.test.ts
```
Expected: FAIL — `AgentSession` does not exist yet.

- [ ] **Step 3: Implement AgentSession**

Create `src/main/agent/session.ts`:

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { MessageService } from "../services/MessageService";

interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  projectId: string;
  apiKey: string;
  model: string;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly projectId: string;
  private assistantContent = "";

  constructor({ win, messageService, projectId, apiKey, model }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.projectId = projectId;

    this.agent = new Agent({
      initialState: {
        systemPrompt: "You are a helpful research assistant.",
        model: getModel("openrouter", model),
      },
      getApiKey: async () => apiKey,
      beforeToolCall: async () => ({ block: true, reason: "Tools not available until Run 6" }),
    });

    this.agent.subscribe(async (event) => {
      if (event.type === "message_update") {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta") {
          this.assistantContent += ae.delta;
          this.win.webContents.send(IPC.MESSAGE_CHUNK, ae.delta);
        }
      } else if (event.type === "agent_end") {
        if (this.assistantContent) {
          await this.messageService.addMessage({
            projectId: this.projectId,
            role: "assistant",
            content: this.assistantContent,
          });
          this.assistantContent = "";
        }
        this.win.webContents.send(IPC.MESSAGE_DONE);
      }
    });
  }

  async send(content: string): Promise<void> {
    await this.messageService.addMessage({
      projectId: this.projectId,
      role: "user",
      content,
    });
    await this.agent.prompt(content);
  }

  abort(): void {
    this.agent.abort();
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/agent/session.test.ts
```
Expected: all 9 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
bun run test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat: add AgentSession wrapping pi-agent-core with IPC streaming"
```

---

## Task 8: IPC handlers — wire all channels

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Replace ipc-handlers.ts**

```typescript
import { type BrowserWindow, ipcMain } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { AgentSession } from "./agent/session";
import { ArtifactService } from "./services/ArtifactService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { SettingsService } from "./services/SettingsService";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);

  const sessions = new Map<string, AgentSession>();

  ipcMain.handle(IPC.GET_PROJECTS, async () => projectService.listProjects());

  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { name: string }");
    }
    return projectService.createProject((payload as { name: string }).name);
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return artifactService.listArtifacts((payload as { projectId: string }).projectId);
  });

  ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return messageService.getHistory((payload as { projectId: string }).projectId);
  });

  ipcMain.handle(IPC.GET_SETTINGS, async () => settingsService.getSettings());

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid payload");
    }
    return settingsService.saveSettings(payload as Parameters<typeof settingsService.saveSettings>[0]);
  });

  ipcMain.on(IPC.SEND_MESSAGE, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string" ||
      typeof (payload as { content?: unknown }).content !== "string"
    ) {
      console.error("[IPC] SEND_MESSAGE: invalid payload", payload);
      return;
    }
    const { projectId, content } = payload as { projectId: string; content: string };

    const settings = await settingsService.getSettings();
    if (!settings.openrouterApiKey) {
      win.webContents.send(
        IPC.MESSAGE_CHUNK,
        "⚠️ No API key configured. Open Settings to add your OpenRouter API key.",
      );
      win.webContents.send(IPC.MESSAGE_DONE);
      return;
    }

    if (!sessions.has(projectId)) {
      sessions.set(
        projectId,
        new AgentSession({
          win,
          messageService,
          projectId,
          apiKey: settings.openrouterApiKey,
          model: settings.model,
        }),
      );
    }

    const session = sessions.get(projectId)!;
    await session.send(content);
  });
}
```

- [ ] **Step 2: Run typecheck + tests**

```bash
bun run typecheck && bun run test
```
Expected: zero errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: wire all IPC handlers, add AgentSession map to SEND_MESSAGE"
```

---

## Task 9: App.tsx + ProjectContext + AppShell props

**Files:**
- Create: `src/renderer/contexts/ProjectContext.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Create ProjectContext**

Create `src/renderer/contexts/ProjectContext.tsx`:

```typescript
import { createContext, useContext, useState, type ReactNode } from "react";

interface ProjectContextValue {
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  activeProjectId: null,
  setActiveProjectId: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  return (
    <ProjectContext.Provider value={{ activeProjectId, setActiveProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}
```

- [ ] **Step 2: Update App.tsx**

```typescript
import { useState } from "react";
import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import AppShell from "./components/layout/AppShell";
import SettingsModal from "./components/settings/SettingsModal";
import { ProjectProvider } from "./contexts/ProjectContext";
import { createAppTheme } from "./theme";

export default function App() {
  const isDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = createAppTheme(isDark ? "dark" : "light");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ProjectProvider>
        <AppShell onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ProjectProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Update AppShell.tsx to accept and thread onOpenSettings**

```typescript
import { Box } from "@mui/material";
import ArtifactPanel from "./artifacts/ArtifactPanel";
import ChatPanel from "./chat/ChatPanel";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";

interface AppShellProps {
  onOpenSettings: () => void;
}

export default function AppShell({ onOpenSettings }: AppShellProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Box sx={{ width: 240, flexShrink: 0, height: "100%" }}>
        <LeftSidebar onOpenSettings={onOpenSettings} />
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", height: "100%" }}>
        <ChatPanel />
      </Box>
      <Box
        sx={{
          width: 320,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <RightSidebar />
        <ArtifactPanel />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```
Expected: errors about missing `SettingsModal` and updated `LeftSidebar` props — these are resolved in Tasks 10 and 11. Proceed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/contexts/ProjectContext.tsx src/renderer/App.tsx src/renderer/components/layout/AppShell.tsx
git commit -m "feat: add ProjectContext, thread onOpenSettings through App → AppShell"
```

---

## Task 10: LeftSidebar — real project list

**Files:**
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`

- [ ] **Step 1: Replace LeftSidebar.tsx**

```typescript
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";

interface LeftSidebarProps {
  onOpenSettings: () => void;
}

export default function LeftSidebar({ onOpenSettings }: LeftSidebarProps) {
  const { activeProjectId, setActiveProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    window.electronAPI
      .invoke(IPC.GET_PROJECTS)
      .then((p) => setProjects(p as Project[]));
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const project = (await window.electronAPI.invoke(IPC.CREATE_PROJECT, { name })) as Project;
    setProjects((prev) => [...prev, project]);
    setNewName("");
    setCreating(false);
    setActiveProjectId(project.id);
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "action.hover",
      }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" color="text.secondary">
          Projects
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List dense disablePadding>
          {projects.map((p) => (
            <ListItemButton
              key={p.id}
              selected={p.id === activeProjectId}
              onClick={() => setActiveProjectId(p.id)}
            >
              <ListItemText
                primary={p.name}
                primaryTypographyProps={{ variant: "body2", noWrap: true }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ px: 1, py: 0.5 }}>
          {creating ? (
            <TextField
              size="small"
              fullWidth
              placeholder="Project name"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              onBlur={() => {
                if (!newName.trim()) {
                  setCreating(false);
                }
              }}
            />
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setCreating(true)}
              fullWidth
              sx={{ justifyContent: "flex-start" }}
            >
              New project
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
        <IconButton size="small" onClick={onOpenSettings} title="Settings">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: errors only about missing `SettingsModal` (Task 11) — LeftSidebar itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/LeftSidebar.tsx
git commit -m "feat: LeftSidebar with real project list and create flow"
```

---

## Task 11: SettingsModal

**Files:**
- Create: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Create SettingsModal**

```typescript
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";

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
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { openrouterApiKey: string | null; model: string };
      setApiKey(settings.openrouterApiKey ?? "");
      setModel(settings.model);
    });
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
      openrouterApiKey: apiKey.trim() || null,
      model,
    });
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
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
          <Select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            label="Model"
          >
            {MODELS.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: errors only about ChatPanel/MessageList/MessageInput (Task 12).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx
git commit -m "feat: add SettingsModal for API key and model configuration"
```

---

## Task 12: ChatPanel + MessageList + MessageInput

**Files:**
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`

- [ ] **Step 1: Implement MessageList**

```typescript
import { Box, Paper, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";

interface MessageListProps {
  messages: Message[];
  streamingContent: string | null;
}

export default function MessageList({ messages, streamingContent }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: "auto",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {messages.map((msg) => (
        <Box
          key={msg.id}
          sx={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "75%",
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: msg.role === "user" ? "primary.main" : "action.selected",
              borderRadius: 2,
            }}
          >
            <Typography
              variant="body2"
              color={msg.role === "user" ? "primary.contrastText" : "text.primary"}
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {msg.content}
            </Typography>
          </Paper>
        </Box>
      ))}

      {streamingContent !== null && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "75%" }}>
          <Paper
            elevation={0}
            sx={{ p: 1.5, bgcolor: "action.selected", borderRadius: 2 }}
          >
            <Typography
              variant="body2"
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {streamingContent}
              <Box
                component="span"
                sx={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  bgcolor: "text.primary",
                  ml: 0.5,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                  "@keyframes blink": { "50%": { opacity: 0 } },
                }}
              />
            </Typography>
          </Paper>
        </Box>
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
```

- [ ] **Step 2: Implement MessageInput**

```typescript
import SendIcon from "@mui/icons-material/Send";
import { Box, IconButton, MenuItem, Select, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { model: string };
      setModel(settings.model);
    });
  }, []);

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, { model: newModel });
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setContent("");
  };

  return (
    <Box
      sx={{
        p: 1.5,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        gap: 1,
        alignItems: "flex-end",
      }}
    >
      <Select
        size="small"
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {MODELS.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.label}
          </MenuItem>
        ))}
      </Select>

      <TextField
        multiline
        maxRows={6}
        fullWidth
        size="small"
        placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
      />

      <IconButton
        onClick={handleSend}
        disabled={!content.trim() || disabled}
        color="primary"
        size="small"
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
```

- [ ] **Step 3: Implement ChatPanel**

```typescript
import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import type { Message } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";

export default function ChatPanel() {
  const { activeProjectId } = useProject();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  // Check API key once on mount
  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { openrouterApiKey: string | null };
      setHasApiKey(settings.openrouterApiKey !== null);
    });
  }, []);

  // Load message history when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      return;
    }
    window.electronAPI
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs as Message[]));
  }, [activeProjectId]);

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (delta) => {
      setStreamingContent((prev) => (prev ?? "") + (delta as string));
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, () => {
      setStreamingContent((prev) => {
        if (prev !== null) {
          // Check for API key error message — refresh hasApiKey state
          if (prev.startsWith("⚠️")) {
            setHasApiKey(false);
          }
          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              projectId: activeProjectId ?? "",
              role: "assistant" as const,
              content: prev,
              createdAt: new Date(),
            },
          ]);
        }
        return null;
      });
    });

    return () => {
      unsubChunk();
      unsubDone();
    };
  }, [activeProjectId]);

  const handleSend = (content: string) => {
    if (!activeProjectId) return;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        projectId: activeProjectId,
        role: "user" as const,
        content,
        createdAt: new Date(),
      },
    ]);
    window.electronAPI.send(IPC.SEND_MESSAGE, { projectId: activeProjectId, content });
  };

  if (!activeProjectId) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">Select a project to start chatting</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MessageList messages={messages} streamingContent={streamingContent} />
      {hasApiKey === false ? (
        <Box sx={{ p: 2, textAlign: "center", borderTop: 1, borderColor: "divider" }}>
          <Typography variant="body2" color="text.secondary">
            Configure your OpenRouter API key in Settings to start chatting.
          </Typography>
        </Box>
      ) : (
        <MessageInput onSend={handleSend} disabled={streamingContent !== null} />
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```
Expected: zero errors.

- [ ] **Step 5: Run all tests**

```bash
bun run test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/chat/ChatPanel.tsx \
        src/renderer/components/layout/chat/MessageList.tsx \
        src/renderer/components/layout/chat/MessageInput.tsx
git commit -m "feat: implement ChatPanel, MessageList, MessageInput with streaming"
```

---

## Task 13: Final verification + Run 5 commit

**Files:** none changed

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```
Expected: zero errors.

- [ ] **Step 2: Biome clean**

```bash
bun run check
```
Expected: clean. Apply any auto-fixes.

- [ ] **Step 3: Full test suite**

```bash
bun run test
```
Expected: all tests pass, >90% coverage on `AgentSession` and `SettingsService`.

- [ ] **Step 4: Smoke test**

```bash
bun run dev
```
Verify:
- Electron window opens
- LeftSidebar shows "New project" button
- Click "New project", type a name, press Enter — project appears in list
- Gear icon opens Settings modal
- Enter an OpenRouter API key and save
- Select the project — ChatPanel shows empty chat
- Type a message and send — user message appears, response streams in

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(run5): final typecheck + lint pass"
```
