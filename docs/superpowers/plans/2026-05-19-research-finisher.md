# Research Finisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only `ResearchSummarizerService` and code-side `OutputRouter.moveFinals()` with a `ResearchFinisherService` that runs a `finisher` agent — one that moves declared output files via `mv`, optionally creates an index, and writes the user message.

**Architecture:** Each researcher/orchestrator ends with a `## Handoff → ### Output Files` section in their final text. `ResearchService` accumulates the top-level agent's output text and passes it to `ResearchFinisherService`. The finisher agent (with `safe_bash` + `write_file`) reads the declared file list, runs `mv` for each, optionally creates an index, skims results, and returns the user message.

**Tech Stack:** TypeScript, tsyringe (DI), Vitest, Biome, `@mariozechner/pi-agent-core`

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/main/agent/__tests__/prompts.test.ts` |
| Modify | `src/main/agent/prompts.ts` |
| Modify | `src/main/agent/tools.ts` |
| Modify | `src/main/agent/worker-agent.ts` |
| Modify | `src/main/event-bus.ts` |
| Create | `src/main/services/ResearchFinisherService.ts` |
| Create | `src/main/services/__tests__/ResearchFinisherService.test.ts` |
| Modify | `src/main/services/ResearchService.ts` |
| Modify | `src/main/services/__tests__/ResearchService.test.ts` |
| Modify | `src/main/bootstrap.ts` |
| Modify | `src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts` |
| Delete | `src/main/services/ResearchSummarizerService.ts` |
| Delete | `src/main/services/__tests__/ResearchSummarizerService.test.ts` |
| Delete | `src/main/agent/OutputRouter.ts` |
| Delete | `src/main/agent/OutputRouter.test.ts` |

---

## Task 1: Update prompts — add `## Handoff` and `finisherPrompt`

**Files:**
- Create: `src/main/agent/__tests__/prompts.test.ts`
- Modify: `src/main/agent/prompts.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/__tests__/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { finisherPrompt, orchestratorPrompt, researcherPrompt } from "../prompts";

const dirs = {
  userProjectDir: "/user/project",
  assistantDir: "/home/.scholar",
  assistantProjectDir: "/home/.scholar/projects/test",
  taskWorkspaceDir: "/home/.scholar/projects/test/workspace/abc",
  assistantProjectSkillsDir: "/home/.scholar/projects/test/skills",
};

describe("researcherPrompt", () => {
  it("includes ## Handoff section", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("includes ### Output Files instruction", () => {
    expect(researcherPrompt(dirs, "/output.md")).toContain("### Output Files");
  });
});

describe("orchestratorPrompt", () => {
  it("includes ## Handoff section", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("## Handoff");
  });
  it("instructs to aggregate sub-agent output file declarations", () => {
    expect(orchestratorPrompt(dirs, "/output.md")).toContain("union");
  });
});

describe("finisherPrompt", () => {
  it("instructs to use mv via safe_bash", () => {
    const p = finisherPrompt(dirs);
    expect(p).toContain("mv");
    expect(p).toContain("safe_bash");
  });
  it("instructs to use read_memory", () => {
    expect(finisherPrompt(dirs)).toContain("read_memory");
  });
  it("instructs never to recreate files", () => {
    expect(finisherPrompt(dirs)).toContain("Never recreate");
  });
  it("includes Output Routing section when filesMdContent provided", () => {
    expect(finisherPrompt(dirs, "# Files")).toContain("Output Routing");
  });
  it("omits Output Routing section when no filesMdContent", () => {
    expect(finisherPrompt(dirs)).not.toContain("Output Routing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/main/agent/__tests__/prompts.test.ts
```

Expected: FAIL — `finisherPrompt` not exported, assertions about `## Handoff` fail.

- [ ] **Step 3: Update `src/main/agent/prompts.ts`**

Append `## Handoff` to the return value of `researcherPrompt` (replace the last line `"When done, respond with a brief summary..."`):

```ts
export function researcherPrompt(
  dirs: AgentDirs,
  outputPath: string,
  filesMdContent?: string,
): string {
  // ... keep existing outputSection and dirSection logic unchanged ...

  return `You are a background researcher. Investigate the given query thoroughly.

${dirSection(dirs)}

${outputSection}

## Methodology

