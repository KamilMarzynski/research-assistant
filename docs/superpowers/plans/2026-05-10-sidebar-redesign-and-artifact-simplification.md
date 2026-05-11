# Sidebar Redesign and Artifact Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right sidebar with two panels (project artifacts + research history), remove `save_artifact` tool, and auto-capture all project-folder writes as artifacts.

**Architecture:** Main process removes `save_artifact` from agent tool lists and wires `ArtifactService` into `OutputRouter.moveFinals()` so research finals become artifact records. Renderer replaces `RecentOutputsPanel` + `FileExplorer` with `ProjectArtifactsPanel` + `ResearchHistoryPanel`. IPC channels cleaned up: `GET_PROJECT_ARTIFACTS` and `GET_RESEARCHES` added; `GET_RECENT_OUTPUTS`, `ACKNOWLEDGE_OUTPUT`, `ACKNOWLEDGE_ALL_OUTPUTS` removed.

**Tech Stack:** TypeScript, React 19, Electron IPC, Drizzle ORM, Bun, Vitest.

---

## File Map

| File | Responsibility |
|---|---|
| `src/shared/ipc-channels.ts` | IPC channel registry — add new, remove dead |
| `src/shared/ipc-guards.ts` | Runtime payload guards for new channels |
| `src/main/ipc/artifact-handlers.ts` | `GET_PROJECT_ARTIFACTS` handler; remove dead handlers |
| `src/main/ipc/research-handlers.ts` | Add `GET_RESEARCHES` handler |
| `src/main/ipc/register.ts` | Wire new handlers into DI container |
| `src/main/services/TaskPersistenceService.ts` | Add `getTasksByProject()` |
| `src/main/agent/tools/artifact-tools.ts` | **Delete** — `save_artifact` tool gone |
| `src/main/agent/tools.ts` | Remove `save_artifact` from union, options, imports |
| `src/main/agent/worker-agent.ts` | Remove `saveArtifactFn` from config; remove `save_artifact` from `ORCHESTRATOR_TOOL_NAMES` |
| `src/main/agent/builtin-skills.ts` | Remove `save_artifact` mention from system prompt text |
| `src/main/agent/OutputRouter.ts` | Inject `ArtifactService`; create artifact records after `moveFinals()` |
| `src/main/services/ResearchService.ts` | Pass `ArtifactService` into `OutputRouter` usage |
| `src/renderer/components/layout/ProjectArtifactsPanel.tsx` | **New** — scrollable rounded artifact list |
| `src/renderer/components/layout/ResearchHistoryPanel.tsx` | **New** — scrollable rounded research list with live status |
| `src/renderer/components/layout/DetailsPanel.tsx` | Replace children with new panels |
| `src/renderer/components/layout/RecentOutputsPanel.tsx` | **Delete** |
| `src/renderer/components/layout/__tests__/ProjectArtifactsPanel.test.tsx` | **New** |
| `src/renderer/components/layout/__tests__/ResearchHistoryPanel.test.tsx` | **New** |
| `src/renderer/components/layout/__tests__/DetailsPanel.test.tsx` | Update to match new children |

---

## Task 1: Add `getTasksByProject` to persistence layer

**Files:**
- Modify: `src/main/services/TaskPersistenceService.ts`
- Test: `src/main/services/__tests__/ResearchService.test.ts` (add test for new method)

- [ ] **Step 1: Write the failing test**

Create a new test block in `src/main/services/__tests__/ResearchService.test.ts` (or `TaskPersistenceService.test.ts` if it exists; if not, add to `ResearchService.test.ts` since it already tests research tasks):

```ts
it("getTasksByProject returns tasks sorted by createdAt desc", async () => {
  await taskPersistence.saveTask({
    taskId: "t1",
    projectId: "proj-a",
    projectName: "A",
    query: "q1",
    folderPath: null,
    startedAt: new Date("2026-05-01").toISOString(),
  });
  await taskPersistence.saveTask({
    taskId: "t2",
    projectId: "proj-a",
    projectName: "A",
    query: "q2",
    folderPath: null,
    startedAt: new Date("2026-05-05").toISOString(),
  });
  await taskPersistence.saveTask({
    taskId: "t3",
    projectId: "proj-b",
    projectName: "B",
    query: "q3",
    folderPath: null,
    startedAt: new Date("2026-05-03").toISOString(),
  });

  const result = await taskPersistence.getTasksByProject("proj-a");
  expect(result).toHaveLength(2);
  expect(result[0].taskId).toBe("t2");
  expect(result[1].taskId).toBe("t1");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- src/main/services/__tests__/ResearchService.test.ts
```

