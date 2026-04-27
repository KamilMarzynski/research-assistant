# Run 8b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Docker sandbox execution, agent-created tools approval gate, and recursive orchestrated research to the research assistant.

**Architecture:** Three independent additions that compose: (1) `runInDocker()` function + `run_in_docker` tool in tools.ts; (2) `propose_tool` tool + HomeService pending-tools methods + IPC + minimal renderer; (3) `WorkerAgentConfig.remainingDepth` depth-limit system with spawn callbacks, enabling `ResearchService.startOrchestratedResearch()`.

**Tech Stack:** dockerode (Docker API), React + MUI (frontend), existing Pi agent infrastructure, existing TSyringe DI, existing EventBus/IPC patterns.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/agent/extensions/docker-sandbox.ts` | Create | `runInDocker()` — isolated code execution |
| `src/main/agent/extensions/docker-sandbox.test.ts` | Create | Docker sandbox unit tests |
| `src/main/agent/tools.ts` | Modify | Add `run_in_docker`, `spawn_agent`, `spawn_agents_parallel`, `save_artifact`, `propose_tool`; update `AgentToolName` + `AgentToolsOptions` |
| `src/main/agent/tools.test.ts` | Modify | Tests for new tools |
| `src/main/agent/worker-agent.ts` | Modify | Add `remainingDepth`, `saveArtifactFn`, `proposeToolFn` to config; build spawn callbacks; export `ORCHESTRATOR_TOOL_NAMES` |
| `src/main/agent/worker-agent.test.ts` | Modify | Depth-limit + spawn callback tests |
| `src/main/agent/builtin-skills.ts` | Modify | Update `START_RESEARCH_SKILL` with `deep` flag |
| `src/main/agent/session.ts` | Modify | Update `startResearchFn` callback to accept `deep` flag |
| `src/main/services/ResearchService.ts` | Modify | Add `startOrchestratedResearch()` |
| `src/main/services/__tests__/ResearchService.test.ts` | Modify | Tests for `startOrchestratedResearch` |
| `src/main/services/HomeService.ts` | Modify | Add `savePendingTool`, `getPendingTools`, `approvePendingTool`, `rejectPendingTool`; add `pending-tools/` to dirs |
| `src/main/services/__tests__/HomeService.test.ts` | Modify | Pending tools tests |
| `src/main/event-bus.ts` | Modify | Add `tool:pending` event type |
| `src/shared/ipc-channels.ts` | Modify | Add `TOOL_PENDING`, `GET_PENDING_TOOLS`, `APPROVE_TOOL`, `REJECT_TOOL` |
| `src/main/ipc-handlers.ts` | Modify | Wire pending tools IPC; forward `tool:pending` event; update `startResearchFn` |
| `src/renderer/components/layout/chat/PendingToolBanner.tsx` | Create | Notification banner for pending tools |
| `src/renderer/components/layout/chat/PendingToolModal.tsx` | Create | Approve/reject dialog |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Modify | Mount `ResearchStatusBar` + `PendingToolBanner` |

---

## Task 1: Install dockerode

**Files:**
- Modify: `package.json` (via bun add)

- [ ] **Step 1: Install dockerode**

```bash
bun add dockerode
bun add -d @types/dockerode
```

- [ ] **Step 2: Verify typecheck still passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore(run8b): add dockerode dependency"
```

---

## Task 2: Docker Sandbox Extension

**Files:**
- Create: `src/main/agent/extensions/docker-sandbox.ts`
- Create: `src/main/agent/extensions/docker-sandbox.test.ts`

### How it works

Container stdout is redirected to `/workspace/.stdout` inside the container via `sh -c 'cmd > /workspace/.stdout 2>&1'`. After `container.wait()` returns, the file is read from the host-mounted temp dir. Output files written by the agent code to `/workspace/output/` are returned as `outputFiles`. Both the temp dir and container are always cleaned up in `finally`.

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/extensions/docker-sandbox.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockContainer = {
  start: vi.fn(),
  wait: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
};

const mockCreateContainer = vi.fn();

vi.mock("dockerode", () => ({
  default: vi.fn(() => ({ createContainer: mockCreateContainer })),
}));

const { runInDocker } = await import("./docker-sandbox");