1. Search broadly for overview information and identify key sources
2. Read specific documents that directly address the query
3. Verify claims against multiple sources; note conflicts
4. Synthesize into a coherent narrative with clear headings

## Source requirements

- Cite sources for every factual claim
- Prefer primary sources over summaries
- Note when information is incomplete or uncertain

## Format

Use Markdown with clear headings and a Sources section at the end.

## Handoff

When your research is complete, end your response with a \`## Handoff\` section:
1. A 1–2 sentence summary of how the research went.
2. A \`### Output Files\` subsection listing the absolute path of every final output file, one per line. Scratch files, intermediate notes, and downloaded sources are not output files — only files the user should receive.`;
}
```

Append `## Handoff` to the return value of `orchestratorPrompt` (replace the last paragraph `"Combine findings..."`):

```ts
export function orchestratorPrompt(
  dirs: AgentDirs,
  outputPath: string,
  filesMdContent?: string,
): string {
  // ... keep existing outputSection and dirSection logic unchanged ...

  return `You are a research orchestrator. Plan and delegate subtasks to specialist agents, then synthesise their findings.

${dirSection(dirs)}

${outputSection}

## Planning

1. Break the query into independent subtasks
2. Use spawn_agents_parallel for tasks that can run simultaneously
3. Use spawn_agent for sequential tasks with dependencies
4. Each spawned agent receives its own outputPath within \`taskWorkspaceDir\`

## Synthesis

Combine findings from subagents into a coherent conclusion. Do not concatenate outputs. Resolve conflicts, summarise themes, and present actionable results.

## Handoff

When research is complete, end your response with a \`## Handoff\` section:
1. A 1–2 sentence summary of the overall research.
2. A \`### Output Files\` subsection listing the union of all output files declared by your spawned sub-agents plus any synthesis file you wrote yourself. One absolute path per line.`;
}
```

Add `finisherPrompt` export (keep `summarizerPrompt` in place for now — removed in Task 6):

```ts
export function finisherPrompt(dirs: AgentDirs, filesMdContent?: string): string {
  return `You are the Scholar research finisher. A background research task just completed.

${dirSection(dirs)}${filesMdContent ? `\n\n## Output Routing (FILES.md)\n\n${filesMdContent}` : ""}

## Your job

1. Parse the \`## Handoff\` → \`### Output Files\` list from the research output you received.
2. For each declared output file use safe_bash to run \`mv <source> <dest>\` to move it to \`userProjectDir\` (or the subdirectory matching FILES.md conventions if defined). Never recreate or copy file content — always use mv. If mv fails, report the error clearly.
3. Check read_memory and FILES.md conventions. If the research produced multiple linked documents, decide whether an index or table-of-contents file adds value; if so, use write_file to create it in \`userProjectDir\`.
4. Use read_file to skim the moved outputs and surface 2–3 concrete key findings.
5. Write a brief natural completion message for the user: what was researched, where files landed, key findings. Under 200 words.

Write ONLY the final user-facing message — no preamble, no tool output, no explanation.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/agent/__tests__/prompts.test.ts
```

Expected: all PASS

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/prompts.ts src/main/agent/__tests__/prompts.test.ts
git commit -m "feat: add ## Handoff to researcher/orchestrator prompts, add finisherPrompt"
```

---

## Task 2: Add `finisher` to `AgentType` and `AGENT_TYPE_PRESETS`

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Write failing test**

In `src/main/agent/worker-agent.test.ts`, add after the existing `describe` blocks (the file already imports `AGENT_TYPE_PRESETS` — if not, import it):

```ts
import { AGENT_TYPE_PRESETS } from "./worker-agent";

// Add a makeBase helper if not already present:
function makeBase() {
  return {
    projectId: "p1",
    slug: "test-proj",
    projectName: "Test",
    projectPath: null,
    folderPath: null,
    homePath: "/tmp/.scholar",
    taskWorkspacePath: "/tmp/.scholar/projects/test-proj/workspace/abc",
    provider: { type: "openrouter" as const, apiKey: "sk-test", model: "test" },
    allowlistService: new AllowlistService(),
  };
}

describe("AGENT_TYPE_PRESETS.finisher", () => {
  it("includes safe_bash in toolNames", () => {
    const config = AGENT_TYPE_PRESETS.finisher(makeBase(), "/output", 0);
    expect(config.toolNames).toContain("safe_bash");
  });
  it("includes write_file in toolNames", () => {
    const config = AGENT_TYPE_PRESETS.finisher(makeBase(), "/output", 0);
    expect(config.toolNames).toContain("write_file");
  });
  it("includes read_memory in toolNames", () => {
    const config = AGENT_TYPE_PRESETS.finisher(makeBase(), "/output", 0);
    expect(config.toolNames).toContain("read_memory");
  });
  it("has remainingDepth 0", () => {
    const config = AGENT_TYPE_PRESETS.finisher(makeBase(), "/output", 0);
    expect(config.remainingDepth).toBe(0);
  });
  it("system prompt instructs mv usage", () => {
    const config = AGENT_TYPE_PRESETS.finisher(makeBase(), "/output", 0);
    expect(config.systemPromptAddition).toContain("mv");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: FAIL — `AGENT_TYPE_PRESETS.finisher is not a function`

- [ ] **Step 3: Add `"finisher"` to `AgentType` in `src/main/agent/tools.ts`**

Line 34 — replace:
```ts
export type AgentType = "researcher" | "coder" | "orchestrator" | "summarizer";
```
with:
```ts
export type AgentType = "researcher" | "coder" | "orchestrator" | "summarizer" | "finisher";
```

(`"summarizer"` kept for now — removed in Task 6.)

- [ ] **Step 4: Add `finisher` preset in `src/main/agent/worker-agent.ts`**

Add after the `summarizer` entry in `AGENT_TYPE_PRESETS`:

```ts
finisher: (base, _outputPath) => {
  const dirs = buildAgentDirs({
    folderPath: base.folderPath,
    homePath: base.homePath,
    slug: base.slug,
    taskWorkspaceDir: base.taskWorkspacePath ?? base.homePath,
  });
  return {
    ...base,
    toolNames: ["read_file", "list_dir", "read_memory", "safe_bash", "write_file"],
    systemPromptAddition: finisherPrompt(dirs, base.filesMdContent),
    remainingDepth: 0,
  };
},
```

Add `finisherPrompt` to the import from `"./prompts"`:
```ts
import {
  buildAgentDirs,
  coderPrompt,
  evaluatorPrompt,
  finisherPrompt,
  orchestratorPrompt,
  researcherPrompt,
  summarizerPrompt,
} from "./prompts";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all PASS

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat: add finisher to AgentType and AGENT_TYPE_PRESETS"
```

---

## Task 3: Create `ResearchFinisherService`

**Files:**
- Modify: `src/main/event-bus.ts`
- Create: `src/main/services/ResearchFinisherService.ts`
- Create: `src/main/services/__tests__/ResearchFinisherService.test.ts`

- [ ] **Step 1: Make `movedFiles` optional in `event-bus.ts`**

In `src/main/event-bus.ts`, update the `research:summary_ready` event type (last line of `AppEvent`):

```ts
| { type: "research:summary_ready"; payload: { projectId: string; text: string; movedFiles?: string[] } };
```

(`movedFiles` is optional here so existing emitters keep compiling. Made required in Task 6.)

- [ ] **Step 2: Write failing tests**

Create `src/main/services/__tests__/ResearchFinisherService.test.ts`:

```ts
import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";

const mockRun = vi
  .fn()
  .mockResolvedValue("Research done. Files at /project/output.md. Key finding: X.");
const mockAgent = { subscribe: vi.fn(), abort: vi.fn() };

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    finisher: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi
    .fn()
    .mockReturnValue({ type: "openrouter", apiKey: "sk-test", model: "test" }),
}));

const mockReadFile = vi.fn().mockRejectedValue(new Error("ENOENT"));
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

const { ResearchFinisherService } = await import("../ResearchFinisherService");

function makeMessageService() {
  return {
    addMessage: vi.fn().mockResolvedValue({
      id: "msg-1",
      projectId: "p1",
      role: "assistant",
      content: "",
      createdAt: new Date(),
    }),
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

function makeJob(researchOutput?: string) {
  return {
    projectId: "p1",
    projectName: "Test Project",
    query: "What is the best model?",
    researchOutput:
      researchOutput ??
      "Some research.\n\n## Handoff\nWent well.\n\n### Output Files\n/project/output.md",
    taskWorkspacePath: "/tmp/.scholar/projects/test/workspace/abc",
    projectPath: "/tmp/.scholar/projects/test",
    folderPath: null,
    slug: "test",
    provider: { type: "openrouter" as const, apiKey: "sk-test", model: "test-model" },
    filesMdContent: undefined,
  };
}

describe("ResearchFinisherService", () => {
  let service: InstanceType<typeof ResearchFinisherService>;
  let messageService: ReturnType<typeof makeMessageService>;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = makeMessageService();
    eventBus = makeEventBus();
    service = new ResearchFinisherService(
      messageService as never,
      makeHomeService() as never,
      makeAllowlistService() as never,
      eventBus,
    );
  });

  it("saves assistant message to DB after worker runs", async () => {
    await service.finish(makeJob());
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", role: "assistant" }),
    );
  });

  it("emits research:summary_ready with text and movedFiles parsed from researchOutput", async () => {
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({
          projectId: "p1",
          text: expect.any(String),
          movedFiles: ["/project/output.md"],
        }),
      }),
    );
  });

  it("movedFiles is empty when ### Output Files section absent", async () => {
    await service.finish(makeJob("Research done, no handoff section."));
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ movedFiles: [] }),
      }),
    );
  });

  it("movedFiles parses multiple paths", async () => {
    await service.finish(
      makeJob(
        "## Handoff\nDone.\n\n### Output Files\n/project/a.md\n/project/b.md",
      ),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:summary_ready",
        payload: expect.objectContaining({ movedFiles: ["/project/a.md", "/project/b.md"] }),
      }),
    );
  });

  it("saves static fallback message when worker throws", async () => {
    mockRun.mockRejectedValueOnce(new Error("model timeout"));
    await service.finish(makeJob());
    const call = (messageService.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("Research complete");
    expect(call.content).toContain("What is the best model?");
  });

  it("emits research:summary_ready even on worker fallback", async () => {
    mockRun.mockRejectedValueOnce(new Error("fail"));
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("emits research:summary_ready even when DB save throws", async () => {
    messageService.addMessage.mockRejectedValueOnce(new Error("db down"));
    await service.finish(makeJob());
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:summary_ready" }),
    );
  });

  it("reads FILES.md when filesMdContent not provided", async () => {
    mockReadFile.mockResolvedValueOnce("# Files\n\n- output.md");
    await service.finish(makeJob());
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("skips reading FILES.md when filesMdContent already provided", async () => {
    await service.finish({ ...makeJob(), filesMdContent: "provided" });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("uses home-based project path when projectPath is null", async () => {
    await service.finish({ ...makeJob(), projectPath: null });
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/.scholar/projects/test/FILES.md", "utf-8");
  });

  it("passes researchOutput to agent task prompt", async () => {
    await service.finish(makeJob("## Handoff\nAll good.\n\n### Output Files\n/a.md"));
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("## Handoff"));
  });

  it("serialises jobs — second runs after first completes", async () => {
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = () => {
        order.push("first");
        resolve("first done");
      };
    });
    mockRun
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(async () => {
        order.push("second");
        return "second done";
      });

    const p1 = service.finish({ ...makeJob(), projectId: "p1" });
    const p2 = service.finish({ ...makeJob(), projectId: "p2" });

    expect(order).toEqual([]);
    resolveFirst?.();
    await p1;
    await p2;
    expect(order).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
bun run test src/main/services/__tests__/ResearchFinisherService.test.ts
```

Expected: FAIL — `ResearchFinisherService` module not found.

- [ ] **Step 4: Create `src/main/services/ResearchFinisherService.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { ModelProvider } from "../agent/model-provider";
import { AGENT_TYPE_PRESETS, createWorkerAgent } from "../agent/worker-agent";
import { EventBus } from "../event-bus";
import { AllowlistService } from "./AllowlistService";
import { HomeService } from "./HomeService";
import { MessageService } from "./MessageService";

export interface FinishJob {
  projectId: string;
  projectName: string;
  query: string;
  researchOutput: string;
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}

function parseOutputFiles(text: string): string[] {
  const idx = text.indexOf("### Output Files");
  if (idx === -1) return [];
  const section = text.slice(idx + "### Output Files".length);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
}

@injectable()
export class ResearchFinisherService {
  private _running = false;
  private readonly _queue: FinishJob[] = [];

  constructor(
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(HomeService) private readonly homeService: HomeService,
    @inject(AllowlistService) private readonly allowlistService: AllowlistService,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  finish(job: FinishJob): Promise<void> {
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
        const job = this._queue.shift();
        if (!job) break;
        await this._processJob(job);
      }
    } finally {
      this._running = false;
    }
  }

  private async _processJob(job: FinishJob): Promise<void> {
    const movedFiles = parseOutputFiles(job.researchOutput);
    let text: string;
    try {
      text = await this._runFinisher(job);
    } catch (err) {
      console.error("[ResearchFinisherService] finisher failed:", err);
      text = this._fallbackText(job);
    }

    try {
      await this.messageService.addMessage({
        projectId: job.projectId,
        role: "assistant",
        content: text,
      });
    } catch (err) {
      console.error("[ResearchFinisherService] failed to save message:", err);
    }

    this.eventBus.emit({
      type: "research:summary_ready",
      payload: { projectId: job.projectId, text, movedFiles },
    });
  }

  private async _runFinisher(job: FinishJob): Promise<string> {
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

    const workerConfig = AGENT_TYPE_PRESETS.finisher(
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
      "",
      "Research output (contains ## Handoff with declared output files):",
      "",
      job.researchOutput,
    ].join("\n");

    return run(taskPrompt);
  }

  private _fallbackText(job: FinishJob): string {
    return `Research complete: "${job.query}". Results in workspace: ${job.taskWorkspacePath}. (Completion agent failed — check files manually.)`;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/ResearchFinisherService.test.ts
```

Expected: all PASS

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

- [ ] **Step 7: Commit**

```bash
git add src/main/event-bus.ts src/main/services/ResearchFinisherService.ts src/main/services/__tests__/ResearchFinisherService.test.ts
git commit -m "feat: add ResearchFinisherService with FinishJob and parseOutputFiles"
```

---

## Task 4: Update `ResearchService`

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Update test helpers in `ResearchService.test.ts`**

**a)** Rename `makeResearchSummarizerService` → `makeResearchFinisherService` and change method name:

```ts
function makeResearchFinisherService() {
  return {
    finish: vi.fn().mockResolvedValue(undefined),
  };
}
```

**b)** Remove `makeArtifactService` helper entirely (ArtifactService is no longer injected into ResearchService).

**c)** Update every `ResearchService` constructor call — remove the `makeArtifactService() as never,` argument (was the 6th positional arg) and replace `makeResearchSummarizerService() as never` with `makeResearchFinisherService() as never`:

Before (9 args):
```ts
new ResearchService(
  makeEventBus() as never,
  makeSettingsService() as never,
  makeHomeService() as never,
  new AllowlistService() as never,
  { getProject: vi.fn().mockResolvedValue({ modelOverride: ... }) } as never,
  makeArtifactService() as never,          // <-- remove this line
  makeObservabilityService() as never,
  makeTaskPersistenceService() as never,
  makeResearchSummarizerService() as never, // <-- rename
)
```

After (8 args):
```ts
new ResearchService(
  makeEventBus() as never,
  makeSettingsService() as never,
  makeHomeService() as never,
  new AllowlistService() as never,
  { getProject: vi.fn().mockResolvedValue({ modelOverride: ... }) } as never,
  makeObservabilityService() as never,
  makeTaskPersistenceService() as never,
  makeResearchFinisherService() as never,
)
```

Apply this change to **all** `new ResearchService(...)` calls in the file (there are 13 of them).

**d)** Add new test for `researchOutput` accumulation:

```ts
it("passes accumulated researchOutput to finisher.finish", async () => {
  const finisher = makeResearchFinisherService();
  const svc = new ResearchService(
    makeEventBus() as never,
    makeSettingsService() as never,
    makeHomeService() as never,
    new AllowlistService() as never,
    {
      getProject: vi.fn().mockResolvedValue({ modelOverride: null }),
    } as never,
    makeObservabilityService() as never,
    makeTaskPersistenceService() as never,
    finisher as never,
  );
  await svc.startResearch("p1", "My Project", "research X", null);

  await getCaptured().current?.({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "## Handoff\n" },
  });
  await getCaptured().current?.({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "### Output Files\n/project/out.md" },
  });
  await getCaptured().current?.({ type: "agent_end" });

  expect(finisher.finish).toHaveBeenCalledWith(
    expect.objectContaining({
      researchOutput: "## Handoff\n### Output Files\n/project/out.md",
    }),
  );
});
```

- [ ] **Step 2: Run to verify failures**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: multiple FAIL — wrong constructor arity, `finish` not called.

- [ ] **Step 3: Update `src/main/services/ResearchService.ts`**

**a)** Update imports — remove `OutputRouter`, `PathJail`, `ArtifactService`, `ResearchSummarizerService`; add `ResearchFinisherService`:

```ts
// Remove these three imports:
// import { OutputRouter } from "../agent/OutputRouter";
// import { PathJail } from "../agent/path-jail";
// import { ArtifactService } from "./ArtifactService";
// import { ResearchSummarizerService } from "./ResearchSummarizerService";

// Add:
import { ResearchFinisherService } from "./ResearchFinisherService";
import type { FinishJob } from "./ResearchFinisherService";
```

**b)** Update the constructor — remove `ArtifactService`, replace `ResearchSummarizerService` with `ResearchFinisherService`:

```ts
constructor(
  @inject(EventBus) private readonly eventBus: EventBus,
  @inject(SettingsService) private readonly settingsService: SettingsService,
  @inject(HomeService) private readonly homeService: HomeService,
  @inject(AllowlistService) private readonly allowlistService: AllowlistService,
  @inject(ProjectService) private readonly projectService: ProjectService,
  @inject(ObservabilityService) private readonly observabilityService: ObservabilityService,
  @inject(TaskPersistenceService) private readonly taskPersistence: TaskPersistenceService,
  @inject(ResearchFinisherService) private readonly finisherService: ResearchFinisherService,
) {}
```

**c)** In `_runResearch`, add `let researchOutput = ""` before the `agent.subscribe()` call, and accumulate in the `message_update` handler:

```ts
let researchOutput = "";

agent.subscribe(async (event) => {
  const e = event as {
    type: string;
    assistantMessageEvent?: { type: string; delta: string };
  };

  if (e.type === "message_update") {
    const ae = e.assistantMessageEvent;
    if (ae?.type === "text_delta") {
      researchOutput += ae.delta;   // <-- new line
      this.eventBus.emit({
        type: "research:progress",
        payload: { taskId, projectId: config.projectId, message: ae.delta },
      });
    }
  } else if (e.type === "agent_end") {
    // ... see step (d)
  }
});
```

**d)** Replace the entire `agent_end` handler body — remove the OutputRouter block, always emit `filePaths: []`, call `finisherService.finish`:

```ts
} else if (e.type === "agent_end") {
  researchSpan?.update({
    output: { status: "complete" },
    metadata: { taskId },
  });
  researchSpan?.end();
  try {
    await this.taskPersistence.updateTaskStatus(taskId, "complete");

    this.eventBus.emit({
      type: "research:complete",
      payload: {
        taskId,
        projectId: config.projectId,
        query: config.query,
        filePaths: [],
      },
    });

    void this.finisherService
      .finish({
        projectId: config.projectId,
        projectName: config.projectName,
        query: config.query,
        researchOutput,
        taskWorkspacePath: workspacePath,
        projectPath: config.projectPath,
        folderPath: config.folderPath,
        slug,
        provider,
        filesMdContent,
      } satisfies FinishJob)
      .catch((err) =>
        console.error("[ResearchService] finisher.finish failed:", err),
      );
  } catch (err) {
    await this.taskPersistence.updateTaskStatus(taskId, "failed", String(err));
    this.eventBus.emit({
      type: "research:failed",
      payload: {
        taskId,
        projectId: config.projectId,
        query: config.query,
        error: String(err),
      },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all PASS

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat: ResearchService accumulates researchOutput, removes OutputRouter, uses ResearchFinisherService"
```