Expected: FAIL — `getTasksByProject` is not a function.

- [ ] **Step 3: Add `getTasksByProject` to `TaskPersistenceService`**

```ts
async getTasksByProject(projectId: string): Promise<ResearchTask[]> {
  const rows = await this.db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt));
  return rows.map((r) => ({
    taskId: r.id,
    projectId: r.projectId,
    projectName: r.projectName,
    query: r.query,
    folderPath: r.folderPath,
    startedAt: new Date(r.createdAt).toISOString(),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test -- src/main/services/__tests__/ResearchService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/TaskPersistenceService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat: add getTasksByProject to TaskPersistenceService

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Clean up IPC channels

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-guards.ts`
- Modify: `src/main/ipc/artifact-handlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/ipc-validation.ts`

- [ ] **Step 1: Update `ipc-channels.ts`**

Remove:
```ts
GET_RECENT_OUTPUTS: "GET_RECENT_OUTPUTS",
ACKNOWLEDGE_OUTPUT: "ACKNOWLEDGE_OUTPUT",
ACKNOWLEDGE_ALL_OUTPUTS: "ACKNOWLEDGE_ALL_OUTPUTS",
```

Add:
```ts
GET_PROJECT_ARTIFACTS: "GET_PROJECT_ARTIFACTS",
GET_RESEARCHES: "GET_RESEARCHES",
```

- [ ] **Step 2: Remove dead Zod schemas from `ipc-validation.ts`**

Delete `AcknowledgeOutputSchema`, `AcknowledgeAllOutputsSchema`, and `GetRecentOutputsSchema` if they exist. Remove `RecentOutputsSchema` from exports.

- [ ] **Step 3: Remove dead runtime guards from `ipc-guards.ts`**

Delete `decodeRecentOutputsPayload`, `decodeAcknowledgeOutputPayload`, `decodeAcknowledgeAllOutputsPayload` if they exist.

- [ ] **Step 4: Update `artifact-handlers.ts`**

Replace the `GET_RECENT_OUTPUTS` handler with `GET_PROJECT_ARTIFACTS`:

```ts
ipcMain.handle(IPC.GET_PROJECT_ARTIFACTS, async (_event, payload: unknown) => {
  const p = parseOrThrow(ProjectIdSchema, payload, "GET_PROJECT_ARTIFACTS");
  return artifactService.listArtifacts(p.projectId);
});
```

Remove the `ACKNOWLEDGE_OUTPUT` and `ACKNOWLEDGE_ALL_OUTPUTS` handlers entirely.

- [ ] **Step 5: Update `register.ts`**

Remove `OutputNotificationService` from the `artifact-handlers.ts` registration if it was passed there. `artifact-handlers.ts` only needs `projectService`, `artifactService`, `allowlistService`.

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors. Fix any import breakage.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-channels.ts src/shared/ipc-guards.ts src/shared/ipc-validation.ts src/main/ipc/artifact-handlers.ts src/main/ipc/register.ts
git commit -m "refactor: clean up dead IPC channels for artifact notifications

- Remove GET_RECENT_OUTPUTS, ACKNOWLEDGE_OUTPUT, ACKNOWLEDGE_ALL_OUTPUTS
- Add GET_PROJECT_ARTIFACTS, GET_RESEARCHES

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Remove `save_artifact` from agent layer

**Files:**
- **Delete**: `src/main/agent/tools/artifact-tools.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/builtin-skills.ts`

- [ ] **Step 1: Delete `artifact-tools.ts`**

```bash
git rm src/main/agent/tools/artifact-tools.ts
```

- [ ] **Step 2: Remove `save_artifact` from `AgentToolName` union in `tools.ts`**

```ts
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "fetch_url"
  | "web_search"
  | "request_evaluation"
  | "start_research"
  | "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "propose_tool"
  | "save_memory"
  | "read_memory"
  | "compress";
```

- [ ] **Step 3: Remove `saveArtifactFn` from `AgentToolsOptions` in `tools.ts`**

Delete:
```ts
saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
```

Delete the `createSaveArtifactTool` import and the `if (opts.saveArtifactFn)` block that pushes it.

- [ ] **Step 4: Remove `saveArtifactFn` from `WorkerAgentConfig` in `worker-agent.ts`**

