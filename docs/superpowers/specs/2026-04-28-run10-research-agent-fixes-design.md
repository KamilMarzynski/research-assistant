# Run 10 — Research Agent Fixes & Observability

**Date:** 2026-04-28  
**Scope:** Bug fixes, structural cleanup, and sub-agent event propagation in the research agent layer. Tasks-in-DB and broader reliability work are deferred to Run 13.

---

## Goals

1. Fix two bugs that break current behaviour (`deep` flag, `output.md` overwrite)
2. Eliminate duplication between `startResearch` and `startOrchestratedResearch`
3. Surface sub-agent activity in the UI with labelled progress chunks
4. Clean up `worker-agent.ts` internals (closed switch, redundant depth string)
5. Move `FIRST_RUN_PROMPT` out of `session.ts`

---

## Out of Scope

- Tasks-in-DB (belongs in Run 13 — Reliability)
- Research error UX / retry
- OS notifications
- Stream error recovery
- Any renderer changes beyond `ResearchStatusBar` consuming the new `label` field

---

## Section 1 — `ResearchService` consolidation + bug fixes

### 1.1 Private `_runResearch` method

Extract all shared mechanics into a single private method. `startResearch` and `startOrchestratedResearch` become thin callers.

```typescript
interface BaseResearchConfig {
  projectId: string;
  projectName: string;
  query: string;
  folderPath: string | null;
}

// Private — owns everything shared between the two public methods:
//   saveTask, ensureWorkspace, EventBus emit (started/progress/complete/failed),
//   agent.subscribe, agent.prompt, deleteTask on completion/failure
private async _runResearch(
  config: BaseResearchConfig,
  buildWorkerConfig: (taskId: string, workspacePath: string) => WorkerAgentConfig,
): Promise<{ taskId: string }>
```

`startResearch` calls `_runResearch` with a standard worker config builder.  
`startOrchestratedResearch` calls `_runResearch` with an orchestrator config builder.

### 1.2 Output path fix

Both callers produce a `taskId`-scoped workspace directory, eliminating the per-project `output.md` overwrite:

```
Standard:
  ~/.research-assistant/workspace/<projectId>/<taskId>/output.md

Orchestrated:
  ~/.research-assistant/workspace/<projectId>/<taskId>/synthesis.md
```

`_runResearch` receives `workspacePath` from the caller's config builder and passes it through. `_runResearch` calls `mkdir` directly on the `taskId` subdirectory. `HomeService.ensureWorkspaceForProject` signature is unchanged.

### 1.3 `deep` flag fix

`tools.ts` — `start_research` tool schema gains `deep?: boolean`:

```typescript
parameters: Type.Object({
  query: Type.String({
    description: "A clear, self-contained research question including all necessary context",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "Set true for complex multi-source research requiring parallel subtopic investigation, code execution, or hierarchical orchestration. Defaults to false.",
    }),
  ),
}),
execute: async (_id, { query, deep }) => {
  const { taskId } = await startResearchFn(query, deep);
  ...
}
```

`AgentSession` already routes correctly on `deep` — no changes needed there.

---

## Section 2 — Sub-agent event propagation

### 2.1 `WorkerAgentConfig` change

```typescript
export interface WorkerAgentConfig {
  // ...existing fields unchanged...
  onProgress?: (label: string, delta: string) => void;
}
```

`onProgress` is fire-and-forget (`void`). Callers must not `await` it inside token loops — parallel agents must not block each other on progress emission.

### 2.2 Label assignment

Labels are assigned at spawn time by the parent, not inside child agents.

| Spawn context | Label format |
|---|---|
| `spawn_agent` (single) | `[researcher]`, `[coder]`, `[orchestrator]` |
| `spawn_agents_parallel` (batch) | `[researcher-1]`, `[researcher-2]`, `[coder-1]` (index per type) |

In `spawnAgentsParallelFn`, each agent entry gets an index scoped to its type:

```typescript
// e.g. two researchers + one coder → [researcher-1], [researcher-2], [coder-1]
const typeCounters: Partial<Record<AgentType, number>> = {};
const labelled = agents.map(({ type, query, outputPath }) => {
  typeCounters[type] = (typeCounters[type] ?? 0) + 1;
  const label = `[${type}-${typeCounters[type]}]`;
  return { type, query, outputPath, label };
});
```

### 2.3 Propagation chain

```
ResearchService._runResearch
  → passes onProgress to top-level agent's WorkerAgentConfig
      top-level agent tokens: emitted via agent.subscribe (unlabelled, current behaviour)
      spawnAgentFn: label fixed at call site, passed as onProgress to child createWorkerAgent
        child run() loop: text_delta → onProgress(label, delta) [fire-and-forget]
          ResearchService onProgress callback: EventBus.emit research:progress { taskId, label, message }
            IPC → renderer ResearchStatusBar
```