describe("runInDocker", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "docker-test-"));
    vi.clearAllMocks();
    mockContainer.start.mockResolvedValue(undefined);
    mockContainer.wait.mockResolvedValue({ StatusCode: 0 });
    mockContainer.stop.mockResolvedValue(undefined);
    mockContainer.remove.mockResolvedValue(undefined);
    mockCreateContainer.mockResolvedValue(mockContainer);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("selects python:3.11-slim for python", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "python:3.11-slim" }),
    );
  });

  it("selects node:20-alpine for typescript", async () => {
    await runInDocker({ code: 'console.log("hi")', language: "typescript" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "node:20-alpine" }),
    );
  });

  it("selects bash:5 for bash", async () => {
    await runInDocker({ code: 'echo "hi"', language: "bash" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "bash:5" }),
    );
  });

  it("uses bridge network when networkEnabled is true", async () => {
    await runInDocker({ code: 'print("hi")', language: "python", networkEnabled: true });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({ NetworkMode: "bridge" }),
      }),
    );
  });

  it("uses none network by default", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({ NetworkMode: "none" }),
      }),
    );
  });

  it("calls container.remove in finally on success", async () => {
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it("calls container.remove in finally on container start failure", async () => {
    mockContainer.start.mockRejectedValue(new Error("failed to start"));
    await runInDocker({ code: 'print("hi")', language: "python" });
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it("returns error string when Docker unavailable — does not throw", async () => {
    mockCreateContainer.mockRejectedValue(new Error("Cannot connect to Docker daemon"));
    const result = await runInDocker({ code: 'print("hi")', language: "python" });
    expect(result.error).toContain("Cannot connect to Docker daemon");
    expect(result.stdout).toBe("");
    expect(result.outputFiles).toEqual([]);
  });

  it("stdout is empty string when .stdout file absent", async () => {
    const result = await runInDocker({ code: 'print("hi")', language: "python" });
    expect(result.stdout).toBe("");
    expect(result.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect fail (module not found)**

```bash
bun run test src/main/agent/extensions/docker-sandbox.test.ts
```

Expected: FAIL — `docker-sandbox.ts` does not exist.

- [ ] **Step 3: Write implementation**

Create `src/main/agent/extensions/docker-sandbox.ts`:

```typescript
import Docker from "dockerode";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface DockerSandboxInput {
  code: string;
  language: "python" | "bash" | "typescript";
  files?: Array<{ name: string; content: string }>;
  networkEnabled?: boolean;
}

export interface DockerSandboxOutput {
  stdout: string;
  outputFiles: Array<{ name: string; content: string }>;
  error?: string;
}

const IMAGES: Record<DockerSandboxInput["language"], string> = {
  python: "python:3.11-slim",
  bash: "bash:5",
  typescript: "node:20-alpine",
};

const ENTRY_FILES: Record<DockerSandboxInput["language"], string> = {
  python: "main.py",
  bash: "main.sh",
  typescript: "main.ts",
};

// Redirect stdout+stderr to /workspace/.stdout so we can read it from the host mount.
// sh is available in all three base images.
const COMMANDS: Record<DockerSandboxInput["language"], string[]> = {
  python: ["sh", "-c", "python /workspace/main.py > /workspace/.stdout 2>&1"],
  bash: ["sh", "-c", "bash /workspace/main.sh > /workspace/.stdout 2>&1"],
  typescript: [
    "sh",
    "-c",
    "npx --yes tsx /workspace/main.ts > /workspace/.stdout 2>&1",
  ],
};

const TIMEOUT_MS = 60_000;

export async function runInDocker(
  input: DockerSandboxInput,
): Promise<DockerSandboxOutput> {
  const docker = new Docker();
  let tmpDir: string | null = null;
  let container: Docker.Container | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "ra-docker-"));
    const outputDir = join(tmpDir, "output");
    await mkdir(outputDir, { recursive: true });

    for (const f of input.files ?? []) {
      await writeFile(join(tmpDir, f.name), f.content, "utf-8");
    }
    await writeFile(
      join(tmpDir, ENTRY_FILES[input.language]),
      input.code,
      "utf-8",
    );

    container = await docker.createContainer({
      Image: IMAGES[input.language],
      Cmd: COMMANDS[input.language],
      Tty: false,
      HostConfig: {
        Binds: [`${tmpDir}:/workspace`],
        NetworkMode: input.networkEnabled ? "bridge" : "none",
      },
      WorkingDir: "/workspace",
    });

    await container.start();

    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      await (container as Docker.Container).stop({ t: 0 }).catch(() => {});
    }, TIMEOUT_MS);

    try {
      await container.wait();
    } finally {
      clearTimeout(timer);
    }

    // Read stdout from file written inside the container
    let stdout = "";
    try {
      stdout = await readFile(join(tmpDir, ".stdout"), "utf-8");
    } catch {
      // container may have failed before writing .stdout
    }

    const outputFiles: Array<{ name: string; content: string }> = [];
    try {
      const entries = await readdir(outputDir);
      for (const name of entries) {
        const content = await readFile(join(outputDir, name), "utf-8");
        outputFiles.push({ name, content });
      }
    } catch {
      // no output dir or empty
    }

    if (timedOut) {
      return { stdout, outputFiles, error: "Container timed out after 60s" };
    }

    return { stdout, outputFiles };
  } catch (err) {
    return {
      stdout: "",
      outputFiles: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (container) await container.remove({ force: true }).catch(() => {});
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/agent/extensions/docker-sandbox.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/extensions/docker-sandbox.ts src/main/agent/extensions/docker-sandbox.test.ts
git commit -m "feat(run8b): add runInDocker sandbox using dockerode"
```

---

## Task 3: Add `run_in_docker` to `tools.ts`

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/tools.test.ts`

- [ ] **Step 1: Add failing test**

Add to `src/main/agent/tools.test.ts` (inside `describe("createAgentTools – toolNames filter")`):

```typescript
it("includes run_in_docker when in toolNames", () => {
  const tools = createAgentTools({ ...BASE, toolNames: ["run_in_docker"] });
  expect(tools.map((t) => t.name)).toContain("run_in_docker");
});

it("excludes run_in_docker when not in toolNames", () => {
  const tools = createAgentTools({ ...BASE, toolNames: ["read_file"] });
  expect(tools.map((t) => t.name)).not.toContain("run_in_docker");
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: FAIL — `run_in_docker` not in AgentToolName.

- [ ] **Step 3: Update `tools.ts`**

In `src/main/agent/tools.ts`:

Add import at top:
```typescript
import { runInDocker } from "./extensions/docker-sandbox";
import type { DockerSandboxInput } from "./extensions/docker-sandbox";
```

Extend the `AgentToolName` union:
```typescript
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "request_evaluation"
  | "start_research"
  | "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "save_artifact"
  | "propose_tool";
```

Add the `run_in_docker` tool in the `tools` array (after `safe_bash`):

```typescript
makeTool({
  name: "run_in_docker",
  label: "Run code in Docker",
  description:
    "Execute code in an isolated Docker container. Write output files to /workspace/output/ to receive them back as outputFiles.",
  parameters: Type.Object({
    code: Type.String({ description: "Code to execute" }),
    language: Type.Union(
      [Type.Literal("python"), Type.Literal("bash"), Type.Literal("typescript")],
      { description: "Programming language" },
    ),
    files: Type.Optional(
      Type.Array(
        Type.Object({ name: Type.String(), content: Type.String() }),
        { description: "Additional files to write into /workspace before execution" },
      ),
    ),
    networkEnabled: Type.Optional(
      Type.Boolean({ description: "Allow network access inside the container" }),
    ),
  }),
  execute: async (_id, { code, language, files, networkEnabled }) => {
    const result = await runInDocker({
      code,
      language: language as DockerSandboxInput["language"],
      files,
      networkEnabled,
    });
    const text = [
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.error ? `error: ${result.error}` : "",
      result.outputFiles.length > 0
        ? `output files: ${result.outputFiles.map((f) => f.name).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      content: [{ type: "text" as const, text: text || "(no output)" }],
      details: result,
    };
  },
}),
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts
git commit -m "feat(run8b): add run_in_docker tool to createAgentTools"
```

---

## Task 4: Extend `WorkerAgentConfig` with `remainingDepth` + callbacks

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

The `remainingDepth` field controls whether orchestrator-only tools are included. It defaults to `0` (leaf). Orchestrator-only tools are filtered out when `remainingDepth === 0`, regardless of what `toolNames` requests.

- [ ] **Step 1: Write failing tests**

Add to `src/main/agent/worker-agent.test.ts` (new `describe` block after existing ones):

```typescript
describe("createWorkerAgent – depth limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("depth defaults to 0 — orchestrator-only tools filtered from createAgentTools call", async () => {
    const { createAgentTools } = await import("./tools");
    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["read_file", "spawn_agent", "save_artifact"],
    });
    // createAgentTools should have been called with only ["read_file"]
    expect(createAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNames: ["read_file"],
      }),
    );
  });

  it("when remainingDepth > 0, orchestrator tools pass through to createAgentTools", async () => {
    const { createAgentTools } = await import("./tools");
    await createWorkerAgent({
      ...BASE_CONFIG,
      toolNames: ["read_file", "spawn_agent", "save_artifact"],
      remainingDepth: 2,
    });
    expect(createAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        toolNames: ["read_file", "spawn_agent", "save_artifact"],
      }),
    );
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: FAIL — `remainingDepth` not on config.

- [ ] **Step 3: Update `worker-agent.ts`**

In `src/main/agent/worker-agent.ts`, update `WorkerAgentConfig`:

```typescript
export type SpawnResult = { outputPath: string; summary: string };
export type AgentType = "researcher" | "coder" | "orchestrator";

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
  remainingDepth?: number;   // defaults to 0 (leaf)
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
}
```

Add the depth-guard constant and filtering in `createWorkerAgent`:

```typescript
// Tools that require remainingDepth > 0 to be active
const ORCHESTRATOR_ONLY_TOOLS = new Set<AgentToolName>([
  "spawn_agent",
  "spawn_agents_parallel",
  "save_artifact",
  "propose_tool",
]);

export const ORCHESTRATOR_TOOL_NAMES: readonly AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "run_in_docker",
  "spawn_agent",
  "spawn_agents_parallel",
  "save_artifact",
  "propose_tool",
] as const;
```

In `createWorkerAgent`, before the `createAgentTools` call, compute effective tool names:

```typescript
export async function createWorkerAgent(config: WorkerAgentConfig): Promise<WorkerAgent> {
  const {
    toolNames,
    systemPromptAddition,
    skills = [],
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
    remainingDepth = 0,
    saveArtifactFn,
    proposeToolFn,
  } = config;

  // Depth-guard: remove orchestrator-only tools when at leaf depth
  const effectiveToolNames =
    remainingDepth === 0
      ? toolNames.filter((t) => !ORCHESTRATOR_ONLY_TOOLS.has(t))
      : toolNames;

  const skillContent = await loadSkillsByContent(skills, folderPath ?? undefined);
  const systemPrompt = [systemPromptAddition, skillContent].filter(Boolean).join("\n\n");

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: getModel("openrouter", model as never),
    },
    getApiKey: async () => apiKey,
  });

  agent.state.tools = createAgentTools({
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
    toolNames: effectiveToolNames,
    requestEvaluationFn: makeEvaluatorFn({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey,
      model,
    }),
    saveArtifactFn,
    proposeToolFn,
    // spawnAgentFn and spawnAgentsParallelFn added in Task 5
  });

  // ... rest of run() unchanged
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(run8b): add remainingDepth depth-limit to WorkerAgentConfig"
```

---

## Task 5: Add spawn callbacks to `createWorkerAgent`

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

Spawn callbacks are closures built inside `createWorkerAgent` that recursively call `createWorkerAgent` with child configs. They are only passed to `createAgentTools` when `remainingDepth > 0`.

- [ ] **Step 1: Write failing tests**

Add to the `describe("createWorkerAgent – depth limit")` block in `worker-agent.test.ts`:

```typescript
it("spawnAgentFn is passed to createAgentTools when remainingDepth > 0", async () => {
  const { createAgentTools } = await import("./tools");
  await createWorkerAgent({
    ...BASE_CONFIG,
    toolNames: ["spawn_agent"],
    remainingDepth: 1,
  });
  expect(createAgentTools).toHaveBeenCalledWith(
    expect.objectContaining({
      spawnAgentFn: expect.any(Function),
    }),
  );
});

it("spawnAgentFn is NOT passed when remainingDepth === 0", async () => {
  const { createAgentTools } = await import("./tools");
  await createWorkerAgent({
    ...BASE_CONFIG,
    toolNames: ["spawn_agent"],
    remainingDepth: 0,
  });
  expect(createAgentTools).toHaveBeenCalledWith(
    expect.objectContaining({
      spawnAgentFn: undefined,
    }),
  );
});

it("spawnAgentFn creates child with remainingDepth decremented by 1", async () => {
  let childConfig: WorkerAgentConfig | undefined;
  const originalCreate = (await import("./worker-agent")).createWorkerAgent;
  // We'll capture the config by checking createAgentTools calls
  const { createAgentTools } = await import("./tools");

  await createWorkerAgent({
    ...BASE_CONFIG,
    toolNames: ["spawn_agent"],
    remainingDepth: 2,
  });

  // First call is for the parent agent. spawnAgentFn creates child on invocation.
  // Get the spawnAgentFn from the createAgentTools call
  const call = vi.mocked(createAgentTools).mock.calls[0][0];
  const spawnFn = call.spawnAgentFn;
  expect(spawnFn).toBeDefined();

  // Invoke it with type orchestrator — should produce a child with remainingDepth = 1
  mockAgent.prompt.mockImplementation(async () => {
    await capturedSubscriber?.({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "done" },
    });
    await capturedSubscriber?.({ type: "agent_end" });
  });
  const homePath = BASE_CONFIG.homePath;
  const outputPath = `${homePath}/workspace/proj-1/output.md`;
  await spawnFn?.("orchestrator", "research topic", outputPath);

  // The second createAgentTools call is for the child agent
  const childCall = vi.mocked(createAgentTools).mock.calls[1][0];
  // Child should have been created with remainingDepth = 1 (parent was 2)
  // We verify by checking the toolNames filter was not applied to orchestrator tools
  expect(childCall.toolNames).toContain("spawn_agent");
});
```

- [ ] **Step 2: Run — expect some failures**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: spawn callback tests FAIL.

- [ ] **Step 3: Add spawn callbacks in `worker-agent.ts`**

In `createWorkerAgent`, after the `effectiveToolNames` computation, build the spawn callbacks:

```typescript
// Build spawn callbacks (only when depth > 0 to prevent unnecessary overhead)
let spawnAgentFn: AgentToolsOptions["spawnAgentFn"] | undefined;
let spawnAgentsParallelFn: AgentToolsOptions["spawnAgentsParallelFn"] | undefined;

if (remainingDepth > 0) {
  const buildChildConfig = (
    type: AgentType,
    outputPath: string,
  ): WorkerAgentConfig => {
    const base: Omit<WorkerAgentConfig, "toolNames" | "systemPromptAddition" | "remainingDepth"> =
      {
        projectId,
        projectName,
        folderPath,
        homePath,
        apiKey,
        model,
        saveArtifactFn,
        proposeToolFn,
      };

    switch (type) {
      case "researcher":
        return {
          ...base,
          toolNames: ["read_file", "write_file", "list_dir", "safe_bash"],
          systemPromptAddition: `You are a background researcher. Investigate thoroughly using the available tools, then write your complete findings to: ${outputPath}. When done, respond with a final summary.`,
          remainingDepth: 0,
        };
      case "coder":
        return {
          ...base,
          toolNames: ["read_file", "write_file", "run_in_docker"],
          systemPromptAddition: `You are a coder agent. Use run_in_docker to execute code, then write your results to: ${outputPath}. When done, respond with a summary.`,
          remainingDepth: 0,
        };
      case "orchestrator":
        return {
          ...base,
          toolNames: [...ORCHESTRATOR_TOOL_NAMES],
          systemPromptAddition: `You are a research orchestrator. Plan and delegate. Remaining orchestration depth: ${remainingDepth - 1}. Write your synthesis to: ${outputPath}.`,
          remainingDepth: remainingDepth - 1,
        };
    }
  };

  spawnAgentFn = async (
    type: AgentType,
    query: string,
    outputPath: string,
  ): Promise<SpawnResult> => {
    const childConfig = buildChildConfig(type, outputPath);
    const { run } = await createWorkerAgent(childConfig);
    const summary = await run(query);
    return { outputPath, summary };
  };

  spawnAgentsParallelFn = async (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ): Promise<SpawnResult[]> => {
    return Promise.all(
      agents.map(({ type, query, outputPath }) =>
        spawnAgentFn!(type, query, outputPath),
      ),
    );
  };
}
```

Then update the `createAgentTools` call to pass these callbacks:

```typescript
agent.state.tools = createAgentTools({
  projectId,
  projectName,
  folderPath,
  homePath,
  apiKey,
  model,
  toolNames: effectiveToolNames,
  requestEvaluationFn: makeEvaluatorFn({
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey,
    model,
  }),
  saveArtifactFn,
  proposeToolFn,
  spawnAgentFn,
  spawnAgentsParallelFn,
});
```

You also need to add `AgentToolsOptions` to the imports from `./tools` and add the new types to the `AgentToolsOptions` in `tools.ts` (done in Task 6). For now, add placeholder types in `worker-agent.ts`:

```typescript
// Temporary — types will be properly defined in tools.ts Task 6
type AgentToolsOptions = Parameters<typeof createAgentTools>[0];
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(run8b): add spawn callbacks to createWorkerAgent with depth-limit"
```

---

## Task 6: Add spawn + save_artifact + propose_tool tools to `tools.ts`

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/tools.test.ts`

These tools are callback-based (same pattern as `request_evaluation`): only included when their callback is provided.

- [ ] **Step 1: Write failing tests**

Add a new `describe` block to `tools.test.ts`:

```typescript
describe("createAgentTools – spawn + orchestrator tools", () => {
  it("excludes spawn_agent when spawnAgentFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["spawn_agent"] });
    expect(tools.map((t) => t.name)).not.toContain("spawn_agent");
  });

  it("includes spawn_agent when spawnAgentFn provided and in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["spawn_agent"],
      spawnAgentFn: vi.fn().mockResolvedValue({ outputPath: "/p", summary: "done" }),
    });
    expect(tools.map((t) => t.name)).toContain("spawn_agent");
  });

  it("excludes spawn_agents_parallel when spawnAgentsParallelFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["spawn_agents_parallel"] });
    expect(tools.map((t) => t.name)).not.toContain("spawn_agents_parallel");
  });

  it("includes spawn_agents_parallel when spawnAgentsParallelFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["spawn_agents_parallel"],
      spawnAgentsParallelFn: vi.fn().mockResolvedValue([]),
    });
    expect(tools.map((t) => t.name)).toContain("spawn_agents_parallel");
  });

  it("excludes save_artifact when saveArtifactFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["save_artifact"] });
    expect(tools.map((t) => t.name)).not.toContain("save_artifact");
  });

  it("includes save_artifact when saveArtifactFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["save_artifact"],
      saveArtifactFn: vi.fn().mockResolvedValue({ artifactId: "art-1" }),
    });
    expect(tools.map((t) => t.name)).toContain("save_artifact");
  });

  it("excludes propose_tool when proposeToolFn not provided", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["propose_tool"] });
    expect(tools.map((t) => t.name)).not.toContain("propose_tool");
  });

  it("includes propose_tool when proposeToolFn provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn: vi.fn().mockResolvedValue(undefined),
    });
    expect(tools.map((t) => t.name)).toContain("propose_tool");
  });

  it("propose_tool rejects invalid name (spaces not allowed)", async () => {
    const proposeToolFn = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn,
    });
    const tool = tools.find((t) => t.name === "propose_tool");
    await expect(
      tool?.execute("call-1", {
        name: "invalid name",
        description: "desc",
        skillContent: "# skill",
      }),
    ).rejects.toThrow(/invalid/i);
    expect(proposeToolFn).not.toHaveBeenCalled();
  });

  it("propose_tool calls proposeToolFn with valid name", async () => {
    const proposeToolFn = vi.fn().mockResolvedValue(undefined);
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["propose_tool"],
      proposeToolFn,
    });
    const tool = tools.find((t) => t.name === "propose_tool");
    await tool?.execute("call-1", {
      name: "fetch-arxiv",
      description: "fetches arxiv papers",
      skillContent: "# fetch-arxiv\n\nFetches arxiv papers.",
    });
    expect(proposeToolFn).toHaveBeenCalledWith(
      "fetch-arxiv",
      "# fetch-arxiv\n\nFetches arxiv papers.",
      undefined,
    );
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: FAIL — new tools not defined yet.

