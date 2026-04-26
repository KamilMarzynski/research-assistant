# Run 8a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `createWorkerAgent` factory, a `request_evaluation` Pi tool, task persistence that survives restarts, and auto-resume of in-progress research tasks on app start.

**Architecture:** `createWorkerAgent(config)` is a thin async factory in `worker-agent.ts` that builds a Pi `Agent` with a filtered tool subset and injected skill content. To avoid a circular import (`tools.ts` ↔ `worker-agent.ts`), the `request_evaluation` tool receives its evaluator logic as a callback (`requestEvaluationFn`) injected by the caller — same pattern as `startResearchFn`. `makeEvaluatorFn` in `worker-agent.ts` creates this callback and is wired in both `session.ts` (main agent) and `createWorkerAgent` itself (researcher agents). `ResearchService` is refactored to use `createWorkerAgent` and gains task JSON persistence via `HomeService`.

**Tech Stack:** Bun, TypeScript strict, `@mariozechner/pi-agent-core` (`Agent`), `@mariozechner/pi-ai` (`getModel`), Vitest, TSyringe, `node:fs/promises`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/agent/tools.ts` | Modify | Add `AgentToolName` union, `EvaluationVerdict`, `requestEvaluationFn?` + `toolNames?` + `apiKey?` + `model?` to options, `toolNames` filter, `request_evaluation` tool |
| `src/main/agent/tools.test.ts` | Create | Test toolNames filter and request_evaluation tool |
| `src/main/agent/context.ts` | Modify | Add `loadSkillsByContent` export |
| `src/main/agent/context.test.ts` | Modify | Add `loadSkillsByContent` tests |
| `src/main/agent/worker-agent.ts` | Create | `WorkerAgentConfig`, `WorkerAgent`, `makeEvaluatorFn`, `createWorkerAgent` |
| `src/main/agent/worker-agent.test.ts` | Create | Test factory creates correct tool subset and `run()` resolves with text |
| `src/main/agent/builtin-skills.ts` | Modify | Add `EVALUATE_RESEARCH_SKILL` constant |
| `src/main/agent/session.ts` | Modify | Pass `apiKey`, `model`, `requestEvaluationFn` to `createAgentTools` |
| `src/main/agent/session.test.ts` | Modify | Pass `apiKey`/`model` in test options |
| `src/main/services/HomeService.ts` | Modify | Add `ResearchTask` type, `saveTask`, `deleteTask`, `getInProgressTasks`; register evaluate-research builtin |
| `src/main/services/__tests__/HomeService.test.ts` | Modify | Test task persistence round-trip, evaluate-research skill written |
| `src/main/services/ResearchService.ts` | Modify | Use `createWorkerAgent`; call `saveTask`/`deleteTask` |
| `src/main/services/__tests__/ResearchService.test.ts` | Modify | Mock `worker-agent` instead of `Agent`; assert task save/delete |
| `src/main/ipc-handlers.ts` | Modify | Auto-resume in-progress tasks after EventBus wiring |

---

## Task 1: `AgentToolName` + `toolNames` filter + options extension

**Files:**
- Modify: `src/main/agent/tools.ts`
- Create: `src/main/agent/tools.test.ts`

- [ ] **Step 1: Write failing tests for toolNames filter**

Create `src/main/agent/tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "./tools";

const BASE = {
  projectId: "p1",
  projectName: "Test",
  folderPath: null,
  homePath: "/tmp/home",
};

