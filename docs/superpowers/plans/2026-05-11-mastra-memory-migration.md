# Mastra Observational Memory Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Replace custom `LibSQLStore` + `MemoryCompressionService` with Mastra's built-in `Memory` class from `@mastra/memory`, which provides automatic Observational Memory (Observer/Reflector compression).

**Architecture:** `IMemoryManager` interface stays unchanged — the swap is entirely internal to `MemoryManager`. Mastra's `Memory` class reads/writes the same LibSQL tables, so message data is preserved. Observational Memory replaces our custom compression with automatic token-threshold-based summarization.

**Tech Stack:** TypeScript, `@mastra/memory` v1.17.5, `@mastra/libsql`, `@mastra/core`, DI via TSyringe

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/services/MemoryManager.ts` | Refactored to use Mastra `Memory` class. Uses `getContext()` for `buildContext()`. Triggers `omEngine.observe()` in `save()`. |
| `src/main/services/MemoryCompressionService.ts` | **Deleted.** Mastra handles compression internally. |
| `src/main/bootstrap.ts` | Update DI: remove `MemoryCompressionService` injection from `MemoryManager`. |
| `src/main/services/__tests__/MemoryManager.test.ts` | Updated tests for Mastra `Memory` backend. |

---

## Task 1: Move `extractTextContent` to MemoryManager

**Files:**
- Modify: `src/main/services/MemoryManager.ts`
- Modify: `src/main/services/MemoryCompressionService.ts`

**Why:** `extractTextContent` is needed by `MemoryManager` to convert `MastraDBMessage` content to plain strings. `MemoryCompressionService` will be deleted in Task 3.

- [ ] **Step 1: Copy `extractTextContent` into MemoryManager**

Add the function directly in `MemoryManager.ts` (before the class definition):

```typescript
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  const v2 = content as { format?: number; parts?: Array<{ type?: string; text?: string }> };
  if (v2?.format === 2 && Array.isArray(v2.parts)) {
    return v2.parts
      .filter((p): p is { type: "text"; text: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }

  return JSON.stringify(content);
}
```

- [ ] **Step 2: Remove `extractTextContent` import from MemoryManager**

Change the import at the top of `MemoryManager.ts`:

```typescript
// Before:
import { extractTextContent, MemoryCompressionService } from "./MemoryCompressionService";

// After:
import { MemoryCompressionService } from "./MemoryCompressionService";
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/MemoryManager.ts
git commit -m "refactor: inline extractTextContent in MemoryManager for upcoming Mastra migration"
```

---

## Task 2: Refactor MemoryManager to use Mastra Memory class

**Files:**
- Modify: `src/main/services/MemoryManager.ts`
- Test: `src/main/services/__tests__/MemoryManager.test.ts`

### Step 1: Refactor constructor and fields

Replace the `LibSQLStore` init logic with `Memory` from `@mastra/memory`:

```typescript
import { join } from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";

export interface MemoryContext {
  summary: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  const v2 = content as { format?: number; parts?: Array<{ type?: string; text?: string }> };
  if (v2?.format === 2 && Array.isArray(v2.parts)) {
    return v2.parts
      .filter((p): p is { type: "text"; text: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return JSON.stringify(content);
}

export interface IMemoryManager {
  buildContext(projectId: string): Promise<MemoryContext>;
  save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void>;
}

@injectable()
export class MemoryManager implements IMemoryManager {
  private initPromise: Promise<Memory> | null = null;
  private readonly dbPath: string;

  constructor(@inject(USER_DATA_PATH_TOKEN) userDataPath: string) {
    this.dbPath = join(userDataPath, "research-assistant.db");
  }

  private async getMemory(): Promise<Memory> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const storage = new LibSQLStore({
          id: "research-assistant-memory",
          url: `file:${this.dbPath}`,
        });
        await storage.init();

        const memory = new Memory({
          storage,
          options: {
            lastMessages: 25,
            observationalMemory: {
              enabled: true,
              scope: "thread",
              temporalMarkers: true,
              model: "ollama/gemma4:31b-cloud",
              observation: {
                messageTokens: 30_000,
                bufferTokens: 0.2,
                bufferActivation: 0.8,
                modelSettings: { temperature: 0.3 },
              },
              reflection: {
                observationTokens: 60_000,
                modelSettings: { temperature: 0 },
              },
            },
          },
        });

        // Lazy-init the OM engine so first getContext() doesn't block
        void memory.omEngine;

        return memory;
      })();
    }
    return this.initPromise;
  }
```

### Step 2: Refactor `buildContext()`

Replace with `memory.getContext()`:

```typescript
  async buildContext(projectId: string): Promise<MemoryContext> {
    try {
      const memory = await this.getMemory();
      const ctx = await memory.getContext({
        threadId: projectId,
        memoryConfig: { lastMessages: 25 },
      });

      const summary = ctx.systemMessage ?? "";

      const recentMessages = ctx.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: extractTextContent(m.content),
        }));

      return { summary, recentMessages };
    } catch (err) {
      console.error("[MemoryManager] buildContext failed — returning empty context:", err);
      return { summary: "", recentMessages: [] };
    }
  }
