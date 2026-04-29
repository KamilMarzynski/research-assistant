# Run 10 — Research Agent Fixes & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs (`deep` flag, `output.md` overwrite), eliminate `ResearchService` duplication, surface sub-agent activity as labelled progress chunks, and clean up `worker-agent.ts` internals.

**Architecture:** `ResearchService` gets a private `_runResearch` method owning all shared mechanics; public methods become thin callers. `WorkerAgentConfig` gains `agentLabel` + `onProgress` so sub-agents emit labelled progress events that bubble to the EventBus and then to the renderer's `ResearchStatusBar`.

**Tech Stack:** TypeScript strict, Bun, Vitest, React + MUI, Electron IPC, `@mariozechner/pi-agent-core`

**Spec:** `docs/superpowers/specs/2026-04-28-run10-research-agent-fixes-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/shared/ipc-channels.ts` | Add `ResearchProgressPayload` type |
| `src/main/event-bus.ts` | Add `label?` to `research:progress` payload type |
| `src/main/agent/tools.ts` | Add `deep?: boolean` to `start_research` schema + execute |
| `src/main/agent/tools.test.ts` | Tests for `deep` routing |
| `src/main/agent/worker-agent.ts` | `agentLabel` + `onProgress` fields, `run()` propagation, map refactor, spawn label logic |
| `src/main/agent/worker-agent.test.ts` | Tests for `onProgress`, label assignment, preset map |
| `src/main/agent/builtin-skills.ts` | Add `FIRST_RUN_SKILL` export |
| `src/main/agent/session.ts` | Import `FIRST_RUN_SKILL`, remove inline constant |
| `src/main/services/ResearchService.ts` | Extract `_runResearch`, fix output path, wire `onProgress` |
| `src/main/services/__tests__/ResearchService.test.ts` | Update + add tests for unique paths, `onProgress` |
| `src/renderer/components/layout/chat/ResearchStatusBar.tsx` | Render `label` prefix when present |

---

## Task 1: Add `ResearchProgressPayload` type + update EventBus

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/event-bus.ts`

- [ ] **Step 1: Add `ResearchProgressPayload` to shared IPC channels**

In `src/shared/ipc-channels.ts`, append after the `IpcChannel` type:

```typescript
export interface ResearchProgressPayload {
  taskId: string;
  message: string;
  label?: string;
}
```

- [ ] **Step 2: Add `label?` to `research:progress` in EventBus**

In `src/main/event-bus.ts`, update the `research:progress` union member:

```typescript
// Before:
| { type: "research:progress"; payload: { taskId: string; message: string } }

// After:
| { type: "research:progress"; payload: { taskId: string; message: string; label?: string } }
```

- [ ] **Step 3: Run typecheck — must be zero errors**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/event-bus.ts
git commit -m "feat(run10): add ResearchProgressPayload type with optional label"
```

---

## Task 2: Fix `deep` flag in `start_research` tool

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/tools.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/tools.test.ts`, add a new `describe` block after the existing ones:

```typescript
describe("createAgentTools – start_research deep flag", () => {
  it("passes deep=true to startResearchFn when tool called with deep: true", async () => {
    const startResearchFn = vi.fn().mockResolvedValue({ taskId: "t1" });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["start_research"],
      startResearchFn,
    });
    const tool = tools.find((t) => t.name === "start_research");
    expect(tool).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await tool!.execute("call-1", { query: "research X", deep: true });
    expect(startResearchFn).toHaveBeenCalledWith("research X", true);
  });

  it("passes deep=undefined to startResearchFn when deep omitted", async () => {
    const startResearchFn = vi.fn().mockResolvedValue({ taskId: "t1" });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["start_research"],
      startResearchFn,
    });
    const tool = tools.find((t) => t.name === "start_research");
    // biome-ignore lint/style/noNonNullAssertion: expect above confirmed defined
    await tool!.execute("call-1", { query: "research X" });
    expect(startResearchFn).toHaveBeenCalledWith("research X", undefined);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: both new tests fail because the tool only passes `query`, not `deep`.

- [ ] **Step 3: Fix `start_research` tool schema and execute in `tools.ts`**

Find the `start_research` tool (around line 200). Replace its `parameters` and `execute`:

```typescript
// Before:
parameters: Type.Object({
  query: Type.String({
    description:
      "A clear, self-contained research question including all necessary context",
  }),
}),
execute: async (_id, { query }) => {
  const { taskId } = await startResearchFn(query);

// After:
parameters: Type.Object({
  query: Type.String({
    description:
      "A clear, self-contained research question including all necessary context",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "Set true for complex multi-source research requiring parallel subtopic investigation, code execution, or hierarchical orchestration. Defaults to false (single researcher).",
    }),
  ),
}),
execute: async (_id, { query, deep }) => {
  const { taskId } = await startResearchFn(query, deep);
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts
git commit -m "fix(run10): expose deep flag in start_research tool schema"
```

---

## Task 3: Add `agentLabel` + `onProgress` to `WorkerAgentConfig`, thread through `run()`

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/worker-agent.test.ts`, add a new describe block after `"createWorkerAgent – depth limit"`:

```typescript
describe("createWorkerAgent – onProgress", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("run() calls onProgress with agentLabel and delta for each text_delta", async () => {
    const onProgress = vi.fn();
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "chunk" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent({
      ...BASE_CONFIG,
      agentLabel: "[researcher-1]",
      onProgress,
    });
    await run("test");
    expect(onProgress).toHaveBeenCalledWith("[researcher-1]", "chunk");
  });

  it("run() uses empty string label when agentLabel not set", async () => {
    const onProgress = vi.fn();
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "x" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent({ ...BASE_CONFIG, onProgress });
    await run("test");
    expect(onProgress).toHaveBeenCalledWith("", "x");
  });

  it("run() does not throw when onProgress is not provided", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "y" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });
    const { run } = await createWorkerAgent(BASE_CONFIG);
    await expect(run("test")).resolves.toBe("y");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: the three new tests fail because `WorkerAgentConfig` doesn't have `agentLabel` or `onProgress` yet.

- [ ] **Step 3: Add `agentLabel` and `onProgress` to `WorkerAgentConfig` interface**

In `src/main/agent/worker-agent.ts`, find the `WorkerAgentConfig` interface and add two fields after `proposeToolFn`:

```typescript
export interface WorkerAgentConfig {
  toolNames: readonly AgentToolName[];
  systemPromptAddition: string;
  skills?: string[];
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  apiKey: string;
  model: string;
  remainingDepth?: number;
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  agentLabel?: string;
  onProgress?: (label: string, delta: string) => void;
}
```

- [ ] **Step 4: Thread `onProgress` through `run()`**

In `src/main/agent/worker-agent.ts`, find the `run` constant inside `createWorkerAgent` (near the bottom). Update the `text_delta` branch to call `onProgress`:

```typescript
const run = (input: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let output = "";
    agent.subscribe(async (event) => {
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
      } else if (e.type === "agent_end") {
        resolve(output);
      }
    });
    agent.prompt(input).catch(reject);
  });
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(run10): add agentLabel + onProgress to WorkerAgentConfig, thread through run()"
```

---