---

## Task 5: Wire up in `bootstrap.ts`

**Files:**
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Swap service in `bootstrap.ts`**

Replace:
```ts
import { ResearchSummarizerService } from "./services/ResearchSummarizerService";
```
with:
```ts
import { ResearchFinisherService } from "./services/ResearchFinisherService";
```

Replace:
```ts
appContainer.registerSingleton(ResearchSummarizerService);
```
with:
```ts
appContainer.registerSingleton(ResearchFinisherService);
```

- [ ] **Step 2: Run full test suite**

```bash
bun run test
```

Expected: all PASS

- [ ] **Step 3: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

- [ ] **Step 4: Commit**

```bash
git add src/main/bootstrap.ts
git commit -m "feat: register ResearchFinisherService in DI container"
```

---

## Task 6: Delete old files and tighten types

**Files:**
- Delete: `src/main/services/ResearchSummarizerService.ts`
- Delete: `src/main/services/__tests__/ResearchSummarizerService.test.ts`
- Delete: `src/main/agent/OutputRouter.ts`
- Delete: `src/main/agent/OutputRouter.test.ts`
- Modify: `src/main/agent/prompts.ts` — remove `summarizerPrompt`
- Modify: `src/main/agent/tools.ts` — remove `"summarizer"` from `AgentType`
- Modify: `src/main/agent/worker-agent.ts` — remove `summarizer` preset and `summarizerPrompt` import
- Modify: `src/main/event-bus.ts` — make `movedFiles` required
- Modify: `src/main/ipc/__tests__/SummaryStreamCoordinator.test.ts` — add `movedFiles: []` to event emissions

