# Run 7 — Memory & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mastra-backed persistent memory per project to the main AgentSession, and wire LangFuse proxy tracing for all Pi LLM calls.

**Architecture:** `MemoryManager` TSyringe singleton wraps `@mastra/libsql` `LibSQLStore` for message persistence, implements Observer-style compression using Pi's `complete()`. `model-factory.ts` spreads Pi's model object to override `baseUrl`/`headers` for LangFuse proxy routing. `AgentSession` calls `buildContext()` externally in `ipc-handlers.ts` and receives result as `initialMemoryContext`. Research agents receive no `MemoryManager` — enforced structurally.

**Tech Stack:** `@mastra/libsql`, `@mariozechner/pi-ai` `complete()` (compression), LangFuse proxy (OpenAI-compatible), Drizzle (schema migration), TSyringe (DI), Vitest (tests)

---

## File Map

**Created:**
- `src/main/services/MemoryManager.ts` — `IMemoryManager` interface + `MemoryManager` implementation
- `src/main/services/__tests__/MemoryManager.test.ts`
- `src/main/agent/model-factory.ts` — `createModel()` with LangFuse proxy support
- `src/main/agent/__tests__/model-factory.test.ts`

**Modified:**
- `src/shared/types/project.ts` — add `maxRecentMessages: number`
- `src/main/db/schema.ts` — add `max_recent_messages` column
- `src/main/db/migrate.ts` — idempotent ALTER TABLE
- `src/main/repositories/drizzle/DrizzleProjectRepository.ts` — handle new field
- `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts` — extend tests
- `src/main/services/SettingsService.ts` — add `langfuseEnabled: boolean`
- `src/main/services/__tests__/SettingsService.test.ts` — extend tests
- `src/main/di/tokens.ts` — add `MEMORY_MANAGER` symbol
- `src/main/bootstrap.ts` — register `MemoryManager` singleton
- `src/main/agent/session.ts` — accept `initialMemoryContext`, `memoryManager`, `langfuseEnabled`
- `src/main/agent/session.test.ts` — update to new option shape
- `src/main/ipc-handlers.ts` — resolve `MemoryManager`, call `buildContext`, wire to session
- `src/renderer/components/settings/SettingsModal.tsx` — add LangFuse toggle

---

## Task 1: Install Package + Verify Storage API

**Files:**
- Modify: `package.json` (via bun add)

- [ ] **Step 1: Install `@mastra/libsql`**

```bash
cd /Users/mayk/Projects/private/research-assistant
bun add @mastra/libsql
```

Expected: package added, no errors.

- [ ] **Step 2: Verify `LibSQLStore` API from TypeScript types**

```bash
cat node_modules/@mastra/libsql/dist/index.d.ts | head -80
```