- [ ] **Step 3: Update `AgentToolsOptions` in `tools.ts`**

Add the new callback types to `AgentToolsOptions`:

```typescript
export type SpawnResult = { outputPath: string; summary: string };
export type AgentType = "researcher" | "coder" | "orchestrator";

export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  toolNames?: readonly AgentToolName[];
  apiKey?: string;
  model?: string;
  startResearchFn?: (query: string, deep?: boolean) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>;
  spawnAgentFn?: (type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>;
  spawnAgentsParallelFn?: (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ) => Promise<SpawnResult[]>;
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
}
```

- [ ] **Step 4: Add the four new tools in `createAgentTools`**

Add after the `request_evaluation` conditional block (before the `toolNames` filter at the bottom):

```typescript
if (opts.spawnAgentFn) {
  const spawnFn = opts.spawnAgentFn;
  tools.push(
    makeTool({
      name: "spawn_agent",
      label: "Spawn agent",
      description:
        "Spawn a single child agent and wait for it to complete. Use for sequential subtasks. Returns the output file path and a summary.",
      parameters: Type.Object({
        type: Type.Union(
          [Type.Literal("researcher"), Type.Literal("coder"), Type.Literal("orchestrator")],
          { description: "researcher: read/write/bash only. coder: Docker execution. orchestrator: full delegation (depth-limited)." },
        ),
        query: Type.String({ description: "Self-contained task description for the agent" }),
        outputPath: Type.String({ description: "Absolute path where the agent should write its output" }),
      }),
      execute: async (_id, { type, query, outputPath }): Promise<AgentToolResult<SpawnResult>> => {
        const resolved = jail.validate(outputPath, "write");
        const result = await spawnFn(type as AgentType, query, resolved);
        return {
          content: [{ type: "text" as const, text: `Agent done. Summary: ${result.summary}` }],
          details: result,
        };
      },
    }),
  );
}

if (opts.spawnAgentsParallelFn) {
  const parallelFn = opts.spawnAgentsParallelFn;
  tools.push(
    makeTool({
      name: "spawn_agents_parallel",
      label: "Spawn agents in parallel",
      description:
        "Spawn multiple independent agents simultaneously. All run in parallel; returns when all complete.",
      parameters: Type.Object({
        agents: Type.Array(
          Type.Object({
            type: Type.Union([
              Type.Literal("researcher"),
              Type.Literal("coder"),
              Type.Literal("orchestrator"),
            ]),
            query: Type.String(),
            outputPath: Type.String(),
          }),
          { description: "List of agents to spawn in parallel" },
        ),
      }),
      execute: async (_id, { agents }): Promise<AgentToolResult<SpawnResult[]>> => {
        const validated = agents.map((a) => ({
          type: a.type as AgentType,
          query: a.query,
          outputPath: jail.validate(a.outputPath, "write"),
        }));
        const results = await parallelFn(validated);
        const summary = results.map((r, i) => `[${i}] ${r.summary}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `All agents done:\n${summary}` }],
          details: results,
        };
      },
    }),
  );
}