- [ ] **Step 1: Delete old service files**

```bash
rm src/main/services/ResearchSummarizerService.ts
rm src/main/services/__tests__/ResearchSummarizerService.test.ts
rm src/main/agent/OutputRouter.ts
rm src/main/agent/OutputRouter.test.ts
```

- [ ] **Step 2: Remove `summarizerPrompt` from `prompts.ts`**

Delete the entire `summarizerPrompt` function from `src/main/agent/prompts.ts`.

- [ ] **Step 3: Remove `"summarizer"` from `AgentType` in `tools.ts`**

```ts
export type AgentType = "researcher" | "coder" | "orchestrator" | "finisher";
```

- [ ] **Step 4: Remove `summarizer` preset and `summarizerPrompt` import from `worker-agent.ts`**

Delete the `summarizer` entry from `AGENT_TYPE_PRESETS`.

Update the import from `"./prompts"` — remove `summarizerPrompt`:
```ts
import {
  buildAgentDirs,
  coderPrompt,
  evaluatorPrompt,
  finisherPrompt,
  orchestratorPrompt,
  researcherPrompt,
} from "./prompts";
```

- [ ] **Step 5: Make `movedFiles` required in `event-bus.ts`**

```ts
| { type: "research:summary_ready"; payload: { projectId: string; text: string; movedFiles: string[] } };
```