Top-level orchestrator tokens remain unlabelled (current behaviour preserved). Only spawned children emit labelled chunks.

Propagation is recursive: a depth-2 orchestrator passes `onProgress` to its own spawned children. All depths surface through the same EventBus channel with their respective labels.

### 2.4 `RESEARCH_STATUS_UPDATE` IPC payload change

Current payload: `{ status, taskId, message?, ... }`  
New payload: `{ status, taskId, message?, label?, ... }`

`label` is optional — absent for top-level tokens, present for sub-agent chunks.

`ResearchStatusBar` renders: if `label` present, prefix the chunk: `[researcher-2] ...text...`. If absent, render as today.

### 2.5 `ipc-channels.ts` shared type

Add a `ResearchProgressPayload` type to `src/shared/ipc-channels.ts` (or `src/shared/types/research.ts`) so renderer and main process share the shape:

```typescript
export interface ResearchProgressPayload {
  taskId: string;
  message: string;
  label?: string;
}
```

---

## Section 3 — `worker-agent.ts` cleanup

### 3.1 Switch → map for agent type presets

Replace `buildChildConfig` switch with a `AGENT_TYPE_PRESETS` record:

```typescript
type WorkerAgentBase = Pick<
  WorkerAgentConfig,
  "projectId" | "projectName" | "folderPath" | "homePath" |
  "apiKey" | "model" | "saveArtifactFn" | "proposeToolFn" | "onProgress"
>;

type PresetBuilder = (
  base: WorkerAgentBase,
  outputPath: string,
  remainingDepth: number,
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

`buildChildConfig` becomes:

```typescript
const buildChildConfig = (type: AgentType, outputPath: string): WorkerAgentConfig =>
  AGENT_TYPE_PRESETS[type](base, outputPath, remainingDepth);
```

Adding a new agent type = adding one entry to `AGENT_TYPE_PRESETS`. No switch modification.

### 3.2 Remove depth hint from orchestrator system prompt

Current orchestrator system prompt includes `"Remaining orchestration depth: ${remainingDepth - 1}"`. This is removed. The authoritative constraint is tool stripping (`ORCHESTRATOR_ONLY_TOOLS` removed at `remainingDepth === 0`). The string hint is redundant and can diverge from the code.

### 3.3 `FIRST_RUN_PROMPT` moved to `builtin-skills.ts`

`FIRST_RUN_PROMPT` constant moves from `session.ts` to `builtin-skills.ts`, alongside `START_RESEARCH_SKILL`, `DISCOVER_PROJECT_SKILL`, `EVALUATE_RESEARCH_SKILL`.

`session.ts` imports it:
```typescript
import { FIRST_RUN_SKILL } from "./builtin-skills";
```

No behaviour change. `session.ts` loses its last hardcoded agent instruction.

---

## Files Changed

| File | Change |
|---|---|
| `src/main/services/ResearchService.ts` | Extract `_runResearch`, fix output path, thin public callers |
| `src/main/agent/tools.ts` | Add `deep?: boolean` to `start_research` schema |
| `src/main/agent/worker-agent.ts` | `onProgress` field, switch → map, remove depth string |
| `src/main/agent/session.ts` | Import `FIRST_RUN_SKILL` from `builtin-skills.ts` |
| `src/main/agent/builtin-skills.ts` | Add `FIRST_RUN_SKILL` export |
| `src/shared/ipc-channels.ts` | Add `ResearchProgressPayload` type, add `label?` to payload |
| `src/renderer/components/layout/chat/ResearchStatusBar.tsx` | Render `label` prefix when present |

---

## Testing

All existing tests must continue to pass. New tests:

- `ResearchService` unit test: two sequential `startResearch` calls on the same project produce different output paths
- `ResearchService` unit test: `startResearch` with no `deep` routes to standard worker; `startOrchestratedResearch` routes to orchestrator worker
- `worker-agent.ts` unit test: `onProgress` fires with correct labels for `spawn_agent` and `spawn_agents_parallel`
- `tools.ts` unit test: `start_research` tool with `deep: true` calls `startResearchFn(query, true)`
- `ResearchStatusBar` renders `[researcher-1]` prefix when `label` present in payload

---

## Non-Goals (explicit)

- No new agent types added in this run
- No changes to `HomeService` task storage format (deferred to Run 13)
- No changes to `MemoryManager` or `AgentSession` beyond the `FIRST_RUN_SKILL` import
- No new IPC channels