describe("createAgentTools – toolNames filter", () => {
  it("returns all built-in tools when toolNames not provided", () => {
    const tools = createAgentTools(BASE);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("safe_bash");
  });

  it("filters to specified tool names", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["read_file", "list_dir"] });
    expect(tools.map((t) => t.name)).toEqual(["read_file", "list_dir"]);
  });

  it("excludes start_research when startResearchFn not provided even if in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "start_research"],
    });
    expect(tools.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("includes start_research when startResearchFn provided and in toolNames", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "start_research"],
      startResearchFn: vi.fn().mockResolvedValue({ taskId: "x" }),
    });
    expect(tools.map((t) => t.name)).toContain("start_research");
  });

  it("excludes request_evaluation when requestEvaluationFn not provided", () => {
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "request_evaluation"],
    });
    expect(tools.map((t) => t.name)).not.toContain("request_evaluation");
  });

  it("includes request_evaluation when requestEvaluationFn provided and in toolNames", () => {
    const fn = vi.fn().mockResolvedValue({ pass: true, criteria: [] });
    const tools = createAgentTools({
      ...BASE,
      toolNames: ["read_file", "request_evaluation"],
      requestEvaluationFn: fn,
    });
    expect(tools.map((t) => t.name)).toContain("request_evaluation");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: several failures — `toolNames` property not in `AgentToolsOptions`, filter not implemented, `request_evaluation` tool not in output.

- [ ] **Step 3: Add `AgentToolName`, `EvaluationVerdict`, extend `AgentToolsOptions`, add filter to `tools.ts`**

Add these exports at the top of `src/main/agent/tools.ts`, before `AgentToolsOptions`:

```ts
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "request_evaluation"
  | "start_research";

export interface EvaluationVerdict {
  pass: boolean;
  criteria: Array<{ name: string; pass: boolean; rationale: string }>;
}
```

Replace the existing `AgentToolsOptions` interface:

```ts
export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  toolNames?: AgentToolName[];
  apiKey?: string;
  model?: string;
  startResearchFn?: (query: string) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (
    filePath: string,
    criteria: string[],
  ) => Promise<EvaluationVerdict>;
}
```

At the end of `createAgentTools`, before the final `return tools`, add the `request_evaluation` conditional push and the filter. Replace the final `return tools` block:

```ts
  if (startResearchFn) {
    tools.push(
      makeTool({
        name: "start_research",
        // ... existing start_research tool definition unchanged ...
      }),
    );
  }

  if (opts.requestEvaluationFn) {
    const evaluateFn = opts.requestEvaluationFn;
    tools.push(
      makeTool({
        name: "request_evaluation",
        label: "Request evaluation",
        description:
          "Ask the evaluator agent to assess a research output file against a list of criteria. Returns a structured pass/fail verdict.",
        parameters: Type.Object({
          filePath: Type.String({ description: "Absolute path to the research output file" }),
          criteria: Type.Array(Type.String(), {
            description: "List of criteria to evaluate the file against",
          }),
        }),
        execute: async (_id, { filePath, criteria }): Promise<AgentToolResult<EvaluationVerdict>> => {
          const verdict = await evaluateFn(filePath, criteria);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(verdict, null, 2) }],
            details: verdict,
          };
        },
      }),
    );
  }

  if (opts.toolNames) {
    const allowed = new Set<string>(opts.toolNames);
    return tools.filter((t) => allowed.has(t.name));
  }
  return tools;
```

Note: keep the existing `start_research` block exactly as it is — only add the `request_evaluation` block and the filter after it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/tools.test.ts
git commit -m "feat(run8a): add AgentToolName, toolNames filter, and request_evaluation hook to createAgentTools"
```

---

## Task 2: `loadSkillsByContent` in `context.ts`

**Files:**
- Modify: `src/main/agent/context.ts`
- Modify: `src/main/agent/context.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the end of `src/main/agent/context.test.ts` (inside the same describe wrapper that uses `tmpHome`):

```ts
// Add to imports at top of file:
// import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
// (rm is already imported; add if not present)

// Add loadSkillsByContent to the dynamic import line:
const { loadSkills, buildSystemContext, toSlug, loadSkillsByContent } = await import("./context");

describe("loadSkillsByContent", () => {
  it("returns empty string for empty names array", async () => {
    expect(await loadSkillsByContent([], undefined)).toBe("");
  });

  it("returns SKILL.md full content for a matching skill", async () => {
    const skillDir = join(tmpHome, ".research-assistant", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: does stuff\n---\n# Instructions\nDo the thing.",
    );
    const result = await loadSkillsByContent(["my-skill"], undefined);
    expect(result).toContain("# Instructions");
    expect(result).toContain("Do the thing.");
  });

  it("returns empty string for unknown skill name", async () => {
    const result = await loadSkillsByContent(["nonexistent-skill"], undefined);
    expect(result).toBe("");
  });

  it("joins multiple skills with separator", async () => {
    for (const name of ["skill-a", "skill-b"]) {
      const dir = join(tmpHome, ".research-assistant", "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${name}`);
    }
    const result = await loadSkillsByContent(["skill-a", "skill-b"], undefined);
    expect(result).toContain("# skill-a");
    expect(result).toContain("# skill-b");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/main/agent/context.test.ts