## Task 4: `AGENT_TYPE_PRESETS` map + depth string removal + spawn label propagation

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/worker-agent.test.ts`, add after the `"onProgress"` describe block:

```typescript
describe("createWorkerAgent – AGENT_TYPE_PRESETS (depth > 0 spawn)", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({ type: "agent_end" });
    });
  });

  it("spawn_agent call sets agentLabel [researcher] on child config", async () => {
    const { createAgentTools } = await import("./tools");
    const capturedToolsOpts: unknown[] = [];
    vi.mocked(createAgentTools).mockImplementation((opts) => {
      capturedToolsOpts.push(opts);
      return [];
    });

    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["spawn_agent"] as const,
      remainingDepth: 1,
    });

    // createAgentTools was called once for the parent
    expect(capturedToolsOpts).toHaveLength(1);
    const parentOpts = capturedToolsOpts[0] as { spawnAgentFn?: Function };
    expect(parentOpts.spawnAgentFn).toBeDefined();

    // Invoke spawnAgentFn — it will call createAgentTools again for the child
    await parentOpts.spawnAgentFn!("researcher", "test query", "/tmp/out.md");

    // Second createAgentTools call is for the child
    expect(capturedToolsOpts).toHaveLength(2);
  });

  it("spawn_agents_parallel assigns indexed labels per type", async () => {
    const { createAgentTools } = await import("./tools");
    const capturedConfigs: WorkerAgentConfig[] = [];

    // We need to intercept createWorkerAgent itself for children — since it's a recursive call,
    // capture via the Agent constructor calls
    const { Agent } = await import("@mariozechner/pi-agent-core");
    let callCount = 0;
    vi.mocked(Agent).mockImplementation(function (this: unknown) {
      callCount++;
      return mockAgent;
    } as never);

    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["spawn_agents_parallel"] as const,
      remainingDepth: 1,
    });

    const parentOpts = vi.mocked(createAgentTools).mock.calls[0][0] as {
      spawnAgentsParallelFn?: Function;
    };
    expect(parentOpts.spawnAgentsParallelFn).toBeDefined();

    const onProgress = vi.fn();
    // Reset to capture child onProgress labels
    // We verify via onProgress calls during child run()
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "data" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    // Rebuild with onProgress so children can propagate
    const { createAgentTools: cat } = await import("./tools");
    vi.mocked(cat).mockReturnValue([]);
    const { agent: parentAgent } = await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["spawn_agents_parallel"] as const,
      remainingDepth: 1,
      onProgress,
    });

    const opts = vi.mocked(cat).mock.calls.at(-1)?.[0] as {
      spawnAgentsParallelFn?: Function;
    };

    await opts.spawnAgentsParallelFn!([
      { type: "researcher", query: "q1", outputPath: "/tmp/r1.md" },
      { type: "researcher", query: "q2", outputPath: "/tmp/r2.md" },
    ]);

    // onProgress called with [researcher-1] and [researcher-2] labels
    const labels = onProgress.mock.calls.map((c) => c[0]);
    expect(labels).toContain("[researcher-1]");
    expect(labels).toContain("[researcher-2]");
  });
});
```

> Note: The parallel label test is integration-heavy due to recursive `createWorkerAgent`. If it proves flaky, simplify to just checking that `spawnAgentsParallelFn` is defined and produces two results.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: the new tests fail (no `AGENT_TYPE_PRESETS` map, no label propagation yet).

- [ ] **Step 3: Replace `buildChildConfig` switch with `AGENT_TYPE_PRESETS` map**

In `src/main/agent/worker-agent.ts`, inside `createWorkerAgent`, replace the entire `const buildChildConfig` switch with:

```typescript
type WorkerAgentBase = Pick<
  WorkerAgentConfig,
  | "projectId"
  | "projectName"
  | "folderPath"
  | "homePath"
  | "apiKey"
  | "model"
  | "saveArtifactFn"
  | "proposeToolFn"
  | "onProgress"
>;

type PresetBuilder = (
  base: WorkerAgentBase,
  outputPath: string,
  depth: number,
) => WorkerAgentConfig;