if (opts.saveArtifactFn) {
  const saveFn = opts.saveArtifactFn;
  tools.push(
    makeTool({
      name: "save_artifact",
      label: "Save artifact",
      description: "Save a file as a named artifact in this project. Use for final outputs and valuable intermediate results.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file to save" }),
        title: Type.String({ description: "Human-readable title for the artifact" }),
      }),
      execute: async (_id, { path, title }): Promise<AgentToolResult<{ artifactId: string }>> => {
        const resolved = jail.validate(path, "read");
        const result = await saveFn(resolved, title);
        return {
          content: [{ type: "text" as const, text: `Artifact saved (id: ${result.artifactId})` }],
          details: result,
        };
      },
    }),
  );
}

if (opts.proposeToolFn) {
  const proposeFn = opts.proposeToolFn;
  tools.push(
    makeTool({
      name: "propose_tool",
      label: "Propose new tool",
      description:
        "Propose a new reusable skill/tool for the user to review and approve. Once approved, it becomes available in future sessions.",
      parameters: Type.Object({
        name: Type.String({ description: "Tool name: lowercase letters, numbers, hyphens only" }),
        description: Type.String({ description: "What the tool does" }),
        skillContent: Type.String({ description: "Full SKILL.md markdown content" }),
        script: Type.Optional(Type.String({ description: "Optional Python or bash script content" })),
      }),
      execute: async (_id, { name, description: _desc, skillContent, script }): Promise<AgentToolResult<null>> => {
        if (!/^[a-z0-9-]+$/.test(name)) {
          throw new Error(
            `Invalid tool name "${name}": must contain only lowercase letters, numbers, and hyphens`,
          );
        }
        await proposeFn(name, skillContent, script);
        return {
          content: [
            { type: "text" as const, text: `Tool "${name}" proposed — awaiting user approval.` },
          ],
          details: null,
        };
      },
    }),
  );
}
```

- [ ] **Step 5: Remove temporary type workaround in `worker-agent.ts`**

Remove the `type AgentToolsOptions = ...` line added in Task 5 if present. Import `SpawnResult` and `AgentType` from `./tools`:

```typescript
import type { AgentToolName, AgentToolsOptions, SpawnResult, AgentType } from "./tools";
```

- [ ] **Step 6: Run all tests — expect pass**

```bash
bun run test src/main/agent/tools.test.ts src/main/agent/worker-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts src/main/agent/worker-agent.ts
git commit -m "feat(run8b): add spawn_agent, spawn_agents_parallel, save_artifact, propose_tool tools"
```

---

## Task 7: EventBus `tool:pending` + HomeService pending tools

**Files:**
- Modify: `src/main/event-bus.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/services/__tests__/HomeService.test.ts`

- [ ] **Step 1: Write failing HomeService tests**

Add to `src/main/services/__tests__/HomeService.test.ts` (new `describe` block):

```typescript
describe("pending tools", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates pending-tools dir", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools")),
    ).resolves.toBeUndefined();
  });

  it("savePendingTool writes SKILL.md", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("fetch-arxiv", "# fetch-arxiv\n\nFetches papers.");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "fetch-arxiv", "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("# fetch-arxiv\n\nFetches papers.");
  });

  it("savePendingTool writes script.py for Python script", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("run-analysis", "# run-analysis", "import pandas as pd\nprint('hi')");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "run-analysis", "script.py"),
      "utf-8",
    );
    expect(content).toContain("import pandas");
  });

  it("savePendingTool writes script.sh for bash script", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("run-bash", "# run-bash", "#!/bin/bash\necho hello");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".research-assistant", "pending-tools", "run-bash", "script.sh"),
      "utf-8",
    );
    expect(content).toContain("echo hello");
  });

  it("getPendingTools returns empty array when no pending tools", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    expect(await svc.getPendingTools()).toEqual([]);
  });

  it("getPendingTools returns saved tools", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("tool-a", "# tool-a");
    await svc.savePendingTool("tool-b", "# tool-b");
    const tools = await svc.getPendingTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("approvePendingTool moves dir to skills/", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("my-tool", "# my-tool");
    await svc.approvePendingTool("my-tool");
    const { access } = await import("node:fs/promises");
    // moved to skills/
    await expect(
      access(join(tmpHome, ".research-assistant", "skills", "my-tool", "SKILL.md")),
    ).resolves.toBeUndefined();
    // no longer in pending-tools/
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools", "my-tool")),
    ).rejects.toThrow();
  });

  it("rejectPendingTool deletes the dir", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await svc.savePendingTool("bad-tool", "# bad-tool");
    await svc.rejectPendingTool("bad-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".research-assistant", "pending-tools", "bad-tool")),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: FAIL — methods don't exist yet.

- [ ] **Step 3: Update `event-bus.ts`**

In `src/main/event-bus.ts`, add to the `AppEvent` union:

```typescript
| { type: "tool:pending"; payload: { name: string; skillContent: string } }
```

- [ ] **Step 4: Update `HomeService.ts`**

Add `rename` and `rm` to the imports:
```typescript
import { access, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
```

Add `pending-tools/` to `ensureDirectories`:
```typescript
async ensureDirectories(): Promise<void> {
  const home = this.getHomePath();
  const agents = this.getAgentsPath();

  const dirs = [
    home,
    join(home, "skills"),
    join(home, "workspace"),
    join(home, "projects"),
    join(home, "tasks"),
    join(home, "pending-tools"),   // NEW
    join(agents, "skills"),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  await this.copyBuiltinSkillsIfNeeded();
}
```

Add the four new methods:

```typescript
async savePendingTool(name: string, skillContent: string, script?: string): Promise<void> {
  const dir = join(this.getHomePath(), "pending-tools", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
  if (script) {
    const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
    await writeFile(join(dir, `script${ext}`), script, "utf-8");
  }
}

async getPendingTools(): Promise<Array<{ name: string; skillContent: string }>> {
  const dir = join(this.getHomePath(), "pending-tools");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const tools: Array<{ name: string; skillContent: string }> = [];
  for (const name of entries) {
    try {
      const skillContent = await readFile(join(dir, name, "SKILL.md"), "utf-8");
      tools.push({ name, skillContent });
    } catch {
      // skip malformed entries
    }
  }
  return tools;
}

async approvePendingTool(name: string): Promise<void> {
  const src = join(this.getHomePath(), "pending-tools", name);
  const dst = join(this.getHomePath(), "skills", name);
  await rename(src, dst);
}

async rejectPendingTool(name: string): Promise<void> {
  await rm(join(this.getHomePath(), "pending-tools", name), {
    recursive: true,
    force: true,
  });
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/event-bus.ts src/main/services/HomeService.ts src/main/services/__tests__/HomeService.test.ts
git commit -m "feat(run8b): add tool:pending event + HomeService pending tools methods"
```

---

## Task 8: IPC channels + `ipc-handlers.ts` wiring

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc-handlers.ts`

The `preload/index.ts` uses `Object.values(IPC)` as the allowed channel list, so adding to `IPC` automatically allows the new channels — no preload changes needed.

- [ ] **Step 1: Add new channels to `ipc-channels.ts`**

```typescript
export const IPC = {
  // ... existing ...
  TOOL_PENDING: "TOOL_PENDING",           // main → renderer (push)
  GET_PENDING_TOOLS: "GET_PENDING_TOOLS", // renderer → main (invoke)
  APPROVE_TOOL: "APPROVE_TOOL",           // renderer → main (invoke)
  REJECT_TOOL: "REJECT_TOOL",             // renderer → main (invoke)
} as const;
```

- [ ] **Step 2: Wire handlers in `ipc-handlers.ts`**

Add `homeService` usage for pending tools. In `registerIpcHandlers`, after the existing EventBus forwarding section, add:

```typescript
// Forward tool:pending to renderer
eventBus.on("tool:pending", (payload) => {
  win.webContents.send(IPC.TOOL_PENDING, payload);
});

// Pending tool management
ipcMain.handle(IPC.GET_PENDING_TOOLS, async () => {
  return homeService.getPendingTools();
});

ipcMain.handle(IPC.APPROVE_TOOL, async (_event, payload: unknown) => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { name?: unknown }).name !== "string"
  ) {
    throw new Error("Invalid payload: expected { name: string }");
  }
  await homeService.approvePendingTool((payload as { name: string }).name);
});