```

Expected: `loadSkillsByContent is not a function` or similar.

- [ ] **Step 3: Add `loadSkillsByContent` to `context.ts`**

Add this export to the end of `src/main/agent/context.ts`:

```ts
export async function loadSkillsByContent(
  skillNames: string[],
  projectFolderPath: string | undefined,
): Promise<string> {
  if (skillNames.length === 0) return "";

  const home = join(homedir(), ".research-assistant");
  const agents = join(homedir(), ".agents");

  // Same priority order as loadSkills — later dirs have higher priority
  const dirs = [
    join(agents, "skills"),
    join(home, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath
      ? [join(projectFolderPath, ".research-assistant", "skills")]
      : []),
  ];

  const parts: string[] = [];
  for (const name of skillNames) {
    // Search highest-priority dirs first
    for (const dir of [...dirs].reverse()) {
      const skillPath = join(dir, name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        parts.push(content.trim());
        break;
      } catch {
        // not in this dir, try next
      }
    }
  }

  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/agent/context.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/context.ts src/main/agent/context.test.ts
git commit -m "feat(run8a): add loadSkillsByContent helper to context"
```

---

## Task 3: `createWorkerAgent` factory

**Files:**
- Create: `src/main/agent/worker-agent.ts`
- Create: `src/main/agent/worker-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/worker-agent.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Captured subscriber so tests can fire Pi events manually
let capturedSubscriber: ((event: unknown) => Promise<void>) | null = null;

const mockAgent = {
  state: { tools: [] as never[], systemPrompt: "" },
  subscribe: vi.fn((cb: (event: unknown) => Promise<void>) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest constructable mock
  Agent: vi.fn(function () {
    return mockAgent;
  }),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("./context", () => ({
  loadSkillsByContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("./tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([{ name: "read_file" }, { name: "safe_bash" }]),
}));

const { createWorkerAgent } = await import("./worker-agent");

const BASE_CONFIG = {
  toolNames: ["read_file", "safe_bash"] as const,
  systemPromptAddition: "You are a worker.",
  projectId: "proj-1",
  projectName: "Test",
  folderPath: null,
  homePath: "/tmp/home",
  apiKey: "sk-or-test",
  model: "anthropic/claude-sonnet-4-5",
};

describe("createWorkerAgent", () => {
  beforeEach(() => {
    capturedSubscriber = null;
    vi.clearAllMocks();
    mockAgent.subscribe.mockImplementation((cb: (event: unknown) => Promise<void>) => {
      capturedSubscriber = cb;
    });
    mockAgent.prompt.mockResolvedValue(undefined);
  });

  it("creates a Pi Agent and assigns tools", async () => {
    const { agent } = await createWorkerAgent(BASE_CONFIG);
    expect(agent).toBe(mockAgent);
    expect(mockAgent.state.tools).toHaveLength(2);
  });

  it("calls loadSkillsByContent with provided skill names", async () => {
    const { loadSkillsByContent } = await import("./context");
    await createWorkerAgent({ ...BASE_CONFIG, skills: ["evaluate-research"] });
    expect(loadSkillsByContent).toHaveBeenCalledWith(["evaluate-research"], undefined);
  });

  it("run() resolves with accumulated text_delta chunks", async () => {
    mockAgent.prompt.mockImplementation(async () => {
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello " },
      });
      await capturedSubscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "world" },
      });
      await capturedSubscriber?.({ type: "agent_end" });
    });

    const { run } = await createWorkerAgent(BASE_CONFIG);
    const result = await run("test prompt");
    expect(result).toBe("Hello world");
  });

  it("run() rejects when agent.prompt throws", async () => {
    mockAgent.prompt.mockRejectedValue(new Error("network error"));
    const { run } = await createWorkerAgent(BASE_CONFIG);
    await expect(run("test")).rejects.toThrow("network error");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: `Cannot find module './worker-agent'`.

- [ ] **Step 3: Create `worker-agent.ts`**

Create `src/main/agent/worker-agent.ts`:

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { loadSkillsByContent } from "./context";
import { createAgentTools } from "./tools";
import type { AgentToolName, EvaluationVerdict } from "./tools";

export interface WorkerAgentConfig {
  toolNames: AgentToolName[];
  systemPromptAddition: string;
  skills?: string[];
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  apiKey: string;
  model: string;
}

export interface WorkerAgent {
  agent: Agent;
  run: (input: string) => Promise<string>;
}

export interface EvaluatorBaseConfig {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  apiKey: string;
  model: string;
}

export function makeEvaluatorFn(
  base: EvaluatorBaseConfig,
): (filePath: string, criteria: string[]) => Promise<EvaluationVerdict> {
  return async (filePath, criteria) => {
    const { run } = await createWorkerAgent({
      toolNames: ["read_file", "safe_bash"],
      systemPromptAddition:
        "You are a research evaluator. Read the file at the given path, assess it against the criteria, and respond with ONLY a JSON object. No preamble. No explanation.",
      skills: ["evaluate-research"],
      ...base,
    });
    const prompt = [
      `Evaluate the research output at: ${filePath}`,
      "",
      "Criteria:",
      ...criteria.map((c) => `- ${c}`),
      "",
      "Respond with JSON only.",
    ].join("\n");
    const output = await run(prompt);
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        pass: false,
        criteria: [
          {
            name: "parse-error",
            pass: false,
            rationale: "evaluator did not return valid JSON",
          },
        ],
      };
    }
    try {
      return JSON.parse(match[0]) as EvaluationVerdict;
    } catch {
      return {
        pass: false,
        criteria: [
          {
            name: "parse-error",
            pass: false,
            rationale: "evaluator returned malformed JSON",
          },
        ],
      };
    }
  };
}

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
  } = config;

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
    toolNames,
    requestEvaluationFn: makeEvaluatorFn({ projectId, projectName, folderPath, homePath, apiKey, model }),
  });

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
          if (ae?.type === "text_delta") output += ae.delta;
        } else if (e.type === "agent_end") {
          resolve(output);
        }
      });
      agent.prompt(input).catch(reject);
    });

  return { agent, run };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(run8a): add createWorkerAgent async factory and makeEvaluatorFn"