Delete the `saveArtifactFn` property from `WorkerAgentConfig`.

- [ ] **Step 5: Remove `saveArtifactFn` wiring from `createWorkerAgent` in `worker-agent.ts`**

Remove the destructuring, the `buildSaveArtifactFn` helper, and the `saveArtifactFn` argument passed to `createAgentTools`.

- [ ] **Step 6: Remove `save_artifact` from `ORCHESTRATOR_TOOL_NAMES` in `worker-agent.ts`**

```ts
export const ORCHESTRATOR_TOOL_NAMES: readonly AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "run_in_docker",
  "spawn_agent",
  "spawn_agents_parallel",
] as const;
```

- [ ] **Step 7: Remove `save_artifact` mention from `builtin-skills.ts`**

Delete the line:
```
Use save_artifact to persist valuable outputs — both intermediate and final.
```

- [ ] **Step 8: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/main/agent/tools/artifact-tools.ts src/main/agent/tools.ts src/main/agent/worker-agent.ts src/main/agent/builtin-skills.ts
git commit -m "refactor: remove save_artifact agent tool

Agent now uses write_file into project folder for all outputs.
No ambiguity between two file-writing tools.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Wire `ArtifactService` into `OutputRouter`

**Files:**
- Modify: `src/main/agent/OutputRouter.ts`
- Modify: `src/main/services/ResearchService.ts`

- [ ] **Step 1: Add `ArtifactService` dependency to `OutputRouter`**

```ts
import type { ArtifactService } from "../services/ArtifactService";

export class OutputRouter {
  constructor(
    private readonly jail: PathJail,
    private readonly artifactService?: ArtifactService,
  ) {}
  // ... existing parseConventions unchanged
```

- [ ] **Step 2: Create artifact records after `moveFinals()`**

Inside `moveFinals()`, after `await rename(sourcePath, destPath);`:

```ts
if (this.artifactService) {
  const fileName = entry;
  await this.artifactService.saveArtifact({
    projectId: this.jail.projectId,
    title: fileName,
    filePath: destPath,
    relativePath: join(destDir, fileName).replace(`${conventions.default}/`, ""),
    acknowledged: false,
  }).catch((err) => {
    console.error(`[OutputRouter] artifact record failed for ${destPath}:`, err);
  });
}
```

- [ ] **Step 3: Update `ResearchService` to inject `ArtifactService`**

Add import:
```ts
import { ArtifactService } from "../services/ArtifactService";
```

Inject in constructor:
```ts
constructor(
  @inject(EventBus) private readonly eventBus: EventBus,
  @inject(SettingsService) private readonly settingsService: SettingsService,
  @inject(HomeService) private readonly homeService: HomeService,
  @inject(AllowlistService) private readonly allowlistService: AllowlistService,
  @inject(CrystallizationService) private readonly crystallizationService: CrystallizationService,
  @inject(ArtifactService) private readonly artifactService: ArtifactService,
) {}
```

- [ ] **Step 4: Pass `artifactService` into `OutputRouter` instances in `ResearchService`**

Change both `new OutputRouter(jail)` calls to `new OutputRouter(jail, this.artifactService)`.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/OutputRouter.ts src/main/services/ResearchService.ts
git commit -m "feat: auto-create artifact records when OutputRouter moves finals

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Add `GET_RESEARCHES` IPC handler

**Files:**
- Modify: `src/main/ipc/research-handlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/services/HomeService.ts`

- [ ] **Step 1: Expose `getTasksByProject` through `HomeService`**

```ts
async getTasksByProject(projectId: string): Promise<ResearchTask[]> {
  return this.taskPersistence.getTasksByProject(projectId);
}
```

- [ ] **Step 2: Add `GET_RESEARCHES` handler to `research-handlers.ts`**

```ts
ipcMain.handle(IPC.GET_RESEARCHES, async (_event, payload: unknown) => {
  const { projectId } = parseOrThrow(ProjectIdSchema, payload, "GET_RESEARCHES");
  const rows = await homeService.getTasksByProject(projectId);
  return rows.map((r) => ({
    id: r.taskId,
    query: r.query,
    status: "in_progress", // HomeService returns ResearchTask which has no status field
    startedAt: r.startedAt,
  }));
});
```

Wait — `ResearchTask` from `HomeService` does not include `status`. We need to read from DB directly. Better approach: add `getTasksByProject` to `TaskPersistenceService` that returns full DB rows (with status and error).