```

### Step 3: Refactor `save()`

Use `saveMessages()` then manually trigger OM observation:

```typescript
  async save(
    projectId: string,
    turns: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<void> {
    try {
      const memory = await this.getMemory();

      const messages = turns.map((t) => ({
        id: crypto.randomUUID(),
        role: t.role as "user" | "assistant",
        content: {
          format: 2 as const,
          parts: [{ type: "text" as const, text: t.content }],
        },
        threadId: projectId,
        resourceId: projectId,
        createdAt: new Date(),
      }));

      await memory.saveMessages({ messages });

      // Trigger OM observation manually — we're not using Mastra Agent,
      // so the OM processor pipeline doesn't run automatically.
      // Observation only fires at token threshold, so this is non-blocking
      // on most turns.
      const omEngine = await memory.omEngine;
      if (omEngine) {
        await omEngine.observe({ threadId: projectId });
      }
    } catch (err) {
      console.error("[MemoryManager] save failed:", err);
    }
  }
}
```

### Step 4: Update tests

Replace the `LibSQLStore` mock with a `Memory` mock:

```typescript
// Remove LibSQLStore mock, add Memory mock
const mockOmEngine = {
  observe: vi.fn().mockResolvedValue({ observed: false, reflected: false, record: {} }),
};

const mockMemory = {
  getContext: vi.fn().mockResolvedValue({
    systemMessage: "",
    messages: [],
    hasObservations: false,
    omRecord: null,
    continuationMessage: undefined,
    otherThreadsContext: undefined,
  }),
  saveMessages: vi.fn().mockResolvedValue({ messages: [] }),
  omEngine: Promise.resolve(mockOmEngine),
};

