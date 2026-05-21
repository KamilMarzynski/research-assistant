# Research Resumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the app closes mid-research, checkpoint the agent's conversation history after each LLM turn so that on restart the research resumes exactly where it left off rather than creating a duplicate entry.

**Architecture:** After every Pi agent `turn_end` event, serialize `agent.state.messages` + accumulated output to `workspace/<taskId>/checkpoint.json`. On startup, any task still `"in_progress"` is treated as orphaned: if a checkpoint exists, `ResearchService.resumeResearch()` recreates the agent with injected message history and calls `agent.continue()`; if no checkpoint exists, the task is marked `"interrupted"`. A new DB status `"interrupted"` distinguishes crashed tasks from genuinely failed ones and enables a UI retry button.

**Tech Stack:** TypeScript, Drizzle ORM + libsql (SQLite), `@mariozechner/pi-agent-core` Agent API, Node.js `fs/promises`, TSyringe DI, React + Scholar design system, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/main/db/schema.ts` | Add `"interrupted"` to tasks status enum |
| Modify | `src/main/db/migrate.ts` | Run 20: recreate tasks table with updated CHECK constraint |
| Modify | `src/main/services/TaskPersistenceService.ts` | Add `"interrupted"` to status types; add `markAllInProgressAsInterrupted()` |
| Create | `src/main/services/CheckpointService.ts` | `write` / `read` / `delete` checkpoint.json in task workspace |
| Create | `src/main/services/__tests__/CheckpointService.test.ts` | Unit tests for CheckpointService |
| Modify | `src/main/agent/worker-agent.ts` | Add `onTurnEnd` callback to `WorkerAgentConfig`; exclude from `WorkerAgentBase`; call in agent subscriber |
| Modify | `src/main/services/ResearchService.ts` | Inject `CheckpointService`; wire `onTurnEnd` in `_runResearch`; new `resumeResearch()` method |
| Modify | `src/main/services/__tests__/ResearchService.test.ts` | Tests for checkpoint writing + `resumeResearch` |
| Modify | `src/main/ipc/startup-tasks.ts` | Replace duplicate-creating resume with `resumeResearch()` |
| Modify | `src/main/bootstrap.ts` | Register `CheckpointService` as singleton |
| Modify | `src/renderer/components/layout/ResearchHistoryPanel.tsx` | Add `"interrupted"` status config + retry button |

---

## Task 1: Add "interrupted" DB status

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrate.ts`
- Modify: `src/main/services/TaskPersistenceService.ts`
- Test: `src/main/services/__tests__/ResearchService.test.ts` (TaskPersistenceService section at bottom)

- [ ] **Step 1: Write failing test for "interrupted" status round-trip**

Add to the `describe("TaskPersistenceService", ...)` block at the bottom of `src/main/services/__tests__/ResearchService.test.ts`:

```ts
it("allows 'interrupted' status via updateTaskStatus", async () => {
  const db = await createTestDb();
  const svc = new TaskPersistenceService(db, "/tmp/home");

  await db.insert(projects).values({
    id: "proj-a",
    name: "A",
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
  });
  await svc.saveTask({
    taskId: "t1",
    projectId: "proj-a",
    projectName: "A",
    query: "q",
    folderPath: null,
    startedAt: new Date().toISOString(),
  });

  await svc.updateTaskStatus("t1", "interrupted", "app closed");
  const rows = await svc.getTasksByProject("proj-a");
  expect(rows[0].status).toBe("interrupted");
});

it("markAllInProgressAsInterrupted updates all in_progress tasks", async () => {
  const db = await createTestDb();
  const svc = new TaskPersistenceService(db, "/tmp/home");

  await db.insert(projects).values({
    id: "proj-a",
    name: "A",
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
  });
  await svc.saveTask({ taskId: "t1", projectId: "proj-a", projectName: "A", query: "q1", folderPath: null, startedAt: new Date().toISOString() });
  await svc.saveTask({ taskId: "t2", projectId: "proj-a", projectName: "A", query: "q2", folderPath: null, startedAt: new Date().toISOString() });
  await svc.updateTaskStatus("t2", "complete");

  await svc.markAllInProgressAsInterrupted();

  const rows = await svc.getTasksByProject("proj-a");
  const t1 = rows.find((r) => r.taskId === "t1");
  const t2 = rows.find((r) => r.taskId === "t2");
  expect(t1?.status).toBe("interrupted");
  expect(t2?.status).toBe("complete"); // unchanged
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: 2 new tests fail — `interrupted` violates CHECK constraint + `markAllInProgressAsInterrupted` not found.

- [ ] **Step 3: Update schema.ts — add "interrupted" to enum**

```ts
// src/main/db/schema.ts — tasks table status column
status: text("status", {
  enum: ["pending", "in_progress", "complete", "failed", "interrupted"],
})
  .notNull()
  .default("in_progress"),