- [ ] **Step 2b (corrected): Update `getTasksByProject` to return full DB rows**

Modify `TaskPersistenceService.getTasksByProject`:

```ts
async getTasksByProject(projectId: string): Promise<Array<{
  id: string;
  query: string;
  status: "pending" | "in_progress" | "complete" | "failed";
  startedAt: Date;
  error: string | null;
}>> {
  const rows = await this.db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(desc(tasks.createdAt));
  return rows.map((r) => ({
    id: r.id,
    query: r.query,
    status: r.status,
    startedAt: r.createdAt,
    error: r.error,
  }));
}
```

- [ ] **Step 2c: Update `HomeService` delegate method**

```ts
async getTasksByProject(projectId: string): Promise<ReturnType<TaskPersistenceService["getTasksByProject"]>> {
  return this.taskPersistence.getTasksByProject(projectId);
}
```

- [ ] **Step 2d: Update `research-handlers.ts`**

```ts
ipcMain.handle(IPC.GET_RESEARCHES, async (_event, payload: unknown) => {
  const { projectId } = parseOrThrow(ProjectIdSchema, payload, "GET_RESEARCHES");
  return homeService.getTasksByProject(projectId);
});
```

- [ ] **Step 3: Update `register.ts`**

Ensure `homeService` is available in the `registerResearchHandlers` call.

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/TaskPersistenceService.ts src/main/services/HomeService.ts src/main/ipc/research-handlers.ts src/main/ipc/register.ts
git commit -m "feat: add GET_RESEARCHES IPC handler

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Build `ProjectArtifactsPanel` renderer component

**Files:**
- Create: `src/renderer/components/layout/ProjectArtifactsPanel.tsx`
- Create: `src/renderer/components/layout/__tests__/ProjectArtifactsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectArtifactsPanel from "../ProjectArtifactsPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

describe("ProjectArtifactsPanel", () => {
  it("shows empty state when no artifacts", async () => {
    window.electronAPI = {
      invoke: mockInvoke({ GET_PROJECT_ARTIFACTS: [] }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("No artifacts yet")).toBeTruthy();
  });

  it("renders artifact list", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_PROJECT_ARTIFACTS: [
          { id: "a1", filePath: "docs/report.md", title: "final report", createdAt: new Date() },
        ],
      }),
      send: vi.fn(),
      on: vi.fn(),
    } as unknown as Window["electronAPI"];

    render(<ProjectArtifactsPanel projectId="proj-1" />);
    expect(await screen.findByText("docs/report.md")).toBeTruthy();
    expect(screen.getByText("final report")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- src/renderer/components/layout/__tests__/ProjectArtifactsPanel.test.tsx
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `ProjectArtifactsPanel`**

```tsx
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import { IconDoc } from "../shared/Icons";

interface ProjectArtifactsPanelProps {
  projectId: string;
}