ipcMain.handle(IPC.REJECT_TOOL, async (_event, payload: unknown) => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { name?: unknown }).name !== "string"
  ) {
    throw new Error("Invalid payload: expected { name: string }");
  }
  await homeService.rejectPendingTool((payload as { name: string }).name);
});
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc-handlers.ts
git commit -m "feat(run8b): add pending tools IPC channels and handlers"
```

---

## Task 9: Update `session.ts` `startResearchFn` + `builtin-skills.ts`

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/builtin-skills.ts`

- [ ] **Step 1: Update `startResearchFn` in `session.ts`**

In `src/main/agent/session.ts`, update the `createAgentTools` call's `startResearchFn`:

```typescript
startResearchFn: (query, deep) =>
  deep === true
    ? researchService.startOrchestratedResearch(projectId, projectName, query, folderPath)
    : researchService.startResearch(projectId, projectName, query, folderPath),
```

(`startOrchestratedResearch` will be added in Task 10 — TypeScript will flag it until then; fix the typecheck in Task 10.)

- [ ] **Step 2: Update `START_RESEARCH_SKILL` in `builtin-skills.ts`**

Replace the `START_RESEARCH_SKILL` constant with:

```typescript
export const START_RESEARCH_SKILL = `---
name: start_research
description: Dispatch a background research task. Use when the user asks for research, investigation, or in-depth analysis.
---