```

- [ ] **Step 4: Add Run 20 migration to migrate.ts**

Add at the end of `runMigrations`, after the Run 19 block:

```ts
// Run 20: add "interrupted" to tasks status CHECK constraint
// SQLite cannot ALTER a CHECK constraint — recreate the table if needed
{
  const result = await db.run(
    sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`,
  );
  const tableDefSql = result.rows[0]?.[0] as string | undefined;
  if (tableDefSql && !tableDefSql.includes("'interrupted'")) {
    await db.run(sql`PRAGMA foreign_keys=OFF`);
    try {
      await db.run(sql`
        CREATE TABLE tasks_run20 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          project_name TEXT NOT NULL,
          query TEXT NOT NULL,
          folder_path TEXT,
          status TEXT NOT NULL DEFAULT 'in_progress'
            CHECK(status IN ('pending','in_progress','complete','failed','interrupted')),
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      await db.run(sql`INSERT INTO tasks_run20 SELECT * FROM tasks`);
      await db.run(sql`DROP TABLE tasks`);
      await db.run(sql`ALTER TABLE tasks_run20 RENAME TO tasks`);
    } finally {
      await db.run(sql`PRAGMA foreign_keys=ON`);
    }
  }
}
```

- [ ] **Step 5: Update TaskPersistenceService.ts — add "interrupted" to types + new method**

```ts
// Update status type everywhere in the file:
status?: "pending" | "in_progress" | "complete" | "failed" | "interrupted";

// In ResearchTaskSchema:
status: z.enum(["pending", "in_progress", "complete", "failed", "interrupted"]).optional(),

// In saveTask (status value stays "in_progress" — no change needed)