```

---

## Task 4: `HomeService` — task persistence + evaluate-research builtin skill

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/services/__tests__/HomeService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the end of `src/main/services/__tests__/HomeService.test.ts`:

```ts
  // Add to imports at top of file:
  // import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
  // (add readFile to existing import)

  describe("task persistence", () => {
    it("saveTask writes JSON file to tasks/", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      const task = {
        taskId: "task-abc",
        projectId: "proj-1",
        projectName: "My Project",
        query: "research something",
        folderPath: null,
        startedAt: "2026-04-26T10:00:00.000Z",
      };
      await svc.saveTask(task);
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(
        join(tmpHome, ".research-assistant", "tasks", "task-abc.json"),
        "utf-8",
      );
      expect(JSON.parse(raw)).toEqual(task);
    });

    it("deleteTask removes the JSON file", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      const task = {
        taskId: "task-del",
        projectId: "p",
        projectName: "P",
        query: "q",
        folderPath: null,
        startedAt: "2026-04-26T10:00:00.000Z",
      };
      await svc.saveTask(task);
      await svc.deleteTask("task-del");
      const { access } = await import("node:fs/promises");
      await expect(
        access(join(tmpHome, ".research-assistant", "tasks", "task-del.json")),
      ).rejects.toThrow();
    });

    it("getInProgressTasks returns all saved tasks", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      const tasks = [
        { taskId: "t1", projectId: "p1", projectName: "P1", query: "q1", folderPath: null, startedAt: "2026-04-26T10:00:00.000Z" },
        { taskId: "t2", projectId: "p2", projectName: "P2", query: "q2", folderPath: "/some/path", startedAt: "2026-04-26T11:00:00.000Z" },
      ];
      for (const t of tasks) await svc.saveTask(t);
      const result = await svc.getInProgressTasks();
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.taskId).sort()).toEqual(["t1", "t2"]);
    });

    it("getInProgressTasks returns empty array when tasks/ dir is empty", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      expect(await svc.getInProgressTasks()).toEqual([]);
    });

    it("deleteTask is idempotent — no error on missing file", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      await expect(svc.deleteTask("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("builtin skills", () => {
    it("evaluate-research skill is written on ensureDirectories", async () => {
      const svc = new HomeService();
      await svc.ensureDirectories();
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(
        join(tmpHome, ".research-assistant", "skills", "evaluate-research", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("evaluate-research");
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: `svc.saveTask is not a function` and evaluate-research skill not found.

- [ ] **Step 3: Add `EVALUATE_RESEARCH_SKILL` to `builtin-skills.ts`**

Append to `src/main/agent/builtin-skills.ts`:

```ts
export const EVALUATE_RESEARCH_SKILL = `---
name: evaluate-research
description: Evaluate the completeness and quality of a research output file. Respond with JSON only.
---

# evaluate-research

You are a research evaluator. When invoked:

1. Read the file at the path provided using \`read_file\`
2. Assess it against each criterion listed
3. Respond with **only** a JSON object in this exact format — no preamble, no explanation:

\`\`\`json
{
  "pass": true,
  "criteria": [
    { "name": "criterion name", "pass": true, "rationale": "one sentence" }
  ]
}
\`\`\`

## Evaluation criteria for research outputs

- **Completeness**: does the document address the research question fully?
- **Evidence**: are claims supported by sources or tool outputs?
- **Structure**: is the document organised with clear headings and sections?
- **Actionability**: are findings concrete and useful to the requester?

Apply any additional criteria passed to you in the prompt.
`;
```

- [ ] **Step 4: Add `ResearchTask` type and persistence methods to `HomeService.ts`**

Add the `ResearchTask` interface and import `unlink` + `readFile` in `src/main/services/HomeService.ts`. Replace the file with the updated version:

```ts
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { injectable } from "tsyringe";
import {
  DISCOVER_PROJECT_SKILL,
  EVALUATE_RESEARCH_SKILL,
  START_RESEARCH_SKILL,
} from "../agent/builtin-skills";

export interface ResearchTask {
  taskId: string;
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
  startedAt: string;
}

@injectable()
export class HomeService {
  getHomePath(): string {
    return join(homedir(), ".research-assistant");
  }

  getAgentsPath(): string {
    return join(homedir(), ".agents");
  }

  async ensureDirectories(): Promise<void> {
    const home = this.getHomePath();
    const agents = this.getAgentsPath();

    const dirs = [
      home,
      join(home, "skills"),
      join(home, "workspace"),
      join(home, "projects"),
      join(home, "tasks"),
      join(agents, "skills"),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    await this.copyBuiltinSkillsIfNeeded();
  }

  async isFirstRun(): Promise<boolean> {
    try {
      await access(join(this.getHomePath(), "config.md"));
      return false;
    } catch {
      return true;
    }
  }

  async ensureWorkspaceForProject(projectId: string): Promise<string> {
    const dir = join(this.getHomePath(), "workspace", projectId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async saveTask(task: ResearchTask): Promise<void> {
    const dir = join(this.getHomePath(), "tasks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${task.taskId}.json`), JSON.stringify(task, null, 2), "utf-8");
  }

  async deleteTask(taskId: string): Promise<void> {
    try {
      await unlink(join(this.getHomePath(), "tasks", `${taskId}.json`));
    } catch {
      // already gone — idempotent
    }
  }

  async getInProgressTasks(): Promise<ResearchTask[]> {
    const dir = join(this.getHomePath(), "tasks");
    let entries: string[] = [];
    try {
      entries = (await readdir(dir)).filter((e) => e.endsWith(".json"));
    } catch {
      return [];
    }
    const tasks: ResearchTask[] = [];
    for (const entry of entries) {
      try {
        const raw = await readFile(join(dir, entry), "utf-8");
        tasks.push(JSON.parse(raw) as ResearchTask);
      } catch {
        // skip malformed file
      }
    }
    return tasks;
  }

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    let entries: string[] = [];
    try {
      entries = await readdir(skillsDir);
    } catch {
      // dir doesn't exist yet
    }
    if (entries.length > 0) return;

    const builtins: Array<[string, string]> = [
      ["start_research", START_RESEARCH_SKILL],
      ["discover_project", DISCOVER_PROJECT_SKILL],
      ["evaluate-research", EVALUATE_RESEARCH_SKILL],
    ];

    for (const [name, content] of builtins) {
      const skillDir = join(skillsDir, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/builtin-skills.ts src/main/services/HomeService.ts src/main/services/__tests__/HomeService.test.ts
git commit -m "feat(run8a): add task persistence and evaluate-research builtin skill to HomeService"
```

---

## Task 5: `session.ts` update — wire `apiKey`, `model`, `requestEvaluationFn`

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Update `session.ts` to pass new options to `createAgentTools`**

In `src/main/agent/session.ts`, add the import for `makeEvaluatorFn`:

```ts
import { makeEvaluatorFn } from "./worker-agent";
```

Replace the `createAgentTools` call (lines 102–109) with:

```ts
    this.agent.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey,
      model,
      startResearchFn: (query) =>
        researchService.startResearch(projectId, projectName, query, folderPath),
      requestEvaluationFn: makeEvaluatorFn({
        projectId,
        projectName,
        folderPath,
        homePath,
        apiKey,
        model,
      }),
    });
```

- [ ] **Step 2: Update `session.test.ts` to pass `apiKey` and `model` in options**

In `src/main/agent/session.test.ts`, find the object passed when constructing `AgentSession` in tests and add `apiKey` and `model` fields if they are missing. The existing test options should already include `apiKey` and `model` (from `AgentSessionOptions`). Check the test — if they already pass `apiKey` and `model`, no change needed. If not, add them.

Also add `worker-agent` to mocks so the import doesn't fail:

```ts
vi.mock("./worker-agent", () => ({
  makeEvaluatorFn: vi.fn().mockReturnValue(vi.fn()),
}));
```

Add this mock near the other mocks at the top of the test file.

- [ ] **Step 3: Run tests**

```bash
bun run test src/main/agent/session.test.ts
```

Expected: all tests pass. If `makeEvaluatorFn` wasn't mocked before, add the mock from Step 2 and rerun.

- [ ] **Step 4: Run full test suite to check nothing is broken**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat(run8a): wire apiKey, model, and requestEvaluationFn into AgentSession createAgentTools call"
```

---

## Task 6: `ResearchService` — refactor to `createWorkerAgent` + task persistence

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/services/__tests__/ResearchService.test.ts`, replace the current `pi-agent-core` and `tools` mocks with a mock for `worker-agent`, and add `homeService` to the test helpers.

Replace the entire file with:

```ts
import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

let capturedSubscriber: ((event: unknown) => void) | null = null;

const mockAgent = {
  state: { tools: [] as never[] },
  subscribe: vi.fn((cb: (event: unknown) => void) => {
    capturedSubscriber = cb;
  }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({
    agent: mockAgent,
    run: vi.fn(),
  }),
}));

vi.mock("../../agent/context", () => ({
  buildSystemContext: vi.fn().mockResolvedValue("mock context"),
}));

const { ResearchService } = await import("../ResearchService");

function makeEventBus() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    emit: vi.fn((event: { type: string; payload: unknown }) => {
      handlers.get(event.type)?.(event.payload);
    }),
    on: vi.fn((type: string, handler: (payload: unknown) => void) => {
      handlers.set(type, handler);
      return () => {};
    }),
  };
}

function makeArtifactService() {
  return {
    saveArtifact: vi.fn().mockResolvedValue({ id: "art-1", filePath: "/workspace/output.md" }),
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      openrouterApiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-5",
    }),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/home"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/home/workspace/p1"),
    saveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ResearchService", () => {
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
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(taskId).toBeTruthy();
  });

  it("emits research:started event", async () => {
    const bus = makeEventBus();
    const svc = new ResearchService(
      bus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await svc.startResearch("p1", "My Project", "research X", null);
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:started" }),
    );
  });

  it("calls homeService.saveTask with task details", async () => {
    const home = makeHomeService();
    const svc = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      home as never,
    );
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);
    expect(home.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, projectId: "p1", query: "research X" }),
    );
  });

  it("calls homeService.deleteTask on research:complete", async () => {
    const home = makeHomeService();
    const artifacts = makeArtifactService();
    const bus = makeEventBus();
    const svc = new ResearchService(bus as never, artifacts as never, makeSettingsService() as never, home as never);
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
  });

  it("calls homeService.deleteTask on research:failed", async () => {
    const home = makeHomeService();
    const bus = makeEventBus();
    const { createWorkerAgent } = await import("../../agent/worker-agent");
    vi.mocked(createWorkerAgent).mockResolvedValueOnce({
      agent: {
        ...mockAgent,
        subscribe: vi.fn((cb) => { capturedSubscriber = cb; }),
        prompt: vi.fn().mockRejectedValue(new Error("worker crashed")),
      },
      run: vi.fn(),
    });
    const svc = new ResearchService(bus as never, makeArtifactService() as never, makeSettingsService() as never, home as never);
    const { taskId } = await svc.startResearch("p1", "My Project", "research X", null);

    // Let the promise rejection propagate
    await new Promise((r) => setTimeout(r, 10));

    expect(home.deleteTask).toHaveBeenCalledWith(taskId);
  });

  it("emits research:complete and saves artifact on agent_end", async () => {
    const bus = makeEventBus();
    const artifacts = makeArtifactService();
    const svc = new ResearchService(bus as never, artifacts as never, makeSettingsService() as never, makeHomeService() as never);
    await svc.startResearch("p1", "My Project", "research X", null);

    await capturedSubscriber?.({ type: "agent_end" });

    expect(artifacts.saveArtifact).toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "research:complete" }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: failures because `ResearchService` still uses `Agent` directly, not `createWorkerAgent`, and `homeService` param doesn't exist.

- [ ] **Step 3: Rewrite `ResearchService.ts`**

Replace `src/main/services/ResearchService.ts` with:

```ts
import { join } from "node:path";
import { injectable } from "tsyringe";
import { createWorkerAgent } from "../agent/worker-agent";
import type { EventBus } from "../event-bus";
import type { ArtifactService } from "./ArtifactService";
import type { HomeService } from "./HomeService";
import type { SettingsService } from "./SettingsService";

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

    const systemPromptAddition = [
      "You are a background researcher. Investigate the given query thoroughly using the available tools,",
      "then write a comprehensive Markdown report to the workspace file 'output.md'.",
      "Be thorough. When done, respond with a final summary of your findings.",
    ].join(" ");

    const { agent } = await createWorkerAgent({
      toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
      systemPromptAddition,
      projectId,
      projectName,
      folderPath,
      homePath,
      apiKey: settings.openrouterApiKey,
      model: settings.model,
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
          const outputPath = join(homePath, "workspace", projectId, "output.md");
          const artifact = await this.artifactService.saveArtifact({
            projectId,
            title: `Research: ${query.slice(0, 60)}`,
            filePath: outputPath,
          });
          await this.homeService.deleteTask(taskId);
          this.eventBus.emit({
            type: "research:complete",
            payload: {
              taskId,
              artifactId: artifact.id,
              projectId,
              query,
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

    agent.prompt(query).catch(async (err) => {
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(run8a): refactor ResearchService to use createWorkerAgent and add task persistence"
```

---

## Task 7: `ipc-handlers.ts` — auto-resume on app start

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Add auto-resume after EventBus wiring**

In `src/main/ipc-handlers.ts`, after the last `eventBus.on(...)` call (the `research:failed` handler on line ~143), add:

```ts
  // Auto-resume in-progress research tasks from the previous session
  void (async () => {
    try {
      const tasks = await homeService.getInProgressTasks();
      for (const task of tasks) {
        try {
          await researchService.startResearch(
            task.projectId,
            task.projectName,
            task.query,
            task.folderPath,
          );
        } catch (err) {
          console.error("[startup] Failed to resume task", task.taskId, err);
        }
      }
    } catch (err) {
      console.error("[startup] Failed to load in-progress tasks:", err);
    }
  })();
```

- [ ] **Step 2: Run full test suite**

```bash
bun run test
```

Expected: all tests pass. (`ipc-handlers` is not unit tested — verified via typecheck and integration.)

- [ ] **Step 3: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors, zero lint issues.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(run8a): auto-resume in-progress research tasks on app start"
```

---

## Task 8: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Lint and format**

```bash
bun run check
```

Expected: clean.

- [ ] **Step 3: Full test suite with coverage**

```bash
bun run test
```

Expected: all tests pass, >90% coverage on new/modified files.

- [ ] **Step 4: Start dev server and verify app starts without error**

```bash
bun run dev
```

Expected: Electron window opens, no console errors, chat works, research dispatch still functions, settings accessible.

- [ ] **Step 5: Final commit (if any formatting fixes needed)**

```bash
git add -p
git commit -m "chore(run8a): formatting and final cleanup"
```

---

## Self-review checklist (already applied inline)

- [x] All spec sections covered: `createWorkerAgent`, `request_evaluation`, `evaluate-research` skill, task persistence, auto-resume
- [x] No placeholders — every code block is complete
- [x] `AgentSession` update included (Task 5)
- [x] `session.ts` `worker-agent` mock added so tests don't import real module
- [x] `deleteTask` called in all three exit paths: `agent_end` success, `agent_end` error, `agent.prompt` rejection
- [x] `tasks/` directory created in `ensureDirectories`
- [x] `evaluate-research` skill added to `copyBuiltinSkillsIfNeeded` builtins list
- [x] Circular import avoided: `tools.ts` never imports from `worker-agent.ts`
- [x] `makeEvaluatorFn` only creates evaluator with `toolNames: ['read_file', 'safe_bash']` — no recursive `request_evaluation` loop