Look for: `LibSQLStore` class, `init()`, `getStore()`, and the shape of the object returned by `getStore('memory')` (specifically `saveMessages`, `listMessages`, `getThreadById`). Record the exact method signatures — use them verbatim in Task 5.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(run7): add @mastra/libsql"
```

---

## Task 2: `maxRecentMessages` Data Model

**Files:**
- Modify: `src/shared/types/project.ts`
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrate.ts`
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`
- Modify: `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`

- [ ] **Step 1: Write failing tests for `maxRecentMessages`**

Open `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`.

Add at the end of the `describe("create"` block:

```typescript
it("sets maxRecentMessages to default 20 on create", async () => {
  const project = await repo.create({ name: "Defaults", folderPath: null });
  expect(project.maxRecentMessages).toBe(20);
});
```

Add a new `describe("maxRecentMessages"` block after the existing `linkFolder` block:

```typescript
describe("maxRecentMessages", () => {
  it("returns 20 as default for new projects", async () => {
    const project = await repo.create({ name: "Default Max", folderPath: null });
    expect(project.maxRecentMessages).toBe(20);
  });

  it("list() includes maxRecentMessages", async () => {
    await repo.create({ name: "Listed", folderPath: null });
    const list = await repo.list();
    expect(list[0].maxRecentMessages).toBe(20);
  });

  it("get() includes maxRecentMessages", async () => {
    const created = await repo.create({ name: "Fetched", folderPath: null });
    const found = await repo.get(created.id);
    expect(found?.maxRecentMessages).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test -- --reporter=verbose src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: FAIL — `maxRecentMessages` does not exist on `Project`.

- [ ] **Step 3: Update shared `Project` type**

In `src/shared/types/project.ts`, add the field:

```typescript
export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  maxRecentMessages: number;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 4: Add column to Drizzle schema**

In `src/main/db/schema.ts`, update the `projects` table:

```typescript
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  folderPath: text("folder_path"),
  maxRecentMessages: integer("max_recent_messages").notNull().default(20),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 5: Add idempotent migration**

In `src/main/db/migrate.ts`, add after the existing `folder_path` migration block:

```typescript
  // Run 7: add max_recent_messages — idempotent, ignore "duplicate column name" error
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN max_recent_messages INTEGER NOT NULL DEFAULT 20`);
  } catch {
    // column already exists — safe to ignore
  }
```

- [ ] **Step 6: Update `DrizzleProjectRepository`**

In `src/main/repositories/drizzle/DrizzleProjectRepository.ts`, update `create()` to include `maxRecentMessages`, update `rowToProject`:

```typescript
async create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  const now = this.monotonicNow();
  const project: Project = {
    id: crypto.randomUUID(),
    name: data.name,
    folderPath: data.folderPath ?? null,
    maxRecentMessages: data.maxRecentMessages ?? 20,
    createdAt: now,
    updatedAt: now,
  };
  await this.db.insert(projects).values({
    id: project.id,
    name: project.name,
    folderPath: project.folderPath,
    maxRecentMessages: project.maxRecentMessages,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
  return project;
}
```

Update `rowToProject`:

```typescript
private rowToProject = (row: typeof projects.$inferSelect): Project => ({
  id: row.id,
  name: row.name,
  folderPath: row.folderPath ?? null,
  maxRecentMessages: row.maxRecentMessages ?? 20,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
```

- [ ] **Step 7: Update `IProjectRepository` interface**

In `src/main/repositories/IProjectRepository.ts` (check current contents — `create` parameter type uses `Omit<Project, 'id'|'createdAt'|'updatedAt'>` so `maxRecentMessages` is now automatically included). No changes needed if the interface already uses `Project` type — confirm.

- [ ] **Step 8: Run tests — verify they pass**

```bash
bun run test -- --reporter=verbose src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: all tests PASS including the new `maxRecentMessages` tests.

- [ ] **Step 9: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types/project.ts src/main/db/schema.ts src/main/db/migrate.ts \
  src/main/repositories/drizzle/DrizzleProjectRepository.ts \
  src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
git commit -m "feat(run7): add maxRecentMessages to projects schema and repo"
```

---

## Task 3: `langfuseEnabled` Settings

**Files:**
- Modify: `src/main/services/SettingsService.ts`
- Modify: `src/main/services/__tests__/SettingsService.test.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Write failing tests for `langfuseEnabled`**

In `src/main/services/__tests__/SettingsService.test.ts`, add to the `getSettings` describe block:

```typescript
it("returns langfuseEnabled false when no settings file exists", async () => {
  const settings = await service.getSettings();
  expect(settings.langfuseEnabled).toBe(false);
});
```

Add to the `saveSettings + getSettings round-trip` describe block:

```typescript
it("saves and retrieves langfuseEnabled true", async () => {
  await service.saveSettings({ langfuseEnabled: true });
  const settings = await service.getSettings();
  expect(settings.langfuseEnabled).toBe(true);
});

it("langfuseEnabled defaults to false when missing from stored JSON", async () => {
  // Save without langfuseEnabled to simulate old settings file
  await service.saveSettings({ openrouterApiKey: "sk-or-test", model: "anthropic/claude-sonnet-4-6" });
  const settings = await service.getSettings();
  expect(settings.langfuseEnabled).toBe(false);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test -- --reporter=verbose src/main/services/__tests__/SettingsService.test.ts
```

Expected: FAIL — `langfuseEnabled` does not exist.

- [ ] **Step 3: Update `SettingsService`**

In `src/main/services/SettingsService.ts`, update the types and logic:

```typescript
export interface AppSettings {
  openrouterApiKey: string | null;
  model: string;
  langfuseEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  openrouterApiKey: null,
  model: "anthropic/claude-sonnet-4-6",
  langfuseEnabled: false,
};

interface StoredSettings {
  encryptedApiKey?: string;
  model?: string;
  langfuseEnabled?: boolean;
}
```

In `getSettings()`, update the return statement to include the new field:

```typescript
return {
  openrouterApiKey,
  model: stored.model ?? DEFAULT_SETTINGS.model,
  langfuseEnabled: stored.langfuseEnabled ?? false,
};
```

In `saveSettings()`, update `StoredSettings` construction:

```typescript
const stored: StoredSettings = {
  model: next.model,
  langfuseEnabled: next.langfuseEnabled,
};
if (encryptedApiKey !== undefined) stored.encryptedApiKey = encryptedApiKey;
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test -- --reporter=verbose src/main/services/__tests__/SettingsService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Update `GET_SETTINGS` IPC handler**

In `src/main/ipc-handlers.ts`, update the `GET_SETTINGS` handler to expose `langfuseEnabled`:

```typescript
ipcMain.handle(IPC.GET_SETTINGS, async () => {
  const settings = await settingsService.getSettings();
  return {
    hasApiKey: settings.openrouterApiKey !== null && settings.openrouterApiKey !== "",
    openrouterApiKey: settings.openrouterApiKey,
    model: settings.model,
    langfuseEnabled: settings.langfuseEnabled,
  };
});
```

Update `SAVE_SETTINGS` to accept and validate `langfuseEnabled`:

```typescript
ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid payload");
  }
  const p = payload as Record<string, unknown>;
  if ("model" in p && typeof p.model !== "string") {
    throw new Error("model must be a string");
  }
  if (
    "openrouterApiKey" in p &&
    p.openrouterApiKey !== null &&
    typeof p.openrouterApiKey !== "string"
  ) {
    throw new Error("openrouterApiKey must be a string or null");
  }
  if ("langfuseEnabled" in p && typeof p.langfuseEnabled !== "boolean") {
    throw new Error("langfuseEnabled must be a boolean");
  }
  await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);
  if ("model" in p) {
    sessions.clear();
  }
});
```

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/SettingsService.ts \
  src/main/services/__tests__/SettingsService.test.ts \
  src/main/ipc-handlers.ts
git commit -m "feat(run7): add langfuseEnabled to settings"
```

---

## Task 4: `model-factory.ts`

**Files:**
- Create: `src/main/agent/model-factory.ts`
- Create: `src/main/agent/__tests__/model-factory.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/__tests__/model-factory.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBaseModel = {
  id: "anthropic/claude-sonnet-4-6",
  provider: "openrouter",
  api: "openai-completions",
  baseUrl: "https://openrouter.ai/api/v1",
  headers: { "HTTP-Referer": "https://example.com" },
};

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue(mockBaseModel),
}));

const { createModel } = await import("../model-factory");

describe("createModel", () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;
  });

  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;
  });

  it("returns base openrouter model when langfuseEnabled is false", () => {
    const model = createModel("anthropic/claude-sonnet-4-6", false);
    expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("returns base openrouter model when langfuseEnabled true but keys missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("LangFuse keys"));
    warnSpy.mockRestore();
  });

  it("overrides baseUrl to LangFuse proxy when enabled and keys present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model?.baseUrl).toContain("cloud.langfuse.com");
    expect(model?.baseUrl).toContain("/api/proxy/openai/v1");
  });

  it("includes LangFuse headers when proxy active", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel("anthropic/claude-sonnet-4-6", true) as typeof mockBaseModel;
    expect(model.headers["x-langfuse-public-key"]).toBe("pk-test");
    expect(model.headers["x-langfuse-secret-key"]).toBe("sk-test");
    expect(model.headers["x-langfuse-baseurl"]).toBe("https://openrouter.ai/api/v1");
  });

  it("uses custom LANGFUSE_HOST when provided", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://my-langfuse.example.com";
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model?.baseUrl).toContain("my-langfuse.example.com");
  });

  it("throws when model ID is not found in registry", () => {
    const { getModel } = await import("@mariozechner/pi-ai");
    vi.mocked(getModel).mockReturnValueOnce(undefined);
    expect(() => createModel("unknown/model", false)).toThrow("Unknown model");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test -- --reporter=verbose src/main/agent/__tests__/model-factory.test.ts
```

Expected: FAIL — `model-factory` module not found.

- [ ] **Step 3: Implement `model-factory.ts`**

Create `src/main/agent/model-factory.ts`:

```typescript
import { getModel } from "@mariozechner/pi-ai";

/**
 * Creates a Pi model object for use in AgentSession.
 * When langfuseEnabled=true and LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY env vars are set,
 * overrides baseUrl to route through LangFuse proxy → OpenRouter.
 * Falls back silently to direct OpenRouter if keys are missing.
 *
 * Verify LangFuse proxy header names against docs if behaviour is unexpected:
 * https://langfuse.com/docs/openai/proxy
 */
export function createModel(
  modelId: string,
  langfuseEnabled: boolean,
): ReturnType<typeof getModel> {
  const base = getModel("openrouter", modelId);
  if (!base) {
    throw new Error(`Unknown model: ${modelId}. Ensure it is registered in pi-ai's openrouter registry.`);
  }

  if (!langfuseEnabled) return base;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.warn("[model-factory] LangFuse keys missing — using direct OpenRouter");
    return base;
  }

  const host = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";

  return {
    ...base,
    baseUrl: `${host}/api/proxy/openai/v1`,
    headers: {
      ...(base as { headers?: Record<string, string> }).headers,
      "x-langfuse-public-key": publicKey,
      "x-langfuse-secret-key": secretKey,
      "x-langfuse-baseurl": "https://openrouter.ai/api/v1",
    },
  } as ReturnType<typeof getModel>;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test -- --reporter=verbose src/main/agent/__tests__/model-factory.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/model-factory.ts src/main/agent/__tests__/model-factory.test.ts
git commit -m "feat(run7): add model-factory with LangFuse proxy support"
```

---

## Task 5: `MemoryManager` Service

**Files:**
- Create: `src/main/services/MemoryManager.ts`
- Modify: `src/main/di/tokens.ts`

> **Before coding:** check the TypeScript types from `node_modules/@mastra/libsql/dist/index.d.ts`.
> Confirm the exact shape of the object returned by `store.getStore('memory')` — specifically:
> - How to save messages: `saveMessages({ messages, threadId, resourceId })` or different shape?
> - How to list messages: `listMessages({ threadId, perPage })` or `getMessages(...)`?
> - Message shape fields: `id`, `role`, `content`, `threadId`, `resourceId`, `createdAt`?
> Adjust the implementation below to match the actual types if they differ.

- [ ] **Step 1: Add DI token**

In `src/main/di/tokens.ts`, add:

```typescript
import type { IMemoryManager } from "../services/MemoryManager";

// ... existing tokens ...
export const MEMORY_MANAGER_TOKEN: InjectionToken<IMemoryManager> = Symbol("IMemoryManager");
```

- [ ] **Step 2: Implement `MemoryManager`**

Create `src/main/services/MemoryManager.ts`:

```typescript
import { complete, getModel } from "@mariozechner/pi-ai";
import { LibSQLStore } from "@mastra/libsql";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";
import type { SettingsService } from "./SettingsService";
import { join } from "node:path";

/** Model used for Observer compression — haiku for cost. Not user-configurable in Run 7. */
const COMPRESSION_MODEL_ID = "anthropic/claude-haiku-4-5";

/** Estimated tokens above which Observer fires and compresses. */
const OBSERVER_TOKEN_THRESHOLD = 30_000;

/** Rough chars-to-tokens ratio (4 chars ≈ 1 token). */
const CHARS_PER_TOKEN = 4;

export interface MemoryContext {
  /** Compressed summary from past sessions. Empty string on first use. */
  summary: string;
  /** Last N raw conversation turns for history injection. */
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface IMemoryManager {
  buildContext(projectId: string, maxRecent: number): Promise<MemoryContext>;
  save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void>;
}

@injectable()
export class MemoryManager implements IMemoryManager {
  private store: LibSQLStore | null = null;
  private readonly dbPath: string;

  constructor(
    @inject(USER_DATA_PATH_TOKEN) userDataPath: string,
    // settingsService injected for lazy API key reads during compression
    private readonly settingsService: SettingsService,
  ) {
    this.dbPath = join(userDataPath, "research-assistant.db");
  }

  private async getStore(): Promise<LibSQLStore> {
    if (!this.store) {
      this.store = new LibSQLStore({
        id: "research-assistant-memory",
        url: `file:${this.dbPath}`,
      });
      await this.store.init();
    }
    return this.store;
  }

  async buildContext(projectId: string, maxRecent: number): Promise<MemoryContext> {
    const store = await this.getStore();
    const memoryStore = await store.getStore("memory");

    // Retrieve summary stored as a special thread (projectId + "-summary")
    let summary = "";
    try {
      const summaryThread = await memoryStore?.getThreadById({
        threadId: `${projectId}-summary`,
      });
      summary = (summaryThread?.metadata as { summary?: string })?.summary ?? "";
    } catch {
      // No summary thread yet — first session for this project
    }

    // Retrieve recent messages for history injection
    let recentMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      // NOTE: verify exact shape of listMessages return value against @mastra/libsql types
      const result = await memoryStore?.listMessages({
        threadId: projectId,
        perPage: maxRecent,
      });
      const msgs = (result as { messages?: Array<{ role: string; content: unknown }> })
        ?.messages ?? [];
      recentMessages = msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
    } catch {
      // No messages yet
    }

    return { summary, recentMessages };
  }

  async save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void> {
    const store = await this.getStore();
    const memoryStore = await store.getStore("memory");

    const messages = turns.map((t) => ({
      id: crypto.randomUUID(),
      role: t.role,
      content: t.content,
      threadId: projectId,
      resourceId: projectId,
      createdAt: new Date(),
      // NOTE: verify exact required fields for saveMessages against @mastra/libsql types
    }));

    await memoryStore?.saveMessages({ messages });

    // Fire Observer check async — does not block the response
    void this.maybeCompress(projectId, store);
  }

  /**
   * Observer: when estimated token count exceeds threshold, compress all messages
   * into a summary using haiku and store it. Old messages are kept — summary is
   * injected at session start via buildContext().
   *
   * Non-blocking: called with void, failures are logged but do not surface to user.
   */
  private async maybeCompress(projectId: string, store: LibSQLStore): Promise<void> {
    try {
      const memoryStore = await store.getStore("memory");
      const result = await memoryStore?.listMessages({ threadId: projectId, perPage: false });
      const msgs =
        (result as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];

      const totalChars = msgs.reduce(
        (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 50),
        0,
      );
      const estimatedTokens = totalChars / CHARS_PER_TOKEN;

      if (estimatedTokens < OBSERVER_TOKEN_THRESHOLD) return;

      const settings = await this.settingsService.getSettings();
      if (!settings.openrouterApiKey) return;

      const model = getModel("openrouter", COMPRESSION_MODEL_ID);
      if (!model) return;

      const conversationText = msgs
        .map(
          (m) =>
            `${m.role === "user" ? "User" : "Assistant"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
        )
        .join("\n\n");

      const compressionResult = await complete(
        model,
        {
          systemPrompt:
            "You compress conversation history into a concise context summary. Preserve key facts, decisions, user preferences, and project context. Output plain text — no headers, no lists, just prose.",
          messages: [
            {
              role: "user",
              content: `Compress this conversation into a concise summary (max 500 words):\n\n${conversationText}`,
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey: settings.openrouterApiKey },
      );

      const summaryText =
        (compressionResult.content.find((c) => "text" in c) as { text?: string })?.text ?? "";

      if (!summaryText) return;

      // Store summary as metadata on a dedicated summary thread
      // NOTE: verify saveThread / updateThread API against @mastra/libsql types
      await memoryStore?.saveThread?.({
        id: `${projectId}-summary`,
        resourceId: projectId,
        title: "Memory Summary",
        metadata: { summary: summaryText },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error("[MemoryManager] Observer compression failed:", err);
    }
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Fix any type errors from the LibSQLStore API mismatch by checking the actual types from `node_modules/@mastra/libsql/dist/index.d.ts`. Adjust method calls to match the real signatures.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/MemoryManager.ts src/main/di/tokens.ts
git commit -m "feat(run7): MemoryManager service — Mastra LibSQLStore + Observer compression"
```

---

## Task 6: `MemoryManager` Tests

**Files:**
- Create: `src/main/services/__tests__/MemoryManager.test.ts`

- [ ] **Step 1: Write tests**

Create `src/main/services/__tests__/MemoryManager.test.ts`:

```typescript
import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @mastra/libsql
const mockMemoryStore = {
  getThreadById: vi.fn(),
  listMessages: vi.fn(),
  saveMessages: vi.fn(),
  saveThread: vi.fn(),
};

const mockStore = {
  init: vi.fn().mockResolvedValue(undefined),
  getStore: vi.fn().mockResolvedValue(mockMemoryStore),
};

vi.mock("@mastra/libsql", () => ({
  LibSQLStore: vi.fn().mockImplementation(() => mockStore),
}));

// Mock pi-ai complete + getModel
vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ id: "anthropic/claude-haiku-4-5", provider: "openrouter" }),
  complete: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Compressed summary." }],
  }),
}));

vi.mock("electron", () => ({}));

const { MemoryManager } = await import("../MemoryManager");

function makeSettingsService(apiKey: string | null = "sk-or-test") {
  return {
    getSettings: vi.fn().mockResolvedValue({
      openrouterApiKey: apiKey,
      model: "anthropic/claude-sonnet-4-6",
      langfuseEnabled: false,
    }),
  };
}

describe("MemoryManager", () => {
  let manager: InstanceType<typeof MemoryManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryStore.getThreadById.mockResolvedValue(null);
    mockMemoryStore.listMessages.mockResolvedValue({ messages: [] });
    mockMemoryStore.saveMessages.mockResolvedValue(undefined);
    mockMemoryStore.saveThread.mockResolvedValue(undefined);

    manager = new MemoryManager("/tmp/test-userdata", makeSettingsService() as never);
  });

  describe("buildContext()", () => {
    it("returns empty summary and recentMessages on first use (no history)", async () => {
      const ctx = await manager.buildContext("project-1", 20);
      expect(ctx.summary).toBe("");
      expect(ctx.recentMessages).toEqual([]);
    });

    it("returns summary from summary thread metadata", async () => {
      mockMemoryStore.getThreadById.mockResolvedValue({
        metadata: { summary: "Past context about the project." },
      });
      const ctx = await manager.buildContext("project-1", 20);
      expect(ctx.summary).toBe("Past context about the project.");
    });

    it("returns up to maxRecent recent messages", async () => {
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [
          { role: "user", content: "Hello", createdAt: new Date() },
          { role: "assistant", content: "Hi there!", createdAt: new Date() },
        ],
      });
      const ctx = await manager.buildContext("project-1", 20);
      expect(ctx.recentMessages).toHaveLength(2);
      expect(ctx.recentMessages[0]).toEqual({ role: "user", content: "Hello" });
      expect(ctx.recentMessages[1]).toEqual({ role: "assistant", content: "Hi there!" });
    });

    it("filters out non-user/assistant messages", async () => {
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [
          { role: "system", content: "System message" },
          { role: "user", content: "User message" },
        ],
      });
      const ctx = await manager.buildContext("project-1", 20);
      expect(ctx.recentMessages).toHaveLength(1);
      expect(ctx.recentMessages[0].role).toBe("user");
    });

    it("returns empty context when storage throws", async () => {
      mockMemoryStore.getThreadById.mockRejectedValue(new Error("DB error"));
      mockMemoryStore.listMessages.mockRejectedValue(new Error("DB error"));
      const ctx = await manager.buildContext("project-1", 20);
      expect(ctx.summary).toBe("");
      expect(ctx.recentMessages).toEqual([]);
    });
  });

  describe("save()", () => {
    it("calls saveMessages with the provided turns", async () => {
      await manager.save("project-1", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ]);
      expect(mockMemoryStore.saveMessages).toHaveBeenCalledOnce();
      const call = mockMemoryStore.saveMessages.mock.calls[0][0] as { messages: unknown[] };
      expect(call.messages).toHaveLength(2);
    });

    it("does not throw when saveMessages fails", async () => {
      mockMemoryStore.saveMessages.mockRejectedValue(new Error("DB error"));
      await expect(
        manager.save("project-1", [{ role: "user", content: "Hello" }]),
      ).resolves.toBeUndefined();
    });
  });

  describe("Observer compression", () => {
    it("does not call complete() when token count is below threshold", async () => {
      const { complete } = await import("@mariozechner/pi-ai");
      mockMemoryStore.listMessages.mockResolvedValue({
        messages: [{ role: "user", content: "Short message", createdAt: new Date() }],
      });
      await manager.save("project-1", [{ role: "user", content: "Hi" }]);
      // Allow async compression to settle
      await new Promise((r) => setTimeout(r, 10));
      expect(complete).not.toHaveBeenCalled();
    });

    it("skips compression when no API key configured", async () => {
      const managerNoKey = new MemoryManager(
        "/tmp/test-userdata",
        makeSettingsService(null) as never,
      );
      const { complete } = await import("@mariozechner/pi-ai");
      // Simulate large message count
      const bigMessages = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(1500), // 1500 chars ≈ 375 tokens each; 100 msgs ≈ 37,500 tokens
        createdAt: new Date(),
      }));
      mockMemoryStore.listMessages.mockResolvedValue({ messages: bigMessages });
      await managerNoKey.save("project-1", [{ role: "user", content: "Hi" }]);
      await new Promise((r) => setTimeout(r, 10));
      expect(complete).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun run test -- --reporter=verbose src/main/services/__tests__/MemoryManager.test.ts
```

Expected: all tests PASS. Fix any failures by adjusting mock shapes to match actual LibSQLStore API discovered in Task 1 Step 2.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/__tests__/MemoryManager.test.ts
git commit -m "test(run7): MemoryManager unit tests"
```

---

## Task 7: Register `MemoryManager` in Bootstrap

**Files:**
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Register singleton in DI container**

In `src/main/bootstrap.ts`, add the import and register call:

```typescript
import { MEMORY_MANAGER_TOKEN } from "./di/tokens";
import { MemoryManager } from "./services/MemoryManager";
```

Add after existing `registerSingleton` calls (before the `homeService` block):

```typescript
appContainer.registerSingleton(MemoryManager);
appContainer.registerInstance(
  MEMORY_MANAGER_TOKEN,
  appContainer.resolve(MemoryManager),
);
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/bootstrap.ts
git commit -m "feat(run7): register MemoryManager in DI container"
```

---

## Task 8: Wire `AgentSession` with Memory + LangFuse

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Write failing tests for new session options**

In `src/main/agent/session.test.ts`, add a mock for `model-factory`:

```typescript
vi.mock("./model-factory", () => ({
  createModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));
```

Add mock for `MemoryManager`:

```typescript
function makeMemoryManager() {
  return {
    buildContext: vi.fn().mockResolvedValue({ summary: "", recentMessages: [] }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}
```

Update the `beforeEach` session constructor to include the new required options:

```typescript
session = new AgentSession({
  win,
  messageService: messageService as never,
  homeService: makeHomeService() as never,
  researchService: makeResearchService() as never,
  memoryManager: makeMemoryManager() as never,
  initialMemoryContext: { summary: "", recentMessages: [] },
  projectId: "p-1",
  projectName: "Test Project",
  folderPath: null,
  apiKey: "sk-or-test",
  model: "anthropic/claude-sonnet-4-6",
  isFirstRun: false,
  systemContext: "",
  langfuseEnabled: false,
});
```

Add new test for memory saving on `agent_end`:

```typescript
describe("memory saving", () => {
  it("calls memoryManager.save() with user + assistant content on agent_end", async () => {
    const memoryManager = makeMemoryManager();
    const localSession = new AgentSession({
      win: makeWin() as never,
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", recentMessages: [] },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
    });

    await localSession.send("my question");
    await triggerEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "answer" } });
    await triggerEvent({ type: "agent_end", messages: [] });

    expect(memoryManager.save).toHaveBeenCalledWith("p-1", [
      { role: "user", content: "my question" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("does not call memoryManager.save() when assistant content is empty", async () => {
    const memoryManager = makeMemoryManager();
    const localSession = new AgentSession({
      win: makeWin() as never,
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: memoryManager as never,
      initialMemoryContext: { summary: "", recentMessages: [] },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
    });

    await triggerEvent({ type: "agent_end", messages: [] });
    expect(memoryManager.save).not.toHaveBeenCalled();
  });

  it("injects memory summary into system prompt when non-empty", async () => {
    const { Agent } = await import("@mariozechner/pi-agent-core");
    new AgentSession({
      win: makeWin() as never,
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: makeMemoryManager() as never,
      initialMemoryContext: {
        summary: "Past context: user prefers TypeScript.",
        recentMessages: [],
      },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
    });
    const lastCall = vi.mocked(Agent).mock.calls.at(-1);
    const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
      ?.systemPrompt;
    expect(prompt).toContain("Past context: user prefers TypeScript.");
  });

  it("injects recent messages as conversation history block when non-empty", async () => {
    const { Agent } = await import("@mariozechner/pi-agent-core");
    new AgentSession({
      win: makeWin() as never,
      messageService: makeMessageService() as never,
      homeService: makeHomeService() as never,
      researchService: makeResearchService() as never,
      memoryManager: makeMemoryManager() as never,
      initialMemoryContext: {
        summary: "",
        recentMessages: [
          { role: "user", content: "Hello from last session" },
          { role: "assistant", content: "Hi there from last session" },
        ],
      },
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: false,
      systemContext: "",
      langfuseEnabled: false,
    });
    const lastCall = vi.mocked(Agent).mock.calls.at(-1);
    const prompt = (lastCall?.[0] as { initialState: { systemPrompt: string } })?.initialState
      ?.systemPrompt;
    expect(prompt).toContain("Hello from last session");
    expect(prompt).toContain("Hi there from last session");
    expect(prompt).toContain("<conversation_history>");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test -- --reporter=verbose src/main/agent/session.test.ts
```

Expected: FAIL — new options don't exist yet.

- [ ] **Step 3: Update `AgentSession`**

Replace `src/main/agent/session.ts` entirely:

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { HomeService } from "../services/HomeService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ResearchService } from "../services/ResearchService";
import { createModel } from "./model-factory";
import { createAgentTools } from "./tools";

const FIRST_RUN_PROMPT = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;

const BASE_SYSTEM_PROMPT = "You are a helpful research assistant.";

function formatConversationHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  if (messages.length === 0) return "";
  const lines = messages.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
  );
  return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
}

export interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryManager: IMemoryManager;
  initialMemoryContext: MemoryContext;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  apiKey: string;
  model: string;
  isFirstRun: boolean;
  systemContext?: string;
  langfuseEnabled: boolean;
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly memoryManager: IMemoryManager;
  private readonly projectId: string;
  private assistantContent = "";
  private lastUserContent = "";

  constructor({
    win,
    messageService,
    homeService,
    researchService,
    memoryManager,
    initialMemoryContext,
    projectId,
    projectName,
    folderPath,
    apiKey,
    model,
    isFirstRun,
    systemContext = "",
    langfuseEnabled,
  }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.memoryManager = memoryManager;
    this.projectId = projectId;

    const homePath = homeService.getHomePath();
    const historyBlock = formatConversationHistory(initialMemoryContext.recentMessages);

    const systemPrompt = [
      isFirstRun ? FIRST_RUN_PROMPT : BASE_SYSTEM_PROMPT,
      initialMemoryContext.summary,
      historyBlock,
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: createModel(model, langfuseEnabled),
      },
      getApiKey: async () => apiKey,
      beforeToolCall: async (ctx) => {
        const allowed = new Set(this.agent.state.tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });

    this.agent.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      startResearchFn: (query) =>
        researchService.startResearch(projectId, projectName, query, folderPath),
    });

    this.agent.subscribe(async (event) => {
      try {
        const e = event as {
          type: string;
          assistantMessageEvent?: { type: string; delta: string };
          messages?: unknown[];
        };

        if (e.type === "message_update") {
          const ae = e.assistantMessageEvent;
          if (ae?.type === "text_delta") {
            this.assistantContent += ae.delta;
            this.win.webContents.send(IPC.MESSAGE_CHUNK, ae.delta);
          }
        } else if (e.type === "agent_end") {
          if (this.assistantContent) {
            await this.messageService.addMessage({
              projectId: this.projectId,
              role: "assistant",
              content: this.assistantContent,
            });
            // Save turn to Mastra memory for cross-session persistence
            await this.memoryManager.save(this.projectId, [
              { role: "user", content: this.lastUserContent },
              { role: "assistant", content: this.assistantContent },
            ]);
            this.assistantContent = "";
            this.lastUserContent = "";
          }
          this.win.webContents.send(IPC.MESSAGE_DONE);
        }
      } catch (err) {
        console.error("[AgentSession] subscriber error:", err);
        this.win.webContents.send(IPC.MESSAGE_DONE);
      }
    });
  }

  async send(content: string): Promise<void> {
    this.lastUserContent = content;
    await this.messageService.addMessage({
      projectId: this.projectId,
      role: "user",
      content,
    });
    await this.agent.prompt(content);
  }

  queueFollowUp(content: string): void {
    this.agent.followUp({ role: "user", content, timestamp: Date.now() });
  }

  abort(): void {
    this.agent.abort();
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test -- --reporter=verbose src/main/agent/session.test.ts
```

Expected: all tests PASS. Fix any mock-shape mismatches.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat(run7): wire AgentSession with MemoryManager and createModel"
```

---

## Task 9: Wire IPC Handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Resolve `MemoryManager` and wire to `SEND_MESSAGE`**

In `src/main/ipc-handlers.ts`, add the import:

```typescript
import { MEMORY_MANAGER_TOKEN } from "./di/tokens";
import type { IMemoryManager } from "./services/MemoryManager";
```

In `registerIpcHandlers`, add resolution:

```typescript
const memoryManager = container.resolve<IMemoryManager>(MEMORY_MANAGER_TOKEN);
```

Update the session creation block inside `SEND_MESSAGE` to build memory context and pass new options:

```typescript
if (!sessions.has(projectId)) {
  const project = await projectService.getProject(projectId);
  const isFirstRun = await homeService.isFirstRun();
  const systemContext = await buildSystemContext(
    projectId,
    project.name,
    project.folderPath ?? undefined,
  );
  const initialMemoryContext = await memoryManager.buildContext(
    projectId,
    project.maxRecentMessages ?? 20,
  );
  sessions.set(
    projectId,
    new AgentSession({
      win,
      messageService,
      homeService,
      researchService,
      memoryManager,
      initialMemoryContext,
      projectId,
      projectName: project.name,
      folderPath: project.folderPath,
      apiKey: settings.openrouterApiKey,
      model: settings.model,
      isFirstRun,
      systemContext,
      langfuseEnabled: settings.langfuseEnabled,
    }),
  );
}
```

Update `SAVE_SETTINGS` handler — also clear sessions when `langfuseEnabled` changes (same as model change):

```typescript
await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);
if ("model" in p || "langfuseEnabled" in p) {
  sessions.clear();
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run all tests**

```bash
bun run test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(run7): wire MemoryManager through IPC handlers to AgentSession"
```

---

## Task 10: Settings UI — LangFuse Toggle

**Files:**
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add toggle to `SettingsModal`**

In `src/renderer/components/settings/SettingsModal.tsx`, add `FormControlLabel` and `Switch` imports:

```typescript
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
```

Add `langfuseEnabled` state:

```typescript
const [langfuseEnabled, setLangfuseEnabled] = useState(false);
```

Update `useEffect` to load `langfuseEnabled`:

```typescript
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
```

Update `handleSave` to include `langfuseEnabled`:

```typescript
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
```

Add the toggle in `DialogContent`, after the model `FormControl`:

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx
git commit -m "feat(run7): add LangFuse tracing toggle to SettingsModal"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Lint + format**

```bash
bun run check
```

Expected: clean. Fix any Biome issues reported.

- [ ] **Step 3: Full test suite**

```bash
bun run test
```

Expected: all tests PASS, >90% coverage on new files.

- [ ] **Step 4: Launch app and smoke test**

```bash
bun run dev -- --remote-debugging-port=9222
```

Verify:
1. App launches without errors
2. Settings modal shows LangFuse toggle
3. Creating a project and sending a message works
4. Check console for `[MemoryManager]` errors — should be none
5. Check `~/.research-assistant/audit.log` still works (safe_bash not regressed)

- [ ] **Step 5: Update roadmap in Obsidian**

Update `04 Resources/AI/Research Assistant - Redefined Roadmap (Post-Requirements Refinement).md` — mark Run 7 as done, Run 8 as next.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(run7): final lint + typecheck pass"
```
