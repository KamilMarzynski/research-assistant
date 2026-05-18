# Research Completion Summarizer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When background research finishes, a constrained one-shot agent silently verifies the output files, extracts key findings, and streams a brief natural summary into the chat without interrupting the main agent session.

**Architecture:** `ResearchSummarizerService` (DI singleton) runs a `createWorkerAgent` call with read-only tools per completed research task, saves the resulting text to the messages DB as an assistant message, then emits `research:summary_ready` on the EventBus. `SummaryStreamCoordinator` (created in `register.ts`) owns an in-memory per-project queue of ready texts; it drains the queue by streaming `MESSAGE_CHUNK` IPC events to the renderer whenever the main session is idle, holding off with a single `MESSAGE_DONE` until the queue is fully drained.

**Tech Stack:** tsyringe DI, `@mariozechner/pi-agent-core` Agent, existing `createWorkerAgent` factory, Electron IPC (`emitPush`), Vitest.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/main/ipc/SummaryQueue.ts` | Per-project in-memory queue of buffered summary texts |
| Create | `src/main/ipc/SummaryStreamCoordinator.ts` | Drains queue as streaming IPC events; coordinates with main session idle state |
| Create | `src/main/services/ResearchSummarizerService.ts` | Runs one-shot worker agent, saves message to DB, emits event |
| Create | `src/main/services/__tests__/ResearchSummarizerService.test.ts` | Unit tests for serialisation, fallback, event emission |
| Create | `src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts` | Unit tests for drain logic, guard, event wiring |
| Modify | `src/main/event-bus.ts` | Add `research:summary_ready` event type |
| Modify | `src/main/agent/tools.ts` | Add `"summarizer"` to `AgentType` union |
| Modify | `src/main/agent/prompts.ts` | Add `summarizerPrompt()` function |
| Modify | `src/main/agent/worker-agent.ts` | Add `"summarizer"` to `AGENT_TYPE_PRESETS` |
| Modify | `src/main/agent/MessagePipeline.ts` | Add `isProcessing(): boolean` |
| Modify | `src/main/agent/session.ts` | Expose `isProcessing(): boolean` |
| Modify | `src/main/agent/session.test.ts` | Test `isProcessing()` |
| Modify | `src/main/ipc/event-forwarders.ts` | Remove `queueFollowUp` call; no other changes needed |
| Modify | `src/main/services/ResearchService.ts` | Inject `ResearchSummarizerService`; call `summarize()` on `agent_end` |
| Modify | `src/main/ipc/register.ts` | Instantiate `SummaryStreamCoordinator` |
| Modify | `src/main/bootstrap.ts` | Register `ResearchSummarizerService` as singleton |

---

## Task 1: SummaryQueue

**Files:**
- Create: `src/main/ipc/SummaryQueue.ts`

- [ ] **Step 1: Write the file**

```ts
export class SummaryQueue {
  private readonly queues = new Map<string, string[]>();

  push(projectId: string, text: string): void {
    const q = this.queues.get(projectId) ?? [];
    q.push(text);
    this.queues.set(projectId, q);
  }

  pop(projectId: string): string | undefined {
    return this.queues.get(projectId)?.shift();
  }

  peek(projectId: string): string | undefined {
    return this.queues.get(projectId)?.[0];
  }

  hasItems(projectId: string): boolean {
    return (this.queues.get(projectId)?.length ?? 0) > 0;
  }
}
```

- [ ] **Step 2: Write inline tests (append to same file or create adjacent test)**

Create `src/main/ipc/__tests__/SummaryQueue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SummaryQueue } from "../SummaryQueue";

