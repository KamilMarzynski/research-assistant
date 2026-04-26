# Run 8a Design — Generic Agent Model, Evaluator & Task Persistence

**Date:** 2026-04-26
**Status:** Approved
**Obsidian:** [[Research Assistant - Run 8a Design Decisions]]

---

## Context

Runs 1–7 complete. Run 8 (as originally specced) was too large for one session and has been split:

- **Run 8a** (this spec) — generic agent model infrastructure
- **Run 8b** (next session) — E2B sandbox + agent-created tools gate + Tier 2/3 research

### What exists after Run 7

- `ResearchService` creates Pi `Agent` directly, sets tools, subscribes to events, calls `agent.prompt()` — fire-and-forget
- `createAgentTools()` returns all tools unconditionally
- `AgentSession` wires the main chat agent with memory + LangFuse
- `HomeService` manages `~/.research-assistant/` home directory
- No task persistence — task state is lost on app restart

---

## Scope

### In Run 8a
1. `createWorkerAgent(config)` factory in `src/main/agent/worker-agent.ts`
2. Tool registry filter — `createAgentTools` gains optional `toolNames` param
3. `ResearchService` refactored to use `createWorkerAgent`
4. `evaluate-research` built-in skill written by `HomeService` on first run
5. `request_evaluation` Pi tool registered for main agent + all workers
6. Task persistence: `~/.research-assistant/tasks/<taskId>.json`
7. Auto-resume in-progress tasks on app start

### Not in Run 8a (deferred to 8b)
- E2B sandbox (`run_in_sandbox`)
- Agent-created tools approval gate + UI
- `start_research` tier param
- Tier 2/3 research loop
- Token budget warning
- Croner heartbeat scheduler (dropped — no waiting queue yet)
- Resume/Cancel dialog (replaced by silent auto-resume)

---

## Design

### 1. `createWorkerAgent` factory

**File:** `src/main/agent/worker-agent.ts`

```ts
export type AgentToolName =
  | 'read_file'
  | 'write_file'
  | 'list_dir'
  | 'safe_bash'
  | 'request_evaluation'
  | 'start_research'

export interface WorkerAgentConfig {
  toolNames: AgentToolName[]
  systemPromptAddition: string
  skills?: string[]          // filenames (no extension) to load from skills dirs
  projectId: string
  projectName: string
  folderPath: string | null
  homePath: string
  apiKey: string
  model: string
}

export interface WorkerAgent {
  agent: Agent
  run: (input: string) => Promise<string>  // resolves with final text on agent_end
}

export function createWorkerAgent(config: WorkerAgentConfig): WorkerAgent
```

**`run()` implementation:** subscribes to `agent_end` event, collects `text_delta` chunks into a string, resolves promise on `agent_end`. Used by `request_evaluation` tool (synchronous tool-driven flow). `ResearchService` does NOT use `run()` — it subscribes to events directly for fire-and-forget + progress reporting.

**Skill loading:** if `skills` array is provided, each entry is a skill directory name (e.g. `evaluate-research` resolves to `skills/evaluate-research/SKILL.md`). Loaded using the same resolution order as `loadSkills` in `context.ts`. Content appended to system prompt after `systemPromptAddition`.

### 2. Tool registry filter

**File:** `src/main/agent/tools.ts`

`createAgentTools` gains an optional `toolNames?: AgentToolName[]` param. When provided, only builds the specified tools. When omitted, builds all tools (existing behaviour for main agent).

Tool sets per agent type:
- **Main chat agent:** all tools (no filter — existing behaviour)
- **Researcher Tier 1:** `[read_file, write_file, list_dir, safe_bash, request_evaluation]`
- **Evaluator:** `[read_file, safe_bash]`

`request_evaluation` is added to all tool sets that include `safe_bash` — it's available wherever the agent might need to assess output.

### 3. `ResearchService` refactor

`ResearchService.startResearch()` replaces the direct `new Agent(...)` + `worker.state.tools = ...` block with `createWorkerAgent(researcherConfig)`. Event subscription and fire-and-forget pattern stay unchanged — only the agent construction changes.

```ts
const { agent } = createWorkerAgent({
  toolNames: ['read_file', 'write_file', 'list_dir', 'safe_bash', 'request_evaluation'],
  systemPromptAddition: '...researcher system prompt...',
  projectId,
  projectName,
  folderPath,
  homePath,
  apiKey: settings.openrouterApiKey,
  model: settings.model,
})
// event subscription unchanged
// agent.prompt(query) unchanged
```

### 4. `evaluate-research` built-in skill

**Written by:** `HomeService.ensureBuiltinSkills()` — called during first-run setup alongside existing built-in skills.

**Path:** `~/.research-assistant/skills/evaluate-research/SKILL.md`