vi.mock("@mastra/memory", () => ({
  Memory: vi.fn().mockImplementation(() => mockMemory),
}));
```

Update all tests to use `mockMemory` instead of `mockMemoryStore`.

Add test for OM observation trigger:

```typescript
it("triggers OM observation after saving messages", async () => {
  const manager = new MemoryManager("/tmp/test-data");
  await manager.save("project-1", [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
  ]);

  expect(mockMemory.saveMessages).toHaveBeenCalled();
  expect(mockOmEngine.observe).toHaveBeenCalledWith({ threadId: "project-1" });
});
```

Add test for `getContext` returning observations:

```typescript
it("returns observations from getContext as summary", async () => {
  mockMemory.getContext.mockResolvedValue({
    systemMessage: "The user likes TypeScript.",
    messages: [
      { role: "user", content: { format: 2, parts: [{ type: "text", text: "Hello" }] }, id: "1", threadId: "project-1", resourceId: "project-1", createdAt: new Date() },
    ],
    hasObservations: true,
    omRecord: { activeObservations: "The user likes TypeScript." },
    continuationMessage: undefined,
    otherThreadsContext: undefined,
  });

  const manager = new MemoryManager("/tmp/test-data");
  const ctx = await manager.buildContext("project-1");

  expect(ctx.summary).toBe("The user likes TypeScript.");
  expect(ctx.recentMessages).toHaveLength(1);
  expect(ctx.recentMessages[0].content).toBe("Hello");
});
```

### Step 5: Run tests

Run: `bun test src/main/services/__tests__/MemoryManager.test.ts`
Expected: All tests pass

### Step 6: Commit

```bash
git add src/main/services/MemoryManager.ts src/main/services/__tests__/MemoryManager.test.ts
git commit -m "feat: refactor MemoryManager to use Mastra Memory with Observational Memory"
```

---

## Task 3: Delete MemoryCompressionService

**Files:**
- Delete: `src/main/services/MemoryCompressionService.ts`

- [ ] **Step 1: Delete the file**

```bash
git rm src/main/services/MemoryCompressionService.ts
```

- [ ] **Step 2: Verify no remaining imports**

Run: `grep -r "MemoryCompressionService" src/main/ --include="*.ts" | grep -v test`
Expected: Only `MemoryManager.ts` (already removed in Task 2) and `bootstrap.ts` (Task 4)

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: delete MemoryCompressionService — Mastra handles compression"
```

---

## Task 4: Update DI registration in bootstrap.ts

**Files:**
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Remove MemoryCompressionService from DI**

Find the registration of `MemoryCompressionService` in `bootstrap.ts` and remove it. Also update `MemoryManager` registration to remove the `MemoryCompressionService` parameter.

Before:
```typescript
import { MemoryCompressionService } from "./services/MemoryCompressionService";
import { type IMemoryManager, MemoryManager } from "./services/MemoryManager";
// ...
appContainer.register<IMemoryManager>(MEMORY_MANAGER_TOKEN, { useClass: MemoryManager });
```

After:
```typescript
import { type IMemoryManager, MemoryManager } from "./services/MemoryManager";
// ...
appContainer.register<IMemoryManager>(MEMORY_MANAGER_TOKEN, { useClass: MemoryManager });
```

Also remove the `MemoryCompressionService` import if it was only used for DI registration.

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/bootstrap.ts
git commit -m "refactor: update DI — remove MemoryCompressionService, simplify MemoryManager"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

- [ ] **Step 2: Run lint/format check**

Run: `bun run check`
Expected: Clean

- [ ] **Step 3: Run modified tests**

Run: `bun test src/main/services/__tests__/MemoryManager.test.ts`
Expected: All pass

- [ ] **Step 4: Run session tests (regression)**

Run: `bun test src/main/agent/session.test.ts`
Expected: All pass (AgentSession unchanged, only backend swapped)

- [ ] **Step 5: Commit verification results**

```bash
git commit --allow-empty -m "test: verify Mastra memory migration — all tests pass"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Replace `LibSQLStore` direct usage with Mastra `Memory` | Task 2 |
| Use `getContext()` for `buildContext()` | Task 2 |
| Trigger `omEngine.observe()` in `save()` | Task 2 |
| Keep `IMemoryManager` interface unchanged | Task 2 |
| Delete `MemoryCompressionService` | Task 3 |
| Update DI registration | Task 4 |
| OM config: `scope: 'thread'` | Task 2 |
| OM config: `lastMessages: 25` | Task 2 |
| OM config: model, temporalMarkers, buffering | Task 2 |
| Test coverage for new backend | Task 2, 5 |

## Risks

| Risk | Mitigation |
|---|---|
| Existing summaries not migrated | Mastra OM rebuilds them from messages over time. One-time cold start acceptable. |
| `@mastra/memory` API changes | Using installed v1.17.5. Pin version in package.json. |
| OM observation blocks on every save | Observation only fires at 30k token threshold. Most turns are non-blocking. |
| Tests failing due to electron mock | Run individually, not combined. Pre-existing issue. |
| `getContext()` returns only unobserved messages | Correct behavior — observed messages are in summary. Fallback `lastMessages: 25` for inactive OM. |
