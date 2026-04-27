# Run 8b — Design Spec
**Date:** 2026-04-27
**Status:** approved

## Scope

Three features shipped together:

1. **Docker sandbox tool** — `run_in_docker` Pi tool using `dockerode`; replaces E2B
2. **Agent-created tools gate** — `propose_tool` + `pending-tools/` approval flow + minimal frontend
3. **Orchestrated research** — recursive agent tree; `start_research` gains `deep` flag; new `startOrchestratedResearch()` in `ResearchService`

---

## 1. Recursive Agent Model

All agents are created via the existing `createWorkerAgent(config)` factory. What differs per agent is `toolNames`, `systemPromptAddition`, and a new field `remainingDepth: number`.

### Depth-limit enforcement

- Default max depth: **3** (constant in `worker-agent.ts`)
- If `remainingDepth > 0`: `spawn_agent`, `spawn_agents_parallel`, `save_artifact`, and `propose_tool` are included in `toolNames`
- If `remainingDepth === 0`: those tools are absent — the agent becomes a leaf regardless of its type label
- Spawn tools also decrement `remainingDepth` before constructing child agents
- System prompt includes `"Remaining orchestration depth: N"` so the LLM knows its position in the tree

### Agent types (by toolset)

| Type | Tools | Can spawn? |
|---|---|---|
| `researcher` | `read_file, write_file, list_dir, safe_bash` | No (always leaf) |
| `coder` | `read_file, write_file, run_in_docker` | No (always leaf) |
| `orchestrator` | all tools (filtered by `remainingDepth`) | Yes if depth > 0 |

Researcher and coder are always leaves — their `remainingDepth` is forced to 0 regardless of parent depth.

### WorkerAgentConfig additions

```ts
export interface WorkerAgentConfig {
  // ... existing fields ...
  remainingDepth: number                               // NEW — 0 = leaf, >0 = can orchestrate
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }> // NEW
}
```

`saveArtifactFn` is injected as a callback (same pattern as `requestEvaluationFn`) to avoid circular imports between `tools.ts` and `worker-agent.ts`.

---

## 2. Docker Sandbox Tool

### Package

```
bun add dockerode @types/dockerode
```

### Location

`src/main/agent/extensions/docker-sandbox.ts`

### Tool interface

```ts
run_in_docker({
  code: string,
  language: 'python' | 'bash' | 'typescript',
  files?: Array<{ name: string; content: string }>,
  networkEnabled?: boolean
})
// returns: { stdout: string, outputFiles: Array<{ name: string; content: string }>, error?: string }
```

### Execution flow

1. Select image: `python:3.11-slim` for Python, `node:20-alpine` for TypeScript, `bash:5` for Bash
2. Create temp directory on host; write `files` entries + the `code` file into it
3. Create Docker container with the temp dir bind-mounted to `/workspace`; set network mode to `bridge` if `networkEnabled`, `none` otherwise
4. Start container; stream stdout/stderr; hard-kill after **60 seconds**
5. Read all files from `/workspace/output/` inside the container — these are the `outputFiles`
6. Remove container and temp dir (always, even on error)
7. Return `{ stdout, outputFiles, error? }`

### Security

- `run_in_docker` is only injected into research agent toolsets — never into the main chat agent
- `networkEnabled` parameter from the LLM is accepted as-is for orchestrator/researcher sessions; the main chat agent cannot reach the tool at all
- Container is always destroyed after execution; no state persists between calls

### Error handling

- Docker daemon not running → tool returns `{ stdout: "", outputFiles: [], error: "Docker is not available: <message>" }` — does not throw, so the agent can handle it gracefully
- Timeout → container killed, partial stdout returned with truncation note
- Image pull failure → error returned

---

## 3. Spawn Tools

### `spawn_agent`

```ts
spawn_agent({
  type: 'researcher' | 'coder' | 'orchestrator',
  query: string,
  outputPath: string   // absolute path within workspace — path-jail validated before use
})
// returns: { outputPath: string, summary: string }
```

**Implementation:**

1. Path-jail validates `outputPath` (must be within `~/.research-assistant/workspace/<projectId>/`)
2. Build child `WorkerAgentConfig` by `type`:
   - `researcher`: `toolNames = ["read_file", "write_file", "list_dir", "safe_bash"]`, `remainingDepth = 0`
   - `coder`: `toolNames = ["read_file", "write_file", "run_in_docker"]`, `remainingDepth = 0`
   - `orchestrator`: full orchestrator toolset, `remainingDepth = parentRemainingDepth - 1`
3. Inherit `projectId`, `projectName`, `folderPath`, `homePath`, `apiKey`, `model`, `saveArtifactFn` from parent config
4. Call `createWorkerAgent(childConfig)` then `agent.run(query)`
5. Return `{ outputPath, summary }` — `summary` is the agent's final text output

### `spawn_agents_parallel`

```ts
spawn_agents_parallel({
  agents: Array<{ type: 'researcher' | 'coder' | 'orchestrator', query: string, outputPath: string }>
})
// returns: Array<{ outputPath: string, summary: string }>
```