// Update updateTaskStatus signature:
async updateTaskStatus(
  taskId: string,
  status: "pending" | "in_progress" | "complete" | "failed" | "interrupted",
  error?: string,
): Promise<void> {
  await this.db
    .update(tasks)
    .set({ status, error: error ?? null, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
}

// Add new method after updateTaskStatus:
async markAllInProgressAsInterrupted(): Promise<void> {
  await this.db
    .update(tasks)
    .set({ status: "interrupted", error: "App closed while research was running", updatedAt: new Date() })
    .where(eq(tasks.status, "in_progress"));
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests pass including the 2 new ones.

- [ ] **Step 7: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.ts src/main/services/TaskPersistenceService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(db): add 'interrupted' task status with migration"
```

---

## Task 2: CheckpointService

**Files:**
- Create: `src/main/services/CheckpointService.ts`
- Create: `src/main/services/__tests__/CheckpointService.test.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/CheckpointService.test.ts`:

```ts
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointService } from "../CheckpointService";
import type { ResearchCheckpoint } from "../CheckpointService";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join("/tmp", `checkpoint-test-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const svc = new CheckpointService();

function makeCheckpoint(override: Partial<ResearchCheckpoint> = {}): ResearchCheckpoint {
  return {
    taskId: "task-1",
    agentType: "researcher",
    researchOutput: "partial output",
    messages: [
      { role: "user", content: "research topic", timestamp: 1000 },
      {
        role: "assistant",
        content: [{ type: "text", text: "I will research..." }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 2000,
      },
    ],
    savedAt: new Date().toISOString(),
    ...override,
  };
}

describe("CheckpointService", () => {
  it("write then read returns the same checkpoint", async () => {
    const cp = makeCheckpoint();
    await svc.write(tmpDir, cp);
    const result = await svc.read(tmpDir);
    expect(result).toEqual(cp);
  });

  it("read returns null when checkpoint does not exist", async () => {
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });

  it("delete removes the checkpoint file", async () => {
    await svc.write(tmpDir, makeCheckpoint());
    await svc.delete(tmpDir);
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });

  it("delete is a no-op when file does not exist", async () => {
    await expect(svc.delete(tmpDir)).resolves.not.toThrow();
  });

  it("write overwrites an existing checkpoint", async () => {
    await svc.write(tmpDir, makeCheckpoint({ researchOutput: "first" }));
    await svc.write(tmpDir, makeCheckpoint({ researchOutput: "second" }));
    const result = await svc.read(tmpDir);
    expect(result?.researchOutput).toBe("second");
  });

  it("read returns null for corrupt JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tmpDir, "checkpoint.json"), "not valid json");
    const result = await svc.read(tmpDir);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test src/main/services/__tests__/CheckpointService.test.ts
```

Expected: all tests fail — `CheckpointService` not found.

- [ ] **Step 3: Implement CheckpointService**

Create `src/main/services/CheckpointService.ts`:

```ts
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { injectable } from "tsyringe";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface ResearchCheckpoint {
  taskId: string;
  agentType: "researcher" | "orchestrator";
  researchOutput: string;
  messages: AgentMessage[];
  savedAt: string;
}

const CHECKPOINT_FILENAME = "checkpoint.json";

@injectable()
export class CheckpointService {
  async write(workspacePath: string, checkpoint: ResearchCheckpoint): Promise<void> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    await writeFile(path, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  async read(workspacePath: string): Promise<ResearchCheckpoint | null> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as ResearchCheckpoint;
    } catch {
      return null;
    }
  }

  async delete(workspacePath: string): Promise<void> {
    const path = join(workspacePath, CHECKPOINT_FILENAME);
    try {
      await unlink(path);
    } catch {
      // No-op if file doesn't exist
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/CheckpointService.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Register CheckpointService in bootstrap.ts**

Add after the `TaskPersistenceService` registration line:

```ts
import { CheckpointService } from "./services/CheckpointService";
// ...
appContainer.registerSingleton(CheckpointService);
```

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/CheckpointService.ts src/main/services/__tests__/CheckpointService.test.ts src/main/bootstrap.ts
git commit -m "feat(research): add CheckpointService for agent turn snapshots"
```

---

## Task 3: Turn-end hook in worker-agent

**Files:**
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Write failing test**

Open `src/main/agent/worker-agent.test.ts` and find where `createWorkerAgent` is tested. Add this test:

```ts
it("calls onTurnEnd with agent messages after turn_end event", async () => {
  // The mock agent in this test file needs to emit a turn_end event.
  // Find or add a helper that fires the subscriber with a turn_end event.
  const onTurnEnd = vi.fn();
  // ... create worker agent with onTurnEnd
  // ... fire turn_end event via the subscriber
  // ... assert onTurnEnd called with agent.state.messages
});
```

> **Note:** The exact shape of the test depends on the mock setup in `worker-agent.test.ts`. Read the file first and follow its existing mock patterns. The key assertion is: when the agent subscriber receives `{ type: "turn_end", ... }`, `config.onTurnEnd` is called with `agent.state.messages` at that moment.

- [ ] **Step 2: Read worker-agent.test.ts to understand mock setup before writing the test**

Run:
```bash
bun run test src/main/agent/worker-agent.test.ts 2>&1 | tail -20
```

Expected: all existing tests pass (green). Read the file to understand the mock agent shape, then add the test from Step 1 with the real mock calls.

- [ ] **Step 3: Update WorkerAgentConfig and WorkerAgentBase types in worker-agent.ts**

In `worker-agent.ts`, add `onTurnEnd` to `WorkerAgentConfig` and exclude it from `WorkerAgentBase`:

```ts
// In WorkerAgentConfig interface — add after onProgress:
onTurnEnd?: (messages: AgentMessage[]) => void;

// Update WorkerAgentBase to exclude onTurnEnd so child agents don't inherit it:
type WorkerAgentBase = Omit<
  WorkerAgentConfig,
  "toolNames" | "systemPromptAddition" | "skills" | "remainingDepth" | "agentLabel" | "onTurnEnd"
>;
```

`AgentMessage` is already imported from `@mariozechner/pi-agent-core` (or accessible via the `Agent` import). If not directly imported, add:

```ts
import type { Agent } from "@mariozechner/pi-agent-core";
// AgentMessage is available from the types.d.ts as imported by agent.d.ts
```

Check the existing imports — `AgentMessage` may already be transitively available. If not, add:
```ts
import type { AgentMessage } from "@mariozechner/pi-agent-core";
```

- [ ] **Step 4: Wire onTurnEnd inside the run subscriber in createWorkerAgent**

In `createWorkerAgent`, inside the `run` function's `agent.subscribe(async (event) => { ... })`, add the `turn_end` case. The existing subscriber currently handles `message_update` and `agent_end`. Add `turn_end` between them:

```ts
const unsubscribe = agent.subscribe(async (event) => {
  const e = event as {
    type: string;
    assistantMessageEvent?: { type: string; delta: string };
  };

  if (e.type === "message_update") {
    const ae = e.assistantMessageEvent;
    if (ae?.type === "text_delta") {
      output += ae.delta;
      config.onProgress?.(config.agentLabel ?? "", ae.delta);
    }
  } else if (e.type === "turn_end") {
    config.onTurnEnd?.(agent.state.messages);
  } else if (e.type === "agent_end") {
    unsubscribe();
    unsubscribeTracer();
    tracer.endTurn({ summary: output });
    resolve(output);
  }
});
```

- [ ] **Step 5: Run all tests**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all tests pass including the new `onTurnEnd` test.

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(agent): add onTurnEnd checkpoint hook to WorkerAgentConfig"
```

---

## Task 4: Wire checkpoint writing in ResearchService._runResearch

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write failing test — checkpoint written after turn_end**

In `src/main/services/__tests__/ResearchService.test.ts`, add to the `describe("ResearchService", ...)` block:

```ts
it("writes checkpoint to workspacePath after turn_end fires", async () => {
  const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
    createWorkerAgent: MockFn;
  };

  let capturedOnTurnEnd: ((messages: unknown[]) => void) | undefined;
  createWorkerAgent.mockResolvedValueOnce({
    agent: {
      ...getMockAgent(),
      subscribe: vi.fn((cb: (event: unknown) => void) => {
        getCaptured().current = cb;
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      state: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    },
    run: vi.fn().mockResolvedValue(undefined),
  });

  createWorkerAgent.mockImplementationOnce((config: { onTurnEnd?: (msgs: unknown[]) => void }) => {
    capturedOnTurnEnd = config.onTurnEnd;
    return Promise.resolve({
      agent: {
        state: { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
        subscribe: vi.fn((cb: (event: unknown) => void) => {
          getCaptured().current = cb;
          return () => {};
        }),
        prompt: vi.fn().mockResolvedValue(undefined),
      },
      run: vi.fn().mockResolvedValue(undefined),
    });
  });

  const checkpointService = {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const svc = new ResearchService(
    makeEventBus() as never,
    makeSettingsService() as never,
    makeHomeService() as never,
    new AllowlistService() as never,
    { getProject: vi.fn().mockResolvedValue({ modelOverride: null, slug: "my-project" }) } as never,
    makeObservabilityService() as never,
    makeTaskPersistenceService() as never,
    makeResearchFinisherService() as never,
    checkpointService as never,
  );

  await svc.startResearch("p1", "My Project", "research X", null);

  // Simulate turn_end
  capturedOnTurnEnd?.([{ role: "user", content: "hi", timestamp: 1 }]);

  expect(checkpointService.write).toHaveBeenCalledWith(
    expect.stringContaining("workspace"),
    expect.objectContaining({
      agentType: "researcher",
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
    }),
  );
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: new test fails — `ResearchService` constructor doesn't accept `checkpointService`.

- [ ] **Step 3: Inject CheckpointService into ResearchService**

In `src/main/services/ResearchService.ts`:

```ts
import { CheckpointService } from "./CheckpointService";
import type { ResearchCheckpoint } from "./CheckpointService";

// Add to constructor:
@inject(CheckpointService) private readonly checkpointService: CheckpointService,
```

The constructor now has 9 parameters (was 8). Update the `@injectable()` class.

- [ ] **Step 4: Wire onTurnEnd in _runResearch**

In `_runResearch`, after `const workspacePath = ...` and after the `taskId` is assigned, add the `onTurnEnd` callback to `base`:

```ts
// Inside _runResearch, in the base object construction:
const base = {
  // ... existing fields ...
  onTurnEnd: (messages: AgentMessage[]) => {
    const checkpoint: ResearchCheckpoint = {
      taskId,
      agentType,
      researchOutput,
      messages,
      savedAt: new Date().toISOString(),
    };
    void this.checkpointService.write(workspacePath, checkpoint).catch((err) =>
      console.error("[ResearchService] checkpoint write failed:", err),
    );
  },
  // ...
};
```

> `researchOutput` is declared as `let researchOutput = ""` in the subscriber. The `onTurnEnd` callback captures it by reference — at `turn_end` time, it contains all text from the current turn's `text_delta` events, which is correct.

You need to import `AgentMessage` from `@mariozechner/pi-agent-core`:
```ts
import type { AgentMessage } from "@mariozechner/pi-agent-core";
```

Also add `agentType` as a parameter to `_runResearch` (it's already there as the second parameter: `agentType: AgentType`). Good.

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests pass. (Existing tests will need `checkpointService` as the 9th argument — add `makeCheckpointService()` helper to the test file and pass it to all existing `new ResearchService(...)` calls.)

Add this helper to the test file:

```ts
function makeCheckpointService() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}
```

Then update **every** `new ResearchService(...)` call in the test file to pass `makeCheckpointService() as never` as the 9th argument.

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(research): write checkpoint.json after each agent turn"
```

---

## Task 5: ResearchService.resumeResearch()

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write failing tests for resumeResearch**

Add to `describe("ResearchService", ...)` in the test file:

```ts
describe("resumeResearch", () => {
  function makeResearchServiceForResume() {
    const checkpointService = {
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const taskPersistence = makeTaskPersistenceService();
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeSettingsService() as never,
      makeHomeService() as never,
      new AllowlistService() as never,
      { getProject: vi.fn().mockResolvedValue({ name: "My Project", modelOverride: null, slug: "my-project-abc123", folderPath: null, projectPath: null }) } as never,
      makeObservabilityService() as never,
      taskPersistence as never,
      makeResearchFinisherService() as never,
      checkpointService as never,
    );
    return { svc, checkpointService, taskPersistence, bus };
  }

  it("marks task as interrupted when no checkpoint exists", async () => {
    const { svc, checkpointService, taskPersistence } = makeResearchServiceForResume();
    checkpointService.read.mockResolvedValue(null);

    await svc.resumeResearch({
      taskId: "t1",
      projectId: "p1",
      projectName: "My Project",
      query: "research X",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith(
      "t1",
      "interrupted",
      "No checkpoint found",
    );
  });

  it("calls agent.continue() (not prompt) when checkpoint exists", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };

    const continueMock = vi.fn().mockResolvedValue(undefined);
    const agentMock = {
      state: {
        messages: [] as unknown[],
      },
      subscribe: vi.fn((cb: (event: unknown) => void) => {
        getCaptured().current = cb;
        return () => {};
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      continue: continueMock,
    };
    createWorkerAgent.mockResolvedValueOnce({ agent: agentMock, run: vi.fn() });

    const savedMessages = [
      { role: "user", content: "research X", timestamp: 1 },
      { role: "toolResult", toolCallId: "tc1", toolName: "read_file", content: [{ type: "text", text: "result" }], details: null, isError: false, timestamp: 2 },
    ];

    const { svc, checkpointService } = makeResearchServiceForResume();
    checkpointService.read.mockResolvedValue({
      taskId: "t1",
      agentType: "researcher",
      researchOutput: "partial output",
      messages: savedMessages,
      savedAt: new Date().toISOString(),
    });

    await svc.resumeResearch({
      taskId: "t1",
      projectId: "p1",
      projectName: "My Project",
      query: "research X",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });

    // continue() should be called, not prompt()
    expect(continueMock).toHaveBeenCalled();
    expect(agentMock.prompt).not.toHaveBeenCalled();
  });

  it("emits research:complete and marks task complete when resumed agent ends", async () => {
    const { createWorkerAgent } = (await import("../../agent/worker-agent")) as unknown as {
      createWorkerAgent: MockFn;
    };

    createWorkerAgent.mockResolvedValueOnce({
      agent: {
        state: { messages: [] },
        subscribe: vi.fn((cb: (event: unknown) => void) => {
          getCaptured().current = cb;
          return () => {};
        }),
        prompt: vi.fn(),
        continue: vi.fn().mockResolvedValue(undefined),
      },
      run: vi.fn(),
    });

    const { svc, checkpointService, taskPersistence, bus } = makeResearchServiceForResume();
    checkpointService.read.mockResolvedValue({
      taskId: "t1",
      agentType: "researcher",
      researchOutput: "",
      messages: [{ role: "toolResult", toolCallId: "tc1", toolName: "t", content: [], details: null, isError: false, timestamp: 1 }],
      savedAt: new Date().toISOString(),
    });

    await svc.resumeResearch({
      taskId: "t1",
      projectId: "p1",
      projectName: "My Project",
      query: "research X",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });

    await getCaptured().current?.({ type: "agent_end" });

    expect(taskPersistence.updateTaskStatus).toHaveBeenCalledWith("t1", "complete");
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:complete" }),
    );
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: 3 new tests fail — `resumeResearch` not found.

- [ ] **Step 3: Implement resumeResearch in ResearchService.ts**

Add the following public method to `ResearchService`. Import `ResearchTask` from `TaskPersistenceService`:

```ts
import type { ResearchTask } from "./TaskPersistenceService";
```

```ts
async resumeResearch(task: ResearchTask): Promise<void> {
  const homePath = this.homeService.getHomePath();
  const project = await this.projectService.getProject(task.projectId);
  const slug = project.slug ?? task.projectId;
  const workspacePath = join(homePath, "projects", slug, "workspace", task.taskId);

  const checkpoint = await this.checkpointService.read(workspacePath);
  if (!checkpoint) {
    await this.taskPersistence.updateTaskStatus(task.taskId, "interrupted", "No checkpoint found");
    return;
  }

  // Last message must be user or toolResult for agent.continue() to work.
  // If it's an assistant message, the agent was effectively done — mark interrupted.
  const lastMsg = checkpoint.messages.at(-1) as { role?: string } | undefined;
  if (!lastMsg || lastMsg.role === "assistant") {
    await this.taskPersistence.updateTaskStatus(task.taskId, "interrupted", "Checkpoint ended on assistant turn");
    return;
  }

  const settings = await this.settingsService.getSettings();
  const provider = resolveProvider({ settings, projectModelOverride: project.modelOverride });
  if (provider.type !== "ollama" && !provider.apiKey) {
    await this.taskPersistence.updateTaskStatus(task.taskId, "interrupted", "No API key configured");
    return;
  }

  const projectPath = project.projectPath ?? join(homePath, "projects", slug);
  let filesMdContent: string | undefined;
  try {
    filesMdContent = await readFile(join(projectPath, "FILES.md"), "utf-8");
  } catch {
    // FILES.md not yet created
  }

  const agentType = checkpoint.agentType;
  const depth = agentType === "orchestrator" ? this.DEFAULT_RESEARCH_DEPTH : 0;

  let researchOutput = checkpoint.researchOutput;

  const onProgress = (label: string, delta: string) => {
    if (label) {
      this.eventBus.emit({
        type: "research:progress",
        payload: { taskId: task.taskId, projectId: task.projectId, message: delta, label },
      });
    }
  };

  const base = {
    projectId: task.projectId,
    slug,
    projectName: task.projectName,
    projectPath: project.projectPath ?? null,
    folderPath: task.folderPath,
    homePath,
    taskWorkspacePath: workspacePath,
    filesMdContent: filesMdContent || undefined,
    provider,
    onProgress,
    webAccessEnabled: settings.webAccessEnabled,
    emitBlocked: (payload: BlockedCommandPayload) =>
      this.eventBus.emit({ type: "bash:blocked", payload }),
    emitApprovalRequired: (payload: PathApprovalPayload) =>
      this.eventBus.emit({ type: "path:approval_required", payload }),
    emitExecuteCodeApprovalRequired: (payload: ExecuteCodeApprovalPayload) =>
      this.eventBus.emit({ type: "execute_code:approval_required", payload }),
    allowlistService: this.allowlistService,
    observabilityService: this.observabilityService,
    onTurnEnd: (messages: AgentMessage[]) => {
      const cp: ResearchCheckpoint = {
        taskId: task.taskId,
        agentType,
        researchOutput,
        messages,
        savedAt: new Date().toISOString(),
      };
      void this.checkpointService.write(workspacePath, cp).catch((err) =>
        console.error("[ResearchService] checkpoint write failed:", err),
      );
    },
  };

  const workerConfig = AGENT_TYPE_PRESETS[agentType](base, workspacePath, depth);
  const { agent } = await createWorkerAgent(workerConfig);

  // Inject saved messages into agent state
  agent.state.messages = checkpoint.messages as AgentMessage[];

  this.eventBus.emit({
    type: "research:started",
    payload: { taskId: task.taskId, projectId: task.projectId, query: task.query },
  });

  agent.subscribe(async (event) => {
    const e = event as {
      type: string;
      assistantMessageEvent?: { type: string; delta: string };
    };

    if (e.type === "message_update") {
      const ae = e.assistantMessageEvent;
      if (ae?.type === "text_delta") {
        researchOutput += ae.delta;
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId: task.taskId, projectId: task.projectId, message: ae.delta },
        });
      }
    } else if (e.type === "agent_end") {
      try {
        await this.taskPersistence.updateTaskStatus(task.taskId, "complete");
        await this.checkpointService.delete(workspacePath);

        this.eventBus.emit({
          type: "research:complete",
          payload: {
            taskId: task.taskId,
            projectId: task.projectId,
            query: task.query,
            filePaths: [],
          },
        });

        void this.finisherService
          .finish({
            projectId: task.projectId,
            projectName: task.projectName,
            query: task.query,
            researchOutput,
            taskWorkspacePath: workspacePath,
            projectPath: project.projectPath ?? null,
            folderPath: task.folderPath,
            slug,
            provider,
            filesMdContent,
          } satisfies FinishJob)
          .catch((err) => console.error("[ResearchService] finisherService.finish failed:", err));
      } catch (err) {
        await this.taskPersistence.updateTaskStatus(task.taskId, "failed", String(err));
        this.eventBus.emit({
          type: "research:failed",
          payload: {
            taskId: task.taskId,
            projectId: task.projectId,
            query: task.query,
            error: String(err),
          },
        });
      }
    }
  });

  agent.continue().catch(async (err) => {
    console.error("[ResearchService] resumeResearch error:", err);
    await this.taskPersistence.updateTaskStatus(task.taskId, "failed", String(err));
    this.eventBus.emit({
      type: "research:failed",
      payload: {
        taskId: task.taskId,
        projectId: task.projectId,
        query: task.query,
        error: String(err),
      },
    });
  });
}
```

> `agent.continue()` is non-blocking (returns a Promise that resolves when the run ends). This is the same fire-and-forget pattern as `run(config.query).catch(...)` in `_runResearch`.

- [ ] **Step 4: Run tests**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(research): add resumeResearch() — continue from checkpoint"
```

---

## Task 6: Fix startup-tasks.ts

**Files:**
- Modify: `src/main/ipc/startup-tasks.ts`

The current bug: `getInProgressTasks()` finds orphaned tasks, then `startResearch()` creates **new** tasks, leaving orphans permanently stuck as `"in_progress"`. Fix: call `resumeResearch()` for each orphaned task (which handles checkpoint-or-mark-interrupted internally).

- [ ] **Step 1: Write failing test**

Create `src/main/ipc/__tests__/startup-tasks.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { registerStartupTasks } from "../startup-tasks";

function makeEventBus() {
  return { emit: vi.fn() };
}

function makeTaskPersistence(inProgressTasks: { taskId: string; projectId: string; projectName: string; query: string; folderPath: null; startedAt: string; status: "in_progress" }[] = []) {
  return {
    migrateTasksFromJson: vi.fn().mockResolvedValue(undefined),
    getInProgressTasks: vi.fn().mockResolvedValue(inProgressTasks),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makeResearchService() {
  return {
    startResearch: vi.fn().mockResolvedValue({ taskId: "new-task" }),
    resumeResearch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("registerStartupTasks", () => {
  it("calls resumeResearch for each in-progress task — not startResearch", async () => {
    const task = { taskId: "t1", projectId: "p1", projectName: "P", query: "q", folderPath: null, startedAt: new Date().toISOString(), status: "in_progress" as const };
    const taskPersistence = makeTaskPersistence([task]);
    const researchService = makeResearchService();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: makeEventBus() as never,
    });

    // Wait for the async startup tasks to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(researchService.resumeResearch).toHaveBeenCalledWith(task);
    expect(researchService.startResearch).not.toHaveBeenCalled();
  });

  it("does not call resumeResearch when no in-progress tasks", async () => {
    const taskPersistence = makeTaskPersistence([]);
    const researchService = makeResearchService();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: makeEventBus() as never,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(researchService.resumeResearch).not.toHaveBeenCalled();
  });

  it("emits startup:error when resumeResearch throws", async () => {
    const task = { taskId: "t1", projectId: "p1", projectName: "P", query: "q", folderPath: null, startedAt: new Date().toISOString(), status: "in_progress" as const };
    const taskPersistence = makeTaskPersistence([task]);
    const researchService = makeResearchService();
    researchService.resumeResearch.mockRejectedValue(new Error("resume failed"));
    const bus = makeEventBus();

    registerStartupTasks({
      taskPersistenceService: taskPersistence as never,
      researchService: researchService as never,
      eventBus: bus as never,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "startup:error" }),
    );
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test src/main/ipc/__tests__/startup-tasks.test.ts
```

Expected: test file created, tests fail — `resumeResearch` not called, `startResearch` is called instead.

- [ ] **Step 3: Update startup-tasks.ts**

Replace the content of `src/main/ipc/startup-tasks.ts`:

```ts
import type { EventBus } from "../event-bus";
import type { ResearchService } from "../services/ResearchService";
import type { TaskPersistenceService } from "../services/TaskPersistenceService";

export function registerStartupTasks(deps: {
  taskPersistenceService: TaskPersistenceService;
  researchService: ResearchService;
  eventBus: EventBus;
}): void {
  const { taskPersistenceService, researchService, eventBus } = deps;

  void (async () => {
    try {
      await taskPersistenceService.migrateTasksFromJson();
    } catch (err) {
      const msg = `Failed to migrate JSON tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({
        type: "startup:error",
        payload: { phase: "migrate-tasks", error: msg },
      });
    }
    try {
      const tasks = await taskPersistenceService.getInProgressTasks();
      for (const task of tasks) {
        try {
          await researchService.resumeResearch(task);
        } catch (err) {
          const msg = `Failed to resume task ${task.taskId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error("[startup]", msg);
          eventBus.emit({
            type: "startup:error",
            payload: { phase: "resume-task", error: msg },
          });
        }
      }
    } catch (err) {
      const msg = `Failed to load in-progress tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({
        type: "startup:error",
        payload: { phase: "load-tasks", error: msg },
      });
    }
  })();
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test src/main/ipc/__tests__/startup-tasks.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/startup-tasks.ts src/main/ipc/__tests__/startup-tasks.test.ts
git commit -m "fix(startup): resume research from checkpoint instead of duplicating task"
```

---

## Task 7: UI — "interrupted" status + retry button

**Files:**
- Modify: `src/renderer/components/layout/ResearchHistoryPanel.tsx`

- [ ] **Step 1: Add "interrupted" to statusConfig and a Retry button for interrupted tasks**

In `ResearchHistoryPanel.tsx`:

1. Update the `ResearchItem` interface to include `"interrupted"`:

```ts
interface ResearchItem {
  id: string;
  query: string;
  status: "pending" | "in_progress" | "complete" | "failed" | "interrupted";
  startedAt: Date;
}
```

2. Add `"interrupted"` to `statusConfig`:

```ts
const statusConfig: Record<
  ResearchItem["status"],
  { dotClass: string; label: string; borderColor: string }
> = {
  pending:     { dotClass: "dot--warn",    label: "Pending",     borderColor: "oklch(0.85 0.06 75)" },
  in_progress: { dotClass: "dot--accent dot--pulse", label: "Running", borderColor: "var(--accent-line)" },
  complete:    { dotClass: "dot--success", label: "Done",        borderColor: "oklch(0.82 0.05 145)" },
  failed:      { dotClass: "dot--danger",  label: "Failed",      borderColor: "oklch(0.82 0.07 25)" },
  interrupted: { dotClass: "dot--warn",    label: "Interrupted", borderColor: "oklch(0.85 0.06 75)" },
};
```

3. Add a `projectId` prop lookup for retry calls. `ResearchHistoryPanel` already receives `projectId` as a prop — use it.

4. Add a retry handler and a Retry button inside the item card. The button renders only for `interrupted` items:

```tsx
const handleRetry = useCallback(
  (query: string) => {
    ipc.invoke(IPC.RETRY_RESEARCH, { projectId, query }).catch((err) =>
      console.error("[ResearchHistoryPanel] retry failed:", err),
    );
  },
  [projectId],
);
```

Inside the item map, after the query span, add:
```tsx
{item.status === "interrupted" && (
  <button
    type="button"
    onClick={() => handleRetry(item.query)}
    style={{
      marginTop: 4,
      padding: "2px 8px",
      fontSize: 11,
      cursor: "pointer",
      background: "var(--surface-3)",
      border: "1px solid var(--line)",
      borderRadius: "var(--r-sm)",
      color: "var(--ink-2)",
    }}
  >
    Retry
  </button>
)}
```

- [ ] **Step 2: Run full suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 3: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/ResearchHistoryPanel.tsx
git commit -m "feat(ui): add 'interrupted' status and retry button in research history"
```

---

## Coverage Check

After all tasks:

```bash
bun run test:coverage
```

Expected: all thresholds ≥ 90% for branches/functions/lines/statements. If below, add tests to `CheckpointService.test.ts` or `ResearchService.test.ts` for any uncovered branches in the new code.

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| `"interrupted"` DB status with migration | Task 1 |
| `CheckpointService` write/read/delete | Task 2 |
| `onTurnEnd` hook on Pi agent turns | Task 3 |
| Checkpoint written after every turn | Task 4 |
| `resumeResearch()` injects saved messages | Task 5 |
| Startup no longer duplicates tasks | Task 6 |
| UI shows "interrupted" + retry button | Task 7 |
| No checkpoint → mark interrupted | Task 5 (resumeResearch guard) |
| Sub-agents need no separate checkpoint | Architecture (orchestrator messages embed tool results) |
| Checkpoint deleted on successful completion | Task 5 (checkpointService.delete in agent_end handler) |

### Type consistency

- `ResearchTask.status` updated in Task 1 to include `"interrupted"` — used in Tasks 5, 6
- `ResearchCheckpoint` defined in Task 2, imported in Tasks 4 and 5
- `AgentMessage` imported from `@mariozechner/pi-agent-core` in Tasks 4 and 5
- `onTurnEnd` added to `WorkerAgentConfig` in Task 3, used in Tasks 4 and 5
- `WorkerAgentBase` Omit list updated in Task 3 to exclude `onTurnEnd`
- `resumeResearch` signature: `(task: ResearchTask) => Promise<void>` — consistent in Tasks 5 and 6
- `agent.state.messages` setter used in Task 5 — confirmed available in Pi agent `AgentState` type
- `agent.continue()` used in Task 5 — confirmed available in Pi agent `Agent` class