**Content:**
```markdown
---
name: evaluate-research
description: Evaluate the completeness and quality of a research output file
---

You are a research evaluator. When given a file path to evaluate:

1. Read the file using read_file
2. Assess it against the provided criteria
3. Respond with ONLY a JSON object in this exact format:

{
  "pass": true | false,
  "criteria": [
    { "name": "criterion name", "pass": true | false, "rationale": "one sentence" }
  ]
}

No preamble. No explanation. JSON only.
```

### 5. `request_evaluation` tool

**Added to:** `createAgentTools()` in `tools.ts`

```ts
params: {
  filePath: string      // absolute path to research output file
  criteria: string[]   // list of criteria to evaluate against
}
```

**Execution flow:**
1. Builds evaluator config: `toolNames: [read_file, safe_bash]`, skills: `[evaluate-research]`, system prompt instructs JSON-only output
2. Calls `createWorkerAgent(evaluatorConfig)` — uses caller's `projectId`, `projectName`, `folderPath`, `homePath`, `apiKey`, `model` (captured via closure in `createAgentTools`)
3. Calls `run(prompt)` where prompt includes `filePath` and `criteria` list
4. Parses JSON from output text — extracts first substring matching `/\{[\s\S]*\}/` and runs `JSON.parse` on it
5. Returns `{ pass: boolean, criteria: [...] }` as tool result text

**Error handling:** if JSON parse fails, returns `{ pass: false, criteria: [{ name: 'parse-error', pass: false, rationale: 'evaluator did not return valid JSON' }] }`

**`createAgentTools` signature change:** needs `apiKey` and `model` to construct the evaluator agent inside the tool. Add both to `AgentToolsOptions`. **`AgentSession` must also be updated** to pass `apiKey` and `model` when calling `createAgentTools` — currently it doesn't pass them since the tool didn't need them.

### 6. Task persistence

**Task JSON schema:**
```ts
interface ResearchTask {
  taskId: string
  projectId: string
  projectName: string
  query: string
  folderPath: string | null
  startedAt: string   // ISO timestamp
}
```

**`HomeService` additions:**
```ts
saveTask(task: ResearchTask): Promise<void>
deleteTask(taskId: string): Promise<void>
getInProgressTasks(): Promise<ResearchTask[]>
```

Files stored at `~/.research-assistant/tasks/<taskId>.json`. Task directory created on first use (alongside existing `ensureWorkspaceForProject`).

**`ResearchService` wiring:**
- `startResearch()`: calls `homeService.saveTask(...)` before `agent.prompt()`
- `agent_end` handler: calls `homeService.deleteTask(taskId)` before emitting `research:complete`
- `research:failed` path: calls `homeService.deleteTask(taskId)` before emitting `research:failed`

### 7. Auto-resume on app start

**Location:** `registerIpcHandlers()` in `ipc-handlers.ts`, after all handlers and EventBus→IPC forwarding are registered.

```ts
// After all event forwarding is wired:
void (async () => {
  const tasks = await homeService.getInProgressTasks()
  for (const task of tasks) {
    await researchService.startResearch(
      task.projectId,
      task.projectName,
      task.query,
      task.folderPath,
    )
  }
})()
```

Fire-and-forget. If a task's project no longer exists, `ResearchService` will fail and emit `research:failed`, which deletes the task file — no orphan state.

---

## File Changes

| File | Change |
|---|---|
| `src/main/agent/worker-agent.ts` | **New** — `createWorkerAgent` + `WorkerAgentConfig` + `WorkerAgent` types |
| `src/main/agent/tools.ts` | Add `toolNames?` filter to `createAgentTools`; add `apiKey`/`model` to options; add `request_evaluation` tool |
| `src/main/services/ResearchService.ts` | Refactor to use `createWorkerAgent`; add `saveTask`/`deleteTask` calls |
| `src/main/services/HomeService.ts` | Add `saveTask`, `deleteTask`, `getInProgressTasks`; write `evaluate-research` skill on first run |
| `src/main/agent/session.ts` | Pass `apiKey` and `model` to `createAgentTools` |
| `src/main/ipc-handlers.ts` | Add auto-resume call after EventBus wiring |

---

## Testing

- `worker-agent.test.ts` — `createWorkerAgent` constructs agent with correct tool subset; `run()` resolves with agent output
- `tools.test.ts` — `toolNames` filter returns correct subset; `request_evaluation` parses valid JSON; handles malformed evaluator output
- `HomeService.test.ts` — `saveTask`/`deleteTask`/`getInProgressTasks` round-trip; skill file written on first run
- `ResearchService.test.ts` — task saved on start; deleted on complete + failed; uses `createWorkerAgent` (mock)
- Coverage target: >90% on all modified/new files

---

## Dropped / Deferred

| Item | Decision |
|---|---|
| Croner heartbeat | Dropped — no waiting queue |
| Resume/Cancel dialog | Replaced by silent auto-resume |
| `start_research` tier param | Run 8b |
| Tier 2/3 research | Run 8b |
| E2B sandbox | Run 8b |
| Agent-created tools gate | Run 8b |