Implementation: `Promise.all(agents.map(a => spawnOne(a)))` — identical logic to `spawn_agent` per entry.

### `save_artifact`

```ts
save_artifact({
  path: string,   // absolute path to file — path-jail validated
  title: string
})
// returns: { artifactId: string }
```

Implementation: path-jail validates `path`, then calls `saveArtifactFn(path, title)`. Available to orchestrators only (enforced by `toolNames` filter). Leaf agents write their output to `outputPath` and let the parent orchestrator decide what to save.

### Callback injection (no circular imports)

`AgentToolsOptions` gains:

```ts
spawnAgentFn?: (type, query, outputPath) => Promise<{ outputPath: string; summary: string }>
spawnAgentsParallelFn?: (agents) => Promise<Array<{ outputPath: string; summary: string }>>
saveArtifactFn?: (path, title) => Promise<{ artifactId: string }>
proposeTool?: boolean  // flag — propose_tool injected when true
```

`createWorkerAgent` builds these callbacks internally before calling `createAgentTools`, threading `remainingDepth` down to each child. Same pattern as `makeEvaluatorFn` today.

---

## 4. Agent-Created Tools Gate

### `propose_tool` tool

Injected into orchestrator agents only (via `toolNames` filter, `remainingDepth > 0`).

```ts
propose_tool({
  name: string,          // must match /^[a-z0-9-]+$/
  description: string,
  skillContent: string,  // full SKILL.md markdown content
  script?: string        // optional Python or bash script content
})
// returns: "Tool proposed — awaiting user approval."
```

**Implementation:**

1. Validate `name` against `/^[a-z0-9-]+$/` — throw descriptive error on failure
2. Create `~/.research-assistant/pending-tools/<name>/` directory
3. Write `SKILL.md` with `skillContent`
4. If `script` provided, write `script.py` (or `script.sh` — detect by first line shebang or default to `.py`)
5. Fire `tool:pending` AppEvent: `{ name, skillContent }`
6. Return confirmation string

### `HomeService` additions

```ts
getPendingTools(): Promise<Array<{ name: string; skillContent: string }>>
approvePendingTool(name: string): Promise<void>  // moves pending-tools/<name>/ → skills/<name>/
rejectPendingTool(name: string): Promise<void>   // deletes pending-tools/<name>/
```

`ensureDirectories()` gains `pending-tools/` to the dirs list.

### EventBus addition

```ts
| { type: "tool:pending"; payload: { name: string; skillContent: string } }
```

### New IPC channels

```ts
TOOL_PENDING: "TOOL_PENDING",          // main → renderer (push)
GET_PENDING_TOOLS: "GET_PENDING_TOOLS", // renderer → main (invoke)
APPROVE_TOOL: "APPROVE_TOOL",          // renderer → main (invoke)
REJECT_TOOL: "REJECT_TOOL",            // renderer → main (invoke)
```

### Frontend — minimal notification banner

**`PendingToolBanner.tsx`** (alongside `ResearchStatusBar` in `ChatPanel`):
- Listens for `TOOL_PENDING` IPC event
- Shows: `"Agent proposed a new tool: <name> — Review"` with a button
- Clicking opens `PendingToolModal`
- State: `pendingTools: Array<{ name, skillContent }>` — new items pushed on each `TOOL_PENDING` event; removed on approve or reject

**`PendingToolModal.tsx`:**
- Dialog showing tool name + scrollable SKILL.md content in a `<pre>` block
- Two buttons: **Approve** (`invoke(IPC.APPROVE_TOOL, { name })`) and **Reject** (`invoke(IPC.REJECT_TOOL, { name })`)
- On either action: close modal, remove from `pendingTools` state

`preload/index.ts` gains the four new channels in `contextBridge`.

---

## 5. Orchestrated Research Entry Point

### `start_research` tool change

```ts
// before
start_research({ query: string })

// after
start_research({ query: string, deep?: boolean })
```

`deep` defaults to `false`. The updated `start_research` skill teaches the agent when to set `deep: true`:
- Complex multi-source queries
- Anything requiring parallel subtopic research
- Queries needing code execution (data processing, web fetching)

### `ResearchService.startOrchestratedResearch()`

Same signature and task-persistence contract as `startResearch()`:

```ts
startOrchestratedResearch(
  projectId: string,
  projectName: string,
  query: string,
  folderPath: string | null,
): Promise<{ taskId: string }>
```

Creates an orchestrator agent with:
- `toolNames`: `["read_file", "write_file", "list_dir", "safe_bash", "run_in_docker", "spawn_agent", "spawn_agents_parallel", "save_artifact", "propose_tool"]`
- `remainingDepth`: 3
- `systemPromptAddition`: orchestrator role description including workspace root path, output conventions, and depth info
- `saveArtifactFn`: callback into `ArtifactService.saveArtifact()`

Task persistence: unchanged — one top-level `<taskId>.json` in `tasks/`. Sub-agents are internal; only the top-level task is tracked.

### Workspace layout per orchestrated task