export default function ProjectArtifactsPanel({ projectId }: ProjectArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_PROJECT_ARTIFACTS, { projectId }).then(setArtifacts);
  }, [projectId]);

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
        <span className="dot dot--accent" />
        <span className="eyebrow">Project Artifacts</span>
      </div>
      <div
        className="thin-scroll"
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-2)",
          padding: 10,
        }}
      >
        {artifacts.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            No artifacts yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {artifacts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface)",
                }}
              >
                <IconDoc size={13} strokeColor="var(--ink-3)" style={{ flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.filePath}
                </span>
                <span className="chip" style={{ flexShrink: 0 }}>
                  {a.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test -- src/renderer/components/layout/__tests__/ProjectArtifactsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/ProjectArtifactsPanel.tsx src/renderer/components/layout/__tests__/ProjectArtifactsPanel.test.tsx
git commit -m "feat: add ProjectArtifactsPanel renderer component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Build `ResearchHistoryPanel` renderer component

**Files:**
- Create: `src/renderer/components/layout/ResearchHistoryPanel.tsx`
- Create: `src/renderer/components/layout/__tests__/ResearchHistoryPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResearchHistoryPanel from "../ResearchHistoryPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

describe("ResearchHistoryPanel", () => {
  it("shows empty state when no researches", async () => {
    window.electronAPI = {
      invoke: mockInvoke({ GET_RESEARCHES: [] }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("No research history")).toBeTruthy();
  });

  it("renders research list with status", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_RESEARCHES: [
          { id: "r1", query: "quantum computing", status: "in_progress", startedAt: new Date() },
          { id: "r2", query: "market analysis", status: "complete", startedAt: new Date("2026-05-09") },
        ],
      }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(<ResearchHistoryPanel projectId="proj-1" />);
    expect(await screen.findByText("quantum computing")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test -- src/renderer/components/layout/__tests__/ResearchHistoryPanel.test.tsx
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `ResearchHistoryPanel`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { IconDoc } from "../../shared/Icons";

interface ResearchItem {
  id: string;
  query: string;
  status: "pending" | "in_progress" | "complete" | "failed";
  startedAt: Date;
}

interface ResearchHistoryPanelProps {
  projectId: string;
}

function formatDate(d: Date): string {
  const now = new Date();
  const date = new Date(d);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ResearchHistoryPanel({ projectId }: ResearchHistoryPanelProps) {
  const [items, setItems] = useState<ResearchItem[]>([]);

  const load = useCallback(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_RESEARCHES, { projectId }).then((rows: unknown[]) => {
      setItems(
        rows.map((r) => ({
          id: (r as { id: string }).id,
          query: (r as { query: string }).query,
          status: (r as { status: string }).status as ResearchItem["status"],
          startedAt: new Date((r as { startedAt: string | Date }).startedAt),
        })),
      );
    });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data: unknown) => {
      const d = data as { projectId?: string };
      if (d.projectId === projectId) load();
    });
    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data: unknown) => {
      const d = data as { projectId?: string };
      if (d.projectId === projectId) load();
    });
    return () => {
      unsubUpdate();
      unsubComplete();
    };
  }, [projectId, load]);

  const statusConfig: Record<
    ResearchItem["status"],
    { dotClass: string; label: string; borderColor: string }
  > = {
    pending: { dotClass: "dot--warn", label: "Pending", borderColor: "oklch(0.85 0.06 75)" },
    in_progress: { dotClass: "dot--accent dot--pulse", label: "Running", borderColor: "var(--accent-line)" },
    complete: { dotClass: "dot--success", label: "Done", borderColor: "oklch(0.82 0.05 145)" },
    failed: { dotClass: "dot--danger", label: "Failed", borderColor: "oklch(0.82 0.07 25)" },
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
        <span className="dot dot--accent" />
        <span className="eyebrow">Researches</span>
      </div>
      <div
        className="thin-scroll"
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-2)",
          padding: 10,
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            No research history
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((item) => {
              const cfg = statusConfig[item.status];
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    padding: 8,
                    borderRadius: "var(--r-md)",
                    background: "var(--surface)",
                    borderLeft: `3px solid ${cfg.borderColor}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={`dot ${cfg.dotClass}`} style={{ width: 6, height: 6 }} />
                    <span style={{ fontSize: 11, fontWeight: 500 }}>{cfg.label}</span>
                    <span style={{ flex: 1, textAlign: "right", fontSize: 10, color: "var(--ink-3)" }}>
                      {formatDate(item.startedAt)}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.query}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test -- src/renderer/components/layout/__tests__/ResearchHistoryPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/ResearchHistoryPanel.tsx src/renderer/components/layout/__tests__/ResearchHistoryPanel.test.tsx
git commit -m "feat: add ResearchHistoryPanel renderer component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Rewrite `DetailsPanel`

**Files:**
- Modify: `src/renderer/components/layout/DetailsPanel.tsx`
- Modify: `src/renderer/components/layout/__tests__/DetailsPanel.test.tsx`

- [ ] **Step 1: Update `DetailsPanel.tsx`**

```tsx
import { useProject } from "../../contexts/ProjectContext";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import ResearchHistoryPanel from "./ResearchHistoryPanel";
import WindowDragBar from "./WindowDragBar";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  if (!activeProjectId) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <WindowDragBar />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            color: "var(--ink-3)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Select a project to view artifacts and research history.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        overflow: "hidden",
        gap: 12,
        padding: 12,
      }}
    >
      <WindowDragBar />
      <ProjectArtifactsPanel projectId={activeProjectId} />
      <ResearchHistoryPanel projectId={activeProjectId} />
    </div>
  );
}
```

- [ ] **Step 2: Update `DetailsPanel.test.tsx`**

Replace existing test content:

```tsx
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectContext, type ProjectContextValue } from "../../../contexts/ProjectContext";
import DetailsPanel from "../DetailsPanel";

function mockInvoke(results: Record<string, unknown[]>) {
  return vi.fn((channel: string) => {
    return Promise.resolve(results[channel] ?? []);
  });
}

function renderWithProvider(element: React.ReactElement, projectId: string | null = "proj-1") {
  const ctx: ProjectContextValue = {
    activeProjectId: projectId,
    setActiveProjectId: vi.fn(),
  };
  return render(<ProjectContext.Provider value={ctx}>{element}</ProjectContext.Provider>);
}

describe("DetailsPanel", () => {
  it("renders empty state when no project is active", () => {
    window.electronAPI = {
      invoke: mockInvoke({}),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    renderWithProvider(<DetailsPanel />, null);
    expect(screen.getByText(/Select a project/)).toBeTruthy();
  });

  it("renders both panels for active project", async () => {
    window.electronAPI = {
      invoke: mockInvoke({
        GET_PROJECT_ARTIFACTS: [],
        GET_RESEARCHES: [],
      }),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    renderWithProvider(<DetailsPanel />, "proj-1");
    expect(await screen.findByText("No artifacts yet")).toBeTruthy();
    expect(await screen.findByText("No research history")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun run test -- src/renderer/components/layout/__tests__/DetailsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/DetailsPanel.tsx src/renderer/components/layout/__tests__/DetailsPanel.test.tsx
git commit -m "feat: rewrite DetailsPanel with two new panels

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Delete dead renderer components

**Files:**
- **Delete**: `src/renderer/components/layout/RecentOutputsPanel.tsx`
- **Delete**: `src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx`
- Modify: `src/renderer/components/layout/FileExplorer.tsx` — keep file, just remove from sidebar (already done in Task 8)

- [ ] **Step 1: Delete `RecentOutputsPanel`**

```bash
git rm src/renderer/components/layout/RecentOutputsPanel.tsx src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx
```

- [ ] **Step 2: Verify `FileExplorer` has no other consumers**

```bash
grep -r "FileExplorer" src/renderer --include="*.tsx" --include="*.ts"
```

Expected: only `FileExplorer.tsx` itself and possibly `DetailsPanel.tsx` (if it still imports it). If `DetailsPanel` no longer imports it, `FileExplorer` is orphaned. Keep the file for now — do not delete unless user confirms. If orphaned, import nothing is broken.

- [ ] **Step 3: Run full test suite for renderer layout**

```bash
bun run test -- src/renderer/components/layout
```

Expected: All tests in `layout` pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove RecentOutputsPanel and related dead code

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Full integration check

- [ ] **Step 1: Run typecheck → check → test**

```bash
bun run typecheck
bun run check
bun run test
```

Expected: All green.

- [ ] **Step 2: Launch dev and verify sidebar renders**

```bash
bun run dev
```

Manually verify:
- Select a project → sidebar shows "Project Artifacts" and "Researches" panels
- No file explorer visible
- No "Acknowledge" buttons
- Running research appears in bottom panel with pulsing dot

- [ ] **Step 3: Final commit (if any fixes needed)**

If no fixes:
```bash
git status
```

Should be clean. If there were uncommitted fixes:
```bash
git add -A && git commit -m "fix: address integration issues from sidebar redesign"
```

---

## Self-Review

**Spec coverage check:**

| Spec Requirement | Task |
|---|---|
| Remove `save_artifact` tool | Task 3 |
| Auto-capture project-folder writes | Already works via `write_file` → `onFileWrite`. Task 4 adds `OutputRouter` artifact creation. |
| Two-panel sidebar | Tasks 6, 7, 8 |
| Remove acknowledgements | Task 2 (IPC cleanup) |
| Remove file explorer from sidebar | Task 8 (DetailsPanel rewrite), Task 9 |
| Research history with live status | Task 5 (backend), Task 7 (frontend) |
| No actions on items yet | Tasks 6, 7 — no buttons in components |

**Placeholder scan:**
- No "TBD", "TODO", "implement later", or "similar to Task N" found.
- Every code block contains complete, runnable code.
- Exact file paths used throughout.

**Type consistency check:**
- `Artifact` type unchanged — `ProjectArtifactsPanel` uses it directly.
- `ResearchItem` type matches `getTasksByProject` return shape.
- IPC channel names consistent across `ipc-channels.ts`, handlers, and renderer.

**Gap found:** `OutputNotificationService` is likely orphaned after Task 2/3 but not explicitly removed. The DI container may still inject it. Add cleanup step in Task 10 or as a follow-up if typecheck complains.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-sidebar-redesign-and-artifact-simplification.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