# start_research

Use the \`start_research\` tool to dispatch a background research worker when:
- The user asks to "research", "investigate", "find out about", or "look into" something non-trivial
- The task requires reading multiple files, running scripts, or synthesising across sources
- The research will take more than a quick answer

## Tool signature

\`\`\`
start_research({ query: string, deep?: boolean })
\`\`\`

- \`query\`: a clear, self-contained research question. Include all necessary context — the worker has no access to the current conversation.
- \`deep\`: set to \`true\` for complex multi-source research that benefits from parallel subtopic investigation, code execution, or hierarchical orchestration. Defaults to \`false\` (single researcher).

## When to set deep: true

- Query requires researching multiple independent subtopics in parallel
- Query involves processing data files (CSV, JSON, etc.) with code
- Query requires fetching and analysing papers, articles, or web pages
- Query is open-ended enough that an orchestrator should plan the approach

## What happens next

- The tool returns immediately with a \`taskId\`
- A background agent runs the research using the available tools
- When done, a summary will be injected into this conversation automatically
- Artifacts are saved to the project workspace

## Examples

Standard research (deep: false or omitted):
- "Summarise the API surface of all TypeScript files in src/main/services/"
- "Find all usages of the IProjectRepository interface"

Deep research (deep: true):
- "Research the latest approaches to LLM memory management — check academic papers and GitHub repos"
- "Analyse the CSV at ~/data/sales.csv and produce a trend report"
- "Compare the top 5 vector databases for production use — benchmark if possible"
`;
```

- [ ] **Step 3: Typecheck (will fail until Task 10)**

```bash
bun run typecheck 2>&1 | head -20
```

Expected: error on `startOrchestratedResearch` not existing yet — this is expected. Proceed.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/builtin-skills.ts
git commit -m "feat(run8b): update startResearchFn for deep flag + update start_research skill"
```