describe("SummaryQueue", () => {
  it("push and pop in FIFO order", () => {
    const q = new SummaryQueue();
    q.push("p1", "first");
    q.push("p1", "second");
    expect(q.pop("p1")).toBe("first");
    expect(q.pop("p1")).toBe("second");
    expect(q.pop("p1")).toBeUndefined();
  });

  it("hasItems returns false for empty project", () => {
    const q = new SummaryQueue();
    expect(q.hasItems("p1")).toBe(false);
    q.push("p1", "x");
    expect(q.hasItems("p1")).toBe(true);
    q.pop("p1");
    expect(q.hasItems("p1")).toBe(false);
  });

  it("queues are independent per projectId", () => {
    const q = new SummaryQueue();
    q.push("a", "alpha");
    q.push("b", "beta");
    expect(q.pop("a")).toBe("alpha");
    expect(q.hasItems("b")).toBe(true);
    expect(q.hasItems("a")).toBe(false);
  });

  it("peek does not remove item", () => {
    const q = new SummaryQueue();
    q.push("p1", "hello");
    expect(q.peek("p1")).toBe("hello");
    expect(q.hasItems("p1")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun run test -- src/main/ipc/__tests__/SummaryQueue.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/SummaryQueue.ts src/main/ipc/__tests__/SummaryQueue.test.ts
git commit -m "feat: add SummaryQueue for per-project buffered summary texts"
```

---

## Task 2: AgentSession.isProcessing()

**Files:**
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/agent/session.test.ts`, add inside the existing `describe("AgentSession")` block after the existing `describe("abort()")` block:

```ts
describe("isProcessing()", () => {
  it("returns false when idle", () => {
    expect(session.isProcessing()).toBe(false);
  });

  it("returns true while send() is running", async () => {
    let resolvePrompt: (() => void) | undefined;
    mockAgent.prompt.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const sendPromise = session.send("hello");
    while (mockAgent.prompt.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(session.isProcessing()).toBe(true);
    resolvePrompt?.();
    await sendPromise;
    expect(session.isProcessing()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun run test -- src/main/agent/session.test.ts
```

Expected: FAIL — `session.isProcessing is not a function`.

- [ ] **Step 3: Add `isProcessing()` to MessagePipeline**

In `src/main/agent/MessagePipeline.ts`, add after the `abort()` method (around line 345):

```ts
isProcessing(): boolean {
  return this.state.processing;
}
```

- [ ] **Step 4: Add `isProcessing()` to AgentSession**

In `src/main/agent/session.ts`, add after the `abort()` method (line 80):

```ts
isProcessing(): boolean {
  return this.pipeline.isProcessing();
}
```

- [ ] **Step 5: Run tests**

```bash
bun run test -- src/main/agent/session.test.ts
```

Expected: all pass including the 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/MessagePipeline.ts src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat: expose isProcessing() on AgentSession and MessagePipeline"
```

---

## Task 3: research:summary_ready EventBus event

**Files:**
- Modify: `src/main/event-bus.ts`

- [ ] **Step 1: Add event type**

In `src/main/event-bus.ts`, add to the `AppEvent` union (after the `agent:tool_end` entry, before the closing `;`):

```ts
  | { type: "research:summary_ready"; payload: { projectId: string; text: string } }
```

The full end of the union becomes:

```ts
  | {
      type: "agent:tool_end";
      payload: {
        projectId: string;
        toolCallId: string;
        toolName: string;
        isError: boolean;
      };
    }
  | { type: "research:summary_ready"; payload: { projectId: string; text: string } };
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/event-bus.ts
git commit -m "feat: add research:summary_ready EventBus event type"
```

---

## Task 4: summarizerPrompt + AgentType + preset

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/prompts.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Add `"summarizer"` to AgentType in tools.ts**

Find line 34:
```ts
export type AgentType = "researcher" | "coder" | "orchestrator";
```

Replace with:
```ts
export type AgentType = "researcher" | "coder" | "orchestrator" | "summarizer";
```

- [ ] **Step 2: Add `summarizerPrompt` to prompts.ts**

In `src/main/agent/prompts.ts`, add after the existing exported functions:

```ts
export function summarizerPrompt(dirs: AgentDirs, filesMdContent?: string): string {
  return `You are the Scholar research assistant. A background research task just completed.
Your job: verify the output files exist, read enough to identify key findings, then write a brief natural completion message for the user.

${dirSection(dirs)}${filesMdContent ? `\n\n## Output Routing (FILES.md)\n\n${filesMdContent}` : ""}

## Available tools
- **read_file** — read any file in the project directories
- **list_dir** — list directory contents to verify files exist
- **read_memory** — access project memories for context on goals and conventions

## Instructions
- Check whether output files actually exist before claiming success
- Read enough of the research output to surface 2–3 concrete findings
- Write naturally, as if briefly updating the user on background work
- Keep the final message under 150 words
- Write ONLY the final message — no preamble, no tool output, no explanation`;
}
```

- [ ] **Step 3: Add `"summarizer"` preset to AGENT_TYPE_PRESETS in worker-agent.ts**

In `src/main/agent/worker-agent.ts`, add the import for `summarizerPrompt` at the top import from prompts:

```ts
import {
  buildAgentDirs,
  coderPrompt,
  evaluatorPrompt,
  orchestratorPrompt,
  researcherPrompt,
  summarizerPrompt,
} from "./prompts";
```

Then add to `AGENT_TYPE_PRESETS` after the `orchestrator` entry:

```ts
  summarizer: (base, _outputPath) => {
    const dirs = buildAgentDirs({
      folderPath: base.folderPath,
      homePath: base.homePath,
      slug: base.slug,
      taskWorkspaceDir: base.taskWorkspacePath ?? base.homePath,
    });
    return {
      ...base,
      toolNames: ["read_file", "list_dir", "read_memory"],
      systemPromptAddition: summarizerPrompt(dirs, base.filesMdContent),
      remainingDepth: 0,
    };
  },
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run tests**

```bash
bun run test
```

Expected: all pass (no existing tests broken).

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/prompts.ts src/main/agent/worker-agent.ts
git commit -m "feat: add summarizer AgentType, summarizerPrompt, and worker-agent preset"
```

---

## Task 5: ResearchSummarizerService

**Files:**
- Create: `src/main/services/ResearchSummarizerService.ts`
- Create: `src/main/services/__tests__/ResearchSummarizerService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/services/__tests__/ResearchSummarizerService.test.ts`:

```ts
import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";

const mockRun = vi.fn().mockResolvedValue("Research complete. Files found at /path/to/output.md. Key finding: X.");
const mockAgent = { subscribe: vi.fn(), abort: vi.fn() };

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    summarizer: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi.fn().mockReturnValue({ type: "openrouter", apiKey: "sk-test", model: "test" }),
}));

const { ResearchSummarizerService } = await import("../ResearchSummarizerService");
const { createWorkerAgent } = await import("../../agent/worker-agent");

function makeMessageService() {
  return {
    addMessage: vi.fn().mockResolvedValue({ id: "msg-1", projectId: "p1", role: "assistant", content: "", createdAt: new Date() }),
  };
}

function makeHomeService() {
  return { getHomePath: vi.fn().mockReturnValue("/tmp/.scholar") };
}

function makeAllowlistService() {
  return {};
}

function makeEventBus() {
  const bus = new EventBus();
  vi.spyOn(bus, "emit");
  return bus;
}

function makeJob() {
  return {
    projectId: "p1",
    projectName: "Test Project",
    query: "What is the best model?",
    filePaths: ["/tmp/.scholar/projects/test/output.md"],
    taskWorkspacePath: "/tmp/.scholar/projects/test/workspace/abc",
    projectPath: "/tmp/.scholar/projects/test",
    folderPath: null,
    slug: "test",
    provider: { type: "openrouter" as const, apiKey: "sk-test", model: "test-model" },
    filesMdContent: undefined,
  };
}

describe("ResearchSummarizerService", () => {
  let service: InstanceType<typeof ResearchSummarizerService>;
  let messageService: ReturnType<typeof makeMessageService>;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = makeMessageService();
    eventBus = makeEventBus();
    service = new ResearchSummarizerService(
      messageService as never,
      makeHomeService() as never,
      makeAllowlistService() as never,
      eventBus,
    );
  });

  it("saves assistant message to DB after worker runs", async () => {
    await service.summarize(makeJob());
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", role: "assistant" }),
    );
  });

  it("emits research:summary_ready with the generated text", async () => {
    await service.summarize(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ projectId: "p1", text: expect.any(String) }),
      }),
    );
  });

  it("saves static fallback message when worker throws", async () => {
    mockRun.mockRejectedValueOnce(new Error("model timeout"));
    await service.summarize(makeJob());
    const call = (messageService.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("Research complete");
    expect(call.content).toContain("What is the best model?");
  });

  it("emits research:summary_ready even on fallback", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await service.summarize(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("serialises jobs — second job runs after first completes", async () => {
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    mockRun
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = () => {
              order.push("first");
              resolve("first done");
            };
          }),
      )
      .mockImplementationOnce(async () => {
        order.push("second");
        return "second done";
      });

    const p1 = service.summarize({ ...makeJob(), projectId: "p1" });
    const p2 = service.summarize({ ...makeJob(), projectId: "p2" });

    // first hasn't finished yet — second should not have started
    expect(order).toEqual([]);
    resolveFirst?.();
    await p1;
    await p2;
    expect(order).toEqual(["first", "second"]);
  });

  it("passes constrained tool names via summarizer preset", async () => {
    await service.summarize(makeJob());
    const { AGENT_TYPE_PRESETS } = await import("../../agent/worker-agent");
    expect(AGENT_TYPE_PRESETS.summarizer).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test -- src/main/services/__tests__/ResearchSummarizerService.test.ts
```

Expected: FAIL — `ResearchSummarizerService` not found.

- [ ] **Step 3: Implement ResearchSummarizerService**

Create `src/main/services/ResearchSummarizerService.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import { AGENT_TYPE_PRESETS, createWorkerAgent } from "../agent/worker-agent";
import type { ModelProvider } from "../agent/model-provider";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import { HomeService } from "./HomeService";
import { MessageService } from "./MessageService";

export interface SummarizeJob {
  projectId: string;
  projectName: string;
  query: string;
  filePaths: string[];
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}

@injectable()
export class ResearchSummarizerService {
  private _running = false;
  private readonly _queue: SummarizeJob[] = [];

  constructor(
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  summarize(job: SummarizeJob): Promise<void> {
    this._queue.push(job);
    if (!this._running) {
      return this._processQueue();
    }
    return Promise.resolve();
  }

  private async _processQueue(): Promise<void> {
    this._running = true;
    try {
      while (this._queue.length > 0) {
        const job = this._queue.shift()!;
        await this._processJob(job);
      }
    } finally {
      this._running = false;
    }
  }

  private async _processJob(job: SummarizeJob): Promise<void> {
    let text: string;
    try {
      text = await this._runSummarizer(job);
    } catch (err) {
      console.error("[ResearchSummarizerService] summarizer failed:", err);
      text = this._fallbackText(job);
    }

    try {
      await this.messageService.addMessage({
        projectId: job.projectId,
        role: "assistant",
        content: text,
      });
    } catch (err) {
      console.error("[ResearchSummarizerService] failed to save message:", err);
    }

    this.eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: job.projectId, text },
    });
  }

  private async _runSummarizer(job: SummarizeJob): Promise<string> {
    const homePath = this.homeService.getHomePath();
    const projectPath = job.projectPath ?? join(homePath, "projects", job.slug);

    let filesMdContent = job.filesMdContent;
    if (!filesMdContent) {
      try {
        filesMdContent = await readFile(join(projectPath, "FILES.md"), "utf-8");
      } catch {
        // FILES.md not yet created — proceed without it
      }
    }

    const workerConfig = AGENT_TYPE_PRESETS.summarizer(
      {
        projectId: job.projectId,
        slug: job.slug,
        projectName: job.projectName,
        projectPath: job.projectPath,
        folderPath: job.folderPath,
        homePath,
        taskWorkspacePath: job.taskWorkspacePath,
        filesMdContent,
        provider: job.provider,
        allowlistService: this.allowlistService,
      },
      job.taskWorkspacePath,
      0,
    );

    const { run } = await createWorkerAgent(workerConfig);

    const taskPrompt = [
      "Background research has completed.",
      "",
      `Query: "${job.query}"`,
      `Task workspace: ${job.taskWorkspacePath}`,
      `Files reportedly saved to: ${job.filePaths.length > 0 ? job.filePaths.join(", ") : "none"}`,
      "",
      "1. Verify the output files exist at the reported paths using read_file or list_dir.",
      "   If FILES.md specifies routing conventions, check those paths too.",
      "2. Read enough of the research output to identify 2–3 key findings.",
      "3. Write a short natural message for the user: whether it went smoothly, where the results are, and the key findings.",
      "Write ONLY the final message, nothing else.",
    ].join("\n");

    return run(taskPrompt);
  }

  private _fallbackText(job: SummarizeJob): string {
    const paths =
      job.filePaths.length > 0 ? job.filePaths.join(", ") : "workspace";
    return `Research complete: "${job.query}". Results saved to: ${paths}. (Summary generation failed — check files manually.)`;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test -- src/main/services/__tests__/ResearchSummarizerService.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ResearchSummarizerService.ts src/main/services/__tests__/ResearchSummarizerService.test.ts
git commit -m "feat: add ResearchSummarizerService — one-shot summarizer with serial job queue"
```

---

## Task 6: SummaryStreamCoordinator

**Files:**
- Create: `src/main/ipc/SummaryStreamCoordinator.ts`
- Create: `src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts`:

```ts
import { type BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";
import { SummaryQueue } from "../SummaryQueue";
import { SummaryStreamCoordinator } from "../SummaryStreamCoordinator";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));
vi.mock("../emit-push", () => ({ emitPush: vi.fn() }));

const { emitPush } = await import("../emit-push");

function makeWin() {
  return {} as BrowserWindow;
}

function makeSessionManager(processing = false) {
  return {
    get: vi.fn().mockReturnValue({ isProcessing: () => processing }),
  };
}

describe("SummaryStreamCoordinator", () => {
  let win: BrowserWindow;
  let eventBus: EventBus;
  let queue: SummaryQueue;
  let sessionManager: ReturnType<typeof makeSessionManager>;
  let coordinator: SummaryStreamCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    win = makeWin();
    eventBus = new EventBus();
    queue = new SummaryQueue();
    sessionManager = makeSessionManager(false);
    coordinator = new SummaryStreamCoordinator(win, eventBus, queue, sessionManager as never, 0);
    coordinator.register();
  });

  it("drainQueue emits MESSAGE_CHUNK events for each chunk", async () => {
    queue.push("p1", "Hello world from research.");
    await coordinator.drainQueue("p1");
    const chunkCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_CHUNK",
    );
    const combined = chunkCalls.map(([, e]) => e.delta).join("");
    expect(combined).toBe("Hello world from research.");
  });

  it("drainQueue emits single MESSAGE_DONE after all items drained", async () => {
    queue.push("p1", "First summary.");
    queue.push("p1", "Second summary.");
    await coordinator.drainQueue("p1");
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("does not emit MESSAGE_DONE between queue items", async () => {
    queue.push("p1", "A.");
    queue.push("p1", "B.");
    await coordinator.drainQueue("p1");
    const calls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.map(([, e]) => e.type);
    const doneIndex = calls.indexOf("MESSAGE_DONE");
    const lastChunkIndex = calls.lastIndexOf("MESSAGE_CHUNK");
    expect(doneIndex).toBeGreaterThan(lastChunkIndex);
    expect(calls.filter((t) => t === "MESSAGE_DONE")).toHaveLength(1);
  });

  it("concurrent drainQueue calls for same project are no-ops", async () => {
    queue.push("p1", "Once.");
    const p1 = coordinator.drainQueue("p1");
    const p2 = coordinator.drainQueue("p1");
    await Promise.all([p1, p2]);
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("on research:summary_ready drains immediately when session is idle", async () => {
    queue.push("p1", "Result here.");
    eventBus.emit({ type: "research:summary_ready", payload: { projectId: "p1", text: "Result here." } });
    // allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });

  it("on research:summary_ready defers when session is processing", async () => {
    const busyManager = makeSessionManager(true);
    coordinator = new SummaryStreamCoordinator(win, eventBus, queue, busyManager as never, 0);
    coordinator.register();

    queue.push("p1", "Deferred.");
    eventBus.emit({ type: "research:summary_ready", payload: { projectId: "p1", text: "Deferred." } });
    await new Promise((r) => setTimeout(r, 10));
    // nothing drained yet — session was busy
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(0);
    // now simulate agent:done
    eventBus.emit({ type: "agent:done", payload: { projectId: "p1" } });
    await new Promise((r) => setTimeout(r, 10));
    const doneAfter = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneAfter).toHaveLength(1);
  });

  it("on agent:done drains pending queue for that project", async () => {
    queue.push("p1", "Pending result.");
    eventBus.emit({ type: "agent:done", payload: { projectId: "p1" } });
    await new Promise((r) => setTimeout(r, 10));
    const doneCalls = (emitPush as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, e]) => e.type === "MESSAGE_DONE",
    );
    expect(doneCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun run test -- src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts
```

Expected: FAIL — `SummaryStreamCoordinator` not found.

- [ ] **Step 3: Implement SummaryStreamCoordinator**

Create `src/main/ipc/SummaryStreamCoordinator.ts`:

```ts
import type { BrowserWindow } from "electron";
import type { EventBus } from "../event-bus";
import type { SessionManager } from "./session-manager";
import type { SummaryQueue } from "./SummaryQueue";
import { emitPush } from "./emit-push";

function splitIntoChunks(text: string, wordsPerChunk = 4): string[] {
  const words = text.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const slice = words.slice(i, i + wordsPerChunk).join(" ");
    chunks.push(i + wordsPerChunk < words.length ? slice + " " : slice);
  }
  return chunks;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SummaryStreamCoordinator {
  private readonly _draining = new Set<string>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly eventBus: EventBus,
    private readonly summaryQueue: SummaryQueue,
    private readonly sessionManager: SessionManager,
    private readonly chunkDelayMs = 15,
  ) {}

  register(): void {
    this.eventBus.on("research:summary_ready", ({ projectId }) => {
      const session = this.sessionManager.get(projectId);
      if (!session || !session.isProcessing()) {
        void this.drainQueue(projectId);
      }
      // else: agent:done will trigger drain
    });

    this.eventBus.on("agent:done", ({ projectId }) => {
      if (this.summaryQueue.hasItems(projectId)) {
        void this.drainQueue(projectId);
      }
    });
  }

  async drainQueue(projectId: string): Promise<void> {
    if (this._draining.has(projectId)) return;
    this._draining.add(projectId);
    try {
      while (this.summaryQueue.hasItems(projectId)) {
        const text = this.summaryQueue.pop(projectId)!;
        for (const chunk of splitIntoChunks(text)) {
          emitPush(this.win, { type: "MESSAGE_CHUNK", projectId, delta: chunk });
          if (this.chunkDelayMs > 0) await sleep(this.chunkDelayMs);
        }
      }
      emitPush(this.win, { type: "MESSAGE_DONE", projectId });
    } finally {
      this._draining.delete(projectId);
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test -- src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/SummaryStreamCoordinator.ts src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts
git commit -m "feat: add SummaryStreamCoordinator — drains summary queue as streamed IPC events"
```

---

## Task 7: Wiring

**Files:**
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/ipc/event-forwarders.ts`

### 7a — Register ResearchSummarizerService in DI

- [ ] **Step 1: Add import and registration to bootstrap.ts**

In `src/main/bootstrap.ts`, add the import alongside other service imports:

```ts
import { ResearchSummarizerService } from "./services/ResearchSummarizerService";
```

Add after `appContainer.registerSingleton(ResearchService);`:

```ts
appContainer.registerSingleton(ResearchSummarizerService);
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

### 7b — Wire SummaryStreamCoordinator in register.ts

- [ ] **Step 3: Add imports to register.ts**

Add to the imports section of `src/main/ipc/register.ts`:

```ts
import { ResearchSummarizerService } from "../services/ResearchSummarizerService";
import { SummaryQueue } from "./SummaryQueue";
import { SummaryStreamCoordinator } from "./SummaryStreamCoordinator";
```

- [ ] **Step 4: Instantiate and register coordinator**

In `registerIpcHandlers`, after `const sessionManager = new SessionManager();`, add:

```ts
const summaryQueue = new SummaryQueue();
const summaryStreamCoordinator = new SummaryStreamCoordinator(
  win,
  eventBus,
  summaryQueue,
  sessionManager,
);
summaryStreamCoordinator.register();
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

### 7c — Wire ResearchSummarizerService into ResearchService

- [ ] **Step 6: Inject ResearchSummarizerService into ResearchService**

In `src/main/services/ResearchService.ts`, add the import:

```ts
import { ResearchSummarizerService } from "./ResearchSummarizerService";
```

Add to the constructor parameters (after `@inject(TaskPersistenceService) private readonly taskPersistence: TaskPersistenceService`):

```ts
    @inject(ResearchSummarizerService)
    private readonly summarizerService: ResearchSummarizerService,
```

- [ ] **Step 7: Call summarize() on agent_end**

In `ResearchService._runResearch`, inside the `agent_end` handler, after `this.eventBus.emit({ type: "research:complete", ... })` (around line 229), add:

```ts
          void this.summarizerService
            .summarize({
              projectId: config.projectId,
              projectName: config.projectName,
              query: config.query,
              filePaths,
              taskWorkspacePath: workspacePath,
              projectPath: config.projectPath,
              folderPath: config.folderPath,
              slug,
              provider,
              filesMdContent,
            })
            .catch((err) =>
              console.error("[ResearchService] summarizer.summarize failed:", err),
            );
```

### 7d — Remove queueFollowUp from event-forwarders.ts

- [ ] **Step 8: Remove the queueFollowUp call**

In `src/main/ipc/event-forwarders.ts`, remove these lines from the `research:complete` handler (lines 61–68):

```ts
    const session = sessionManager.get(payload.projectId);
    if (session) {
      const filePathsStr = payload.filePaths.length > 0 ? payload.filePaths.join(", ") : "none";
      session
        .queueFollowUp(
          `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${filePathsStr}. Please briefly summarise the findings for the user.`,
        )
        .catch((err) => console.error("[event-forwarders] queueFollowUp failed:", err));
    }
```

The `research:complete` handler now only handles the AGENT_PROGRESS push and the OS notification — no session interaction.

- [ ] **Step 9: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 10: Run full test suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/main/bootstrap.ts src/main/ipc/register.ts src/main/services/ResearchService.ts src/main/ipc/event-forwarders.ts
git commit -m "feat: wire ResearchSummarizerService and SummaryStreamCoordinator into app"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
bun run check
```

Expected: zero issues.

- [ ] **Step 3: Full test suite with coverage**

```bash
bun run test:coverage
```

Expected: all tests pass, ≥90% coverage on all new files.

- [ ] **Step 4: Smoke-check the flow**

Start the app:
```bash
bun run dev
```

- Open a project that has had research run before
- Send a message asking the agent to start a quick research task
- While the research is running, send another message (input should remain unlocked)
- When research completes: observe the summary streaming into the chat (input blocks during stream, unblocks after)
- Verify the message appears in the chat history after a page refresh

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -p
git commit -m "fix: post-wiring cleanup from smoke test"
```