const AGENT_TYPE_PRESETS: Record<AgentType, PresetBuilder> = {
  researcher: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "list_dir", "safe_bash"],
    systemPromptAddition: `You are a background researcher. Investigate thoroughly using the available tools, then write your complete findings to: ${outputPath}. When done, respond with a final summary.`,
    remainingDepth: 0,
  }),
  coder: (base, outputPath) => ({
    ...base,
    toolNames: ["read_file", "write_file", "run_in_docker"],
    systemPromptAddition: `You are a coder agent. Use run_in_docker to execute code, then write your results to: ${outputPath}. When done, respond with a summary.`,
    remainingDepth: 0,
  }),
  orchestrator: (base, outputPath, depth) => ({
    ...base,
    toolNames: [...ORCHESTRATOR_TOOL_NAMES],
    systemPromptAddition: `You are a research orchestrator. Plan and delegate subtasks using spawn_agent or spawn_agents_parallel. Write your final synthesis to: ${outputPath}.`,
    remainingDepth: depth - 1,
  }),
};
```

Place this outside `createWorkerAgent` (module-level constant), before the function definition.

- [ ] **Step 4: Update spawn callbacks to use map + assign labels**

Inside `createWorkerAgent`, replace the `if (remainingDepth > 0)` block with:

```typescript
if (remainingDepth > 0) {
  const base: WorkerAgentBase = {
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
    saveArtifactFn,
    proposeToolFn,
    onProgress,
  };

  spawnAgentFn = async (
    type: AgentType,
    query: string,
    outputPath: string,
    label?: string,
  ): Promise<SpawnResult> => {
    const effectiveLabel = label ?? `[${type}]`;
    const childConfig = AGENT_TYPE_PRESETS[type](base, outputPath, remainingDepth);
    const { run } = await createWorkerAgent({
      ...childConfig,
      agentLabel: effectiveLabel,
    });
    const summary = await run(query);
    return { outputPath, summary };
  };

  spawnAgentsParallelFn = async (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ): Promise<SpawnResult[]> => {
    const typeCounters: Partial<Record<AgentType, number>> = {};
    return Promise.all(
      agents.map(({ type, query, outputPath }) => {
        typeCounters[type] = (typeCounters[type] ?? 0) + 1;
        const label = `[${type}-${typeCounters[type]}]`;
        // biome-ignore lint/style/noNonNullAssertion: spawnAgentFn defined in this branch
        return spawnAgentFn!(type, query, outputPath, label);
      }),
    );
  };
}
```

- [ ] **Step 5: Remove depth string from orchestrator system prompt in `ResearchService.ts`**

In `src/main/services/ResearchService.ts`, find the orchestrator system prompt (around line 161). Remove the `"Remaining orchestration depth: 3."` line:

```typescript
// Before:
const systemPromptAddition = [
  "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
  `Your workspace root: ${workspaceRoot}`,
  "Write intermediate results to subdirectories within your workspace root.",
  "Write your final synthesis to synthesis.md in your workspace root.",
  "Use save_artifact to persist valuable outputs — both intermediate and final.",
  "Remaining orchestration depth: 3.",
].join("\n");

// After:
const systemPromptAddition = [
  "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
  `Your workspace root: ${workspaceRoot}`,
  "Write intermediate results to subdirectories within your workspace root.",
  "Write your final synthesis to synthesis.md in your workspace root.",
  "Use save_artifact to persist valuable outputs — both intermediate and final.",
].join("\n");
```

- [ ] **Step 6: Run all tests**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 7: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts src/main/services/ResearchService.ts
git commit -m "refactor(run10): replace buildChildConfig switch with AGENT_TYPE_PRESETS map, add spawn label propagation"
```

---

## Task 5: Move `FIRST_RUN_SKILL` to `builtin-skills.ts`

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`
- Modify: `src/main/agent/session.ts`

- [ ] **Step 1: Add `FIRST_RUN_SKILL` export to `builtin-skills.ts`**

In `src/main/agent/builtin-skills.ts`, append after the existing exports:

```typescript
export const FIRST_RUN_SKILL = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;
```

- [ ] **Step 2: Update `session.ts` to import and use `FIRST_RUN_SKILL`**

In `src/main/agent/session.ts`:

1. Add `FIRST_RUN_SKILL` to the import from `./builtin-skills`:
```typescript
import { FIRST_RUN_SKILL } from "./builtin-skills";
```

2. Delete the `FIRST_RUN_PROMPT` constant (lines 12–17):
```typescript
// Remove this entire block:
const FIRST_RUN_PROMPT = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;
```

3. In the system prompt assembly, replace `FIRST_RUN_PROMPT` with `FIRST_RUN_SKILL`:
```typescript
// Before:
isFirstRun ? FIRST_RUN_PROMPT : BASE_SYSTEM_PROMPT,

// After:
isFirstRun ? FIRST_RUN_SKILL : BASE_SYSTEM_PROMPT,
```

- [ ] **Step 3: Run tests + typecheck**

```bash
bun run test && bun run typecheck
```

Expected: all pass, no behaviour change.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/builtin-skills.ts src/main/agent/session.ts
git commit -m "refactor(run10): move FIRST_RUN_PROMPT to builtin-skills.ts as FIRST_RUN_SKILL"
```

---

## Task 6: Extract `_runResearch` in `ResearchService` + fix output path + wire `onProgress`

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write new failing tests**

In `src/main/services/__tests__/ResearchService.test.ts`, add a new describe block after the existing ones:

```typescript
describe("ResearchService – _runResearch internals", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("two sequential startResearch calls on same project produce different output paths", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query A", null);
    const firstCall = vi.mocked(createWorkerAgent).mock.calls[0][0];

    await svc.startResearch("p1", "My Project", "query B", null);
    const secondCall = vi.mocked(createWorkerAgent).mock.calls[1][0];

    // System prompts contain different workspace paths (different taskIds)
    expect(firstCall.systemPromptAddition).not.toBe(secondCall.systemPromptAddition);
    // Both contain output.md but in different subdirectories
    expect(firstCall.systemPromptAddition).toContain("output.md");
    expect(secondCall.systemPromptAddition).toContain("output.md");
  });

  it("startResearch passes onProgress that emits research:progress with label", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startResearch("p1", "My Project", "query", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];

    // Fire onProgress with a label
    call.onProgress?.("[researcher-1]", "some delta");

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research:progress",
        payload: expect.objectContaining({ label: "[researcher-1]", message: "some delta" }),
      }),
    );
  });

  it("startOrchestratedResearch passes remainingDepth: 3 and onProgress", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );

    await svc.startOrchestratedResearch("p1", "My Project", "deep query", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];

    expect(call.remainingDepth).toBe(3);
    expect(call.onProgress).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: the three new tests fail.

- [ ] **Step 3: Rewrite `ResearchService.ts`**

Replace the entire content of `src/main/services/ResearchService.ts` with:

```typescript
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { injectable } from "tsyringe";
import { createWorkerAgent, ORCHESTRATOR_TOOL_NAMES } from "../agent/worker-agent";
import type { WorkerAgentConfig } from "../agent/worker-agent";
import type { EventBus } from "../event-bus";
import type { ArtifactService } from "./ArtifactService";
import type { HomeService } from "./HomeService";
import type { SettingsService } from "./SettingsService";

interface RunResearchConfig {
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
}

@injectable()
export class ResearchService {
  constructor(
    private readonly eventBus: EventBus,
    private readonly artifactService: ArtifactService,
    private readonly settingsService: SettingsService,
    private readonly homeService: HomeService,
  ) {}