```
~/.research-assistant/workspace/<projectId>/<taskId>/
  plan.md              ← orchestrator may write its plan (optional)
  subtask-1/
    output.md          ← leaf researcher output
  subtask-2/
    output.md          ← sub-orchestrator synthesis
  synthesis.md         ← top-level final report (orchestrator writes this)
```

Orchestrator is told its workspace root (`~/.research-assistant/workspace/<projectId>/<taskId>/`) in the system prompt. Path jail applies to all spawned agents — all paths must stay within `workspace/<projectId>/`.

### `start_research` tool implementation

```ts
execute: async (_id, { query, deep }) => {
  const fn = deep
    ? (q: string) => researchService.startOrchestratedResearch(projectId, projectName, q, folderPath)
    : (q: string) => researchService.startResearch(projectId, projectName, q, folderPath);
  const { taskId } = await fn(query);
  return { content: [{ type: "text", text: `Research task started (taskId: ${taskId}).` }], details: { taskId } };
}
```

---

## 6. `AgentToolName` additions

```ts
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "request_evaluation"
  | "start_research"
  | "run_in_docker"       // NEW
  | "spawn_agent"         // NEW
  | "spawn_agents_parallel" // NEW
  | "save_artifact"       // NEW
  | "propose_tool"        // NEW
```

---

## 7. Testing Strategy

### Docker sandbox (`docker-sandbox.test.ts`)
- Mock `dockerode` module — verify correct image per language, container cleanup on success and error, 60s timeout enforcement, output file extraction from `/workspace/output/`
- Verify Docker-unavailable path returns error string (no throw)

### Spawn tools (`tools.test.ts` additions)
- Mock `createWorkerAgent` — verify depth decrement: orchestrator at depth 3 spawns child at depth 2; depth 0 agent has no spawn tools in output of `createAgentTools`
- Verify path-jail rejection on `outputPath` outside workspace
- Verify `spawn_agents_parallel` resolves all children via `Promise.all`

### `propose_tool`
- Validate name rejection for invalid patterns
- Verify `SKILL.md` written to correct path
- Verify `tool:pending` event fires with correct payload

### `HomeService` additions
- `getPendingTools`, `approvePendingTool`, `rejectPendingTool` — file-system mock pattern matching existing `HomeService.test.ts`

### `ResearchService.startOrchestratedResearch()`
- Verify orchestrator agent created with `remainingDepth = 3` and correct toolset
- Verify task persisted and deleted on completion/failure (existing pattern)

### Frontend
- `PendingToolBanner`: renders on `TOOL_PENDING` event, hides after approve/reject
- `PendingToolModal`: approve calls correct IPC channel with correct name; reject calls correct IPC channel

---

## 8. What is NOT in Run 8b

- Sub-agent progress forwarding to UI (sub-agents show no per-step progress; top-level task shows "in progress")
- Playwright UI tests — Run 9
- Tier 2 as a distinct mode (orchestrator handles any depth of parallelism; no separate "tier 2" concept)
- Token budget warning — dropped entirely
- croner heartbeat scheduler — not needed

---

## Files Changed / Created

| Path | Change |
|---|---|
| `src/main/agent/extensions/docker-sandbox.ts` | New — `run_in_docker` tool implementation |
| `src/main/agent/extensions/docker-sandbox.test.ts` | New |
| `src/main/agent/builtin-skills.ts` | Update `START_RESEARCH_SKILL` to teach agent about `deep: true` flag |
| `src/main/agent/tools.ts` | Add `run_in_docker`, `spawn_agent`, `spawn_agents_parallel`, `save_artifact`, `propose_tool`; extend `AgentToolName` and `AgentToolsOptions` |
| `src/main/agent/tools.test.ts` | Add spawn + propose_tool tests |
| `src/main/agent/worker-agent.ts` | Add `remainingDepth`, `saveArtifactFn` to config; build spawn callbacks; thread depth to children |
| `src/main/agent/worker-agent.test.ts` | Add depth-limit and orchestrator config tests |
| `src/main/services/ResearchService.ts` | Add `startOrchestratedResearch()` |
| `src/main/services/HomeService.ts` | Add `getPendingTools`, `approvePendingTool`, `rejectPendingTool`; add `pending-tools/` to `ensureDirectories` |
| `src/main/services/__tests__/HomeService.test.ts` | Add pending tools tests |
| `src/main/services/__tests__/ResearchService.test.ts` | Add orchestrated research tests |
| `src/main/event-bus.ts` | Add `tool:pending` event type |
| `src/shared/ipc-channels.ts` | Add `TOOL_PENDING`, `GET_PENDING_TOOLS`, `APPROVE_TOOL`, `REJECT_TOOL` |
| `src/main/ipc-handlers.ts` | Wire new IPC channels; forward `tool:pending` event |
| `src/preload/index.ts` | Add new channels to `contextBridge` |
| `src/renderer/components/layout/chat/PendingToolBanner.tsx` | New |
| `src/renderer/components/layout/chat/PendingToolModal.tsx` | New |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Mount `PendingToolBanner` |