- [ ] **Step 6: Update `SummaryStreamCoordinator.test.ts` — add `movedFiles: []` to both `research:summary_ready` emissions**

In the test "on research:summary_ready drains immediately when session is idle":
```ts
eventBus.emit({
  type: "research:summary_ready",
  payload: { projectId: "p1", text: "Result here.", movedFiles: [] },
});
```

In the test "on research:summary_ready defers when session is processing":
```ts
eventBus.emit({
  type: "research:summary_ready",
  payload: { projectId: "p1", text: "Deferred.", movedFiles: [] },
});
```

- [ ] **Step 7: Run full test suite and typecheck**

```bash
bun run typecheck && bun run check && bun run test
```

Expected: all PASS, zero errors

- [ ] **Step 8: Run coverage**

```bash
bun run test:coverage
```

Expected: ≥90% branches/functions/lines/statements

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove ResearchSummarizerService, OutputRouter, summarizerPrompt — finisher is live"
```

---

## Summary

| Task | Changes |
|------|---------|
| 1 | `## Handoff` added to researcher + orchestrator prompts; `finisherPrompt` created |
| 2 | `"finisher"` added to `AgentType`; `AGENT_TYPE_PRESETS.finisher` with `safe_bash`+`write_file` |
| 3 | `ResearchFinisherService` + `FinishJob` created; `event-bus` gains `movedFiles?` |
| 4 | `ResearchService`: accumulates output, removes OutputRouter block, uses finisher |
| 5 | `bootstrap.ts`: service swap |
| 6 | Old files deleted; `summarizerPrompt`+`"summarizer"` removed; `movedFiles` required |