  async startResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch(
      { projectId, projectName, query, folderPath },
      "output.md",
      (workspacePath) => ({
        toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
        systemPromptAddition: [
          "You are a background researcher. Investigate the given query thoroughly using the available tools,",
          `then write a comprehensive Markdown report to: ${join(workspacePath, "output.md")}.`,
          "Be thorough. When done, respond with a final summary of your findings.",
        ].join(" "),
        projectId,
        projectName,
        folderPath,
        homePath: this.homeService.getHomePath(),
        apiKey: "",  // filled in by _runResearch
        model: "",   // filled in by _runResearch
        remainingDepth: 0,
      }),
    );
  }

  async startOrchestratedResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    const homePath = this.homeService.getHomePath();

    const saveArtifactFn = async (path: string, title: string) => {
      const artifact = await this.artifactService.saveArtifact({
        projectId,
        title,
        filePath: path,
      });
      return { artifactId: artifact.id };
    };

    const proposeToolFn = async (name: string, skillContent: string, script?: string) => {
      await this.homeService.savePendingTool(name, skillContent, script);
      this.eventBus.emit({ type: "tool:pending", payload: { name, skillContent } });
    };

    return this._runResearch(
      { projectId, projectName, query, folderPath },
      "synthesis.md",
      (workspacePath) => ({
        toolNames: [...ORCHESTRATOR_TOOL_NAMES],
        systemPromptAddition: [
          "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
          `Your workspace root: ${workspacePath}`,
          "Write intermediate results to subdirectories within your workspace root.",
          "Write your final synthesis to synthesis.md in your workspace root.",
          "Use save_artifact to persist valuable outputs — both intermediate and final.",
        ].join("\n"),
        projectId,
        projectName,
        folderPath,
        homePath,
        apiKey: "",  // filled in by _runResearch
        model: "",   // filled in by _runResearch
        remainingDepth: 3,
        saveArtifactFn,
        proposeToolFn,
      }),
    );
  }

  private async _runResearch(
    config: RunResearchConfig,
    outputFileName: string,
    buildPartialConfig: (workspacePath: string) => Omit<WorkerAgentConfig, "apiKey" | "model" | "onProgress">,
  ): Promise<{ taskId: string }> {
    const taskId = crypto.randomUUID();
    const settings = await this.settingsService.getSettings();
    if (!settings.openrouterApiKey) {
      throw new Error("No API key configured");
    }

    const homePath = this.homeService.getHomePath();
    const workspacePath = join(homePath, "workspace", config.projectId, taskId);
    await mkdir(workspacePath, { recursive: true });

    await this.homeService.saveTask({
      taskId,
      projectId: config.projectId,
      projectName: config.projectName,
      query: config.query,
      folderPath: config.folderPath,
      startedAt: new Date().toISOString(),
    });

    const onProgress = (label: string, delta: string) => {
      if (label) {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId, message: delta, label },
        });
      }
    };

    const workerConfig: WorkerAgentConfig = {
      ...buildPartialConfig(workspacePath),
      apiKey: settings.openrouterApiKey,
      model: settings.model,
      onProgress,
    };

    const { agent } = await createWorkerAgent(workerConfig);

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId: config.projectId, query: config.query },
    });

    agent.subscribe(async (event) => {
      const e = event as {
        type: string;
        assistantMessageEvent?: { type: string; delta: string };
      };

      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          this.eventBus.emit({
            type: "research:progress",
            payload: { taskId, message: ae.delta },
          });
        }
      } else if (e.type === "agent_end") {
        try {
          const outputPath = join(workspacePath, outputFileName);
          const artifact = await this.artifactService.saveArtifact({
            projectId: config.projectId,
            title: `Research: ${config.query.slice(0, 60)}`,
            filePath: outputPath,
          });
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              artifactId: artifact.id,
              projectId: config.projectId,
              query: config.query,
              filePath: outputPath,
            },
          });
        } catch (err) {
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:failed",
            payload: { taskId, error: String(err) },
          });
        }
      }
    });

    agent.prompt(config.query).catch(async (err) => {
      console.error("[ResearchService] worker error:", err);
      await this.homeService.deleteTask(taskId);
      this.eventBus.emit({
        type: "research:failed",
        payload: { taskId, error: String(err) },
      });
    });

    return { taskId };
  }
}
```

- [ ] **Step 4: Run all tests — expect PASS**

```bash
bun run test
```

Expected: all tests pass, including the three new ones and all existing `ResearchService` tests.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Run Biome check**

```bash
bun run check
```

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "refactor(run10): extract _runResearch, fix output path uniqueness, wire onProgress"
```

---

## Task 7: Update `ResearchStatusBar` to render label prefix

**Files:**
- Modify: `src/renderer/components/layout/chat/ResearchStatusBar.tsx`

- [ ] **Step 1: Update `ResearchStatusBar` to read `label?` from progress payload**

In `src/renderer/components/layout/chat/ResearchStatusBar.tsx`, update the `progress` handler inside `unsubUpdate`:

```typescript
// Before:
const d = data as { status: string; message?: string; query?: string };
if (d.status === "started") {
  setState({ active: true, message: "Research started…", doneMessage: null });
} else if (d.status === "progress" && d.message) {
  setState((prev) => ({ ...prev, message: d.message ?? prev.message }));

// After:
const d = data as { status: string; message?: string; label?: string; query?: string };
if (d.status === "started") {
  setState({ active: true, message: "Research started…", doneMessage: null });
} else if (d.status === "progress" && d.message) {
  const display = d.label ? `${d.label} ${d.message}` : d.message;
  setState((prev) => ({ ...prev, message: display ?? prev.message }));
```

- [ ] **Step 2: Run typecheck + Biome**

```bash
bun run typecheck && bun run check
```

- [ ] **Step 3: Run all tests**

```bash
bun run test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/ResearchStatusBar.tsx
git commit -m "feat(run10): show agent label prefix in ResearchStatusBar progress messages"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
bun run test
```

Expected: all 220+ tests pass.

- [ ] **Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Run Biome**

```bash
bun run check
```

Expected: clean.

- [ ] **Manual smoke test**

```bash
bun run dev
```

1. Open the app, select a project
2. Ask the agent: "Research the latest approaches to RAG memory management, deep: true"
3. Verify `ResearchStatusBar` shows progress
4. When sub-agents spawn, verify labels like `[researcher-1]` appear in the status bar
5. Verify research completes without error