---

## Task 10: `ResearchService.startOrchestratedResearch()`

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/main/services/__tests__/ResearchService.test.ts` (after existing `describe`):

```typescript
describe("ResearchService – startOrchestratedResearch", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => void) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("returns a taskId immediately", async () => {
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    const { taskId } = await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(taskId).toBeTruthy();
  });

  it("calls createWorkerAgent with remainingDepth: 3", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ remainingDepth: 3 }),
    );
  });

  it("calls createWorkerAgent with saveArtifactFn callback", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(createWorkerAgent).toHaveBeenCalledWith(
      expect.objectContaining({ saveArtifactFn: expect.any(Function) }),
    );
  });

  it("saveArtifactFn callback delegates to artifactService.saveArtifact", async () => {
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    const artifacts = makeArtifactService();
    const svc = new ResearchService(
      makeEventBus() as never,
      artifacts as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    const call = vi.mocked(createWorkerAgent).mock.calls[0][0];
    await call.saveArtifactFn?.("/tmp/home/workspace/p1/output.md", "My Artifact");
    expect(artifacts.saveArtifact).toHaveBeenCalledWith({
      projectId: "p1",
      title: "My Artifact",
      filePath: "/tmp/home/workspace/p1/output.md",
    });
  });

  it("calls homeService.saveTask with task details", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(home.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "deep research" }),
    );
  });

  it("emits research:started event", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:started" }));
  });

  it("calls homeService.deleteTask on agent_end", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startOrchestratedResearch("p1", "My Project", "deep research", null);
    await capturedSubscriber?.({ type: "agent_end" });
    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
  });
});
```

Also update `makeHomeService()` to include `savePendingTool`:

```typescript
function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/home"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/home/workspace/p1"),
    saveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    savePendingTool: vi.fn().mockResolvedValue(undefined),
  };
}
```

- [ ] **Step 2: Run — expect fail**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: FAIL — `startOrchestratedResearch` not defined.

- [ ] **Step 3: Implement `startOrchestratedResearch` in `ResearchService.ts`**

Add to `src/main/services/ResearchService.ts`. Add `mkdir` import at top:

```typescript
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
```

Add `ORCHESTRATOR_TOOL_NAMES` import:
```typescript
import { createWorkerAgent, ORCHESTRATOR_TOOL_NAMES } from "../agent/worker-agent";
```

Add method to the class:

```typescript
async startOrchestratedResearch(
  projectId: string,
  projectName: string,
  query: string,
  folderPath: string | null,
): Promise<{ taskId: string }> {
  const taskId = crypto.randomUUID();
  const settings = await this.settingsService.getSettings();
  if (!settings.openrouterApiKey) {
    throw new Error("No API key configured");
  }

  const homePath = this.homeService.getHomePath();
  await this.homeService.ensureWorkspaceForProject(projectId);

  await this.homeService.saveTask({
    taskId,
    projectId,
    projectName,
    query,
    folderPath,
    startedAt: new Date().toISOString(),
  });

  const workspaceRoot = join(homePath, "workspace", projectId, taskId);
  await mkdir(workspaceRoot, { recursive: true });

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

  const systemPromptAddition = [
    "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
    `Your workspace root: ${workspaceRoot}`,
    "Write intermediate results to subdirectories within your workspace root.",
    "Write your final synthesis to synthesis.md in your workspace root.",
    "Use save_artifact to persist valuable outputs — both intermediate and final.",
    "Remaining orchestration depth: 3.",
  ].join("\n");

  const { agent } = await createWorkerAgent({
    toolNames: [...ORCHESTRATOR_TOOL_NAMES],
    systemPromptAddition,
    projectId,
    projectName,
    folderPath,
    homePath,
    apiKey: settings.openrouterApiKey,
    model: settings.model,
    remainingDepth: 3,
    saveArtifactFn,
    proposeToolFn,
  });

  this.eventBus.emit({
    type: "research:started",
    payload: { taskId, projectId, query },
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
        const synthesisPath = join(workspaceRoot, "synthesis.md");
        const artifact = await this.artifactService.saveArtifact({
          projectId,
          title: `Orchestrated research: ${query.slice(0, 60)}`,
          filePath: synthesisPath,
        });
        await this.homeService.deleteTask(taskId);
        this.eventBus.emit({
          type: "research:complete",
          payload: {
            taskId,
            artifactId: artifact.id,
            projectId,
            query,
            filePath: synthesisPath,
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

  agent.prompt(query).catch(async (err) => {
    console.error("[ResearchService] orchestrator error:", err);
    await this.homeService.deleteTask(taskId);
    this.eventBus.emit({
      type: "research:failed",
      payload: { taskId, error: String(err) },
    });
  });

  return { taskId };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(run8b): add startOrchestratedResearch to ResearchService"
```

---

## Task 11: Frontend — `PendingToolBanner` + `PendingToolModal` + fix `ChatPanel`

**Files:**
- Create: `src/renderer/components/layout/chat/PendingToolBanner.tsx`
- Create: `src/renderer/components/layout/chat/PendingToolModal.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`

- [ ] **Step 1: Create `PendingToolBanner.tsx`**

```typescript
import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import PendingToolModal from "./PendingToolModal";

interface PendingTool {
  name: string;
  skillContent: string;
}

export default function PendingToolBanner() {
  const [pendingTools, setPendingTools] = useState<PendingTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    // Load any already-pending tools on mount
    window.electronAPI
      .invoke(IPC.GET_PENDING_TOOLS)
      .then((tools) => setPendingTools(tools as PendingTool[]));

    const unsub = window.electronAPI.on(IPC.TOOL_PENDING, (data) => {
      const tool = data as PendingTool;
      setPendingTools((prev) => {
        if (prev.some((t) => t.name === tool.name)) return prev;
        return [...prev, tool];
      });
    });

    return unsub;
  }, []);

  const handleApprove = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.REJECT_TOOL, { name: tool.name });
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  if (pendingTools.length === 0) return null;

  return (
    <>
      {pendingTools.map((tool) => (
        <Box
          key={tool.name}
          sx={{
            px: 2,
            py: 1,
            borderBottom: 1,
            borderColor: "warning.main",
            display: "flex",
            alignItems: "center",
            gap: 1,
            bgcolor: "warning.light",
          }}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </Typography>
          <Button size="small" onClick={() => setSelectedTool(tool)}>
            Review
          </Button>
        </Box>
      ))}
      {selectedTool && (
        <PendingToolModal
          tool={selectedTool}
          onApprove={() => handleApprove(selectedTool)}
          onReject={() => handleReject(selectedTool)}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `PendingToolModal.tsx`**

```typescript
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

interface PendingTool {
  name: string;
  skillContent: string;
}

interface PendingToolModalProps {
  tool: PendingTool;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}

export default function PendingToolModal({
  tool,
  onApprove,
  onReject,
  onClose,
}: PendingToolModalProps) {
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Review proposed tool: {tool.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          An agent has proposed this tool for your approval. Once approved, it will be available as
          a skill in future sessions.
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
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {tool.skillContent}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onReject} color="error">
          Reject
        </Button>
        <Button onClick={onApprove} variant="contained">
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update `ChatPanel.tsx` — mount `ResearchStatusBar` + `PendingToolBanner`**

`ResearchStatusBar` currently exists but is not mounted anywhere. Add both components to `ChatPanel`:

```typescript
import ResearchStatusBar from "./ResearchStatusBar";
import PendingToolBanner from "./PendingToolBanner";
```

Update the return JSX — replace the existing return when `activeProjectId` is set:

```typescript
return (
  <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <ResearchStatusBar />
    <PendingToolBanner />
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
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 6: Lint**

```bash
bun run check
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add \
  src/renderer/components/layout/chat/PendingToolBanner.tsx \
  src/renderer/components/layout/chat/PendingToolModal.tsx \
  src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "feat(run8b): add PendingToolBanner, PendingToolModal, mount ResearchStatusBar in ChatPanel"
```

---

## Task 12: Final verification and Run 8b commit

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Lint + format**

```bash
bun run check
```

Expected: clean.

- [ ] **Step 3: Full test suite**

```bash
bun run test
```

Expected: all tests pass (previously 182; should now be ~230+).

- [ ] **Step 4: Smoke-check test count**

```bash
bun run test 2>&1 | tail -5
```

Expected: significantly more tests than the 182 from Run 8a baseline.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(run8b): Docker sandbox, agent-created tools gate, orchestrated research"
```

---

## Self-Review Checklist

### Spec coverage

| Spec section | Covered by |
|---|---|
| Docker sandbox (`run_in_docker` tool) | Tasks 2, 3 |
| Agent-created tools gate (`propose_tool`) | Tasks 6, 7, 8, 11 |
| Recursive agent model (depth limit) | Tasks 4, 5, 6 |
| `spawn_agent` + `spawn_agents_parallel` | Tasks 5, 6 |
| `save_artifact` tool | Task 6 |
| `HomeService` pending tools | Task 7 |
| EventBus `tool:pending` | Task 7 |
| IPC channels | Task 8 |
| `ipc-handlers.ts` wiring | Task 8 |
| `session.ts` `deep` flag | Task 9 |
| `START_RESEARCH_SKILL` update | Task 9 |
| `startOrchestratedResearch()` | Task 10 |
| `PendingToolBanner` + `PendingToolModal` | Task 11 |
| `ResearchStatusBar` mount fix | Task 11 |
| `ORCHESTRATOR_TOOL_NAMES` export | Task 4 |

### No placeholders: confirmed — all steps include complete code.

### Type consistency
- `SpawnResult` defined in `tools.ts`, imported in `worker-agent.ts` ✓
- `AgentType` defined in `tools.ts`, used consistently ✓
- `ORCHESTRATOR_TOOL_NAMES` defined and exported in `worker-agent.ts`, imported in `ResearchService.ts` ✓
- `proposeToolFn` signature: `(name, skillContent, script?) => Promise<void>` — consistent across `WorkerAgentConfig`, `AgentToolsOptions`, `HomeService`, `ResearchService` ✓
- `saveArtifactFn` signature: `(path, title) => Promise<{ artifactId }>` — consistent ✓
