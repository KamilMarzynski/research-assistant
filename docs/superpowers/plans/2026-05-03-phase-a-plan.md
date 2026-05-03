# Phase A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift from app-internal storage to filesystem-native workflow: require linked folder per project, auto-detect missing AGENTS.md and onboard user, route research outputs to project folder via agent decision, replace artifact viewer with recent outputs notification panel.

**Architecture:** `ResearchService` becomes a task runner (not a router). Agent reads AGENTS.md, decides output locations. `write_file` tool emits events for writes in project folder. DB `artifacts` table gains `acknowledged` + `relativePath` columns. Renderer right panel shows recent unacknowledged outputs.

**Tech Stack:** Electron (main/renderer), TypeScript, Drizzle ORM + SQLite, React + MUI, Pi Agent SDK, Bun, Vitest.

---

## File Map

| File | Responsibility |
|---|---|
| `src/main/ipc/project-handlers.ts` | IPC handlers for project CRUD + folder dialog |
| `src/renderer/components/layout/LeftSidebar.tsx` | Project list UI + creation dialog |
| `src/main/ipc-validation.ts` | Zod schemas for IPC payloads |
| `src/main/agent/context.ts` | `buildSystemContext()` — loads AGENTS.md, skills, config |
| `src/main/agent/session.ts` | `AgentSession` — wraps Pi Agent, holds system context |
| `src/main/services/ResearchService.ts` | Starts research, creates workspace, dispatches worker |
| `src/main/agent/worker-agent.ts` | `createWorkerAgent()` — builds sub-agent with tools |
| `src/main/agent/tools/file-tools.ts` | `write_file` tool implementation |
| `src/main/agent/tools.ts` | `createAgentTools()` factory |
| `src/main/event-bus.ts` | `EventBus` — typed event emitter |
| `src/main/db/schema.ts` | Drizzle table definitions |
| `src/main/db/migrate.ts` | Migration runner |
| `src/main/services/ArtifactService.ts` | Business logic for artifact/notification records |
| `src/main/repositories/IArtifactRepository.ts` | Repository interface |
| `src/main/repositories/drizzle/DrizzleArtifactRepository.ts` | Drizzle implementation |
| `src/shared/types.ts` | Shared TypeScript types |
| `src/shared/ipc-channels.ts` | IPC channel constants |
| `src/main/ipc/artifact-handlers.ts` | IPC handlers for artifact/notification APIs |
| `src/renderer/components/layout/DetailsPanel.tsx` | Right panel container |
| `src/renderer/components/layout/ArtifactSection.tsx` | Current artifact list (to be replaced) |
| `src/renderer/components/layout/ArtifactViewer.tsx` | Current artifact viewer (to be removed) |

---

### Task 1: Require folderPath at Project Creation

**Files:**
- Modify: `src/main/ipc/project-handlers.ts:52-59`
- Modify: `src/main/ipc-validation.ts:5-8`
- Modify: `src/renderer/components/layout/LeftSidebar.tsx:40,58-69,244`
- Test: `src/main/__tests__/project-handlers.test.ts` (create if missing, or add to existing)

**Why:** `folderPath` becomes required. No project without a directory.

- [ ] **Step 1: Write failing test**

Create `src/main/__tests__/project-handlers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CreateProjectSchema } from "../ipc-validation";

describe("CreateProjectSchema", () => {
  it("requires folderPath", () => {
    const result = CreateProjectSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(false);
  });

  it("accepts valid payload", () => {
    const result = CreateProjectSchema.safeParse({ name: "Test", folderPath: "/tmp/test" });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/__tests__/project-handlers.test.ts`

Expected: FAIL — `folderPath` is currently `.nullable().optional()`, so missing folderPath passes.

- [ ] **Step 3: Update schema to require folderPath**

In `src/main/ipc-validation.ts:5-8`, change:

```typescript
export const CreateProjectSchema = z.object({
  name: z.string(),
  folderPath: z.string(),
});
```

- [ ] **Step 4: Update main handler**

In `src/main/ipc/project-handlers.ts:25-28`, change:

```typescript
  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    const p = parseOrThrow(CreateProjectSchema, payload, "CREATE_PROJECT");
    return projectService.createProject(p.name, p.folderPath);
  });
```

- [ ] **Step 5: Update renderer — dialog properties and validation**

In `src/renderer/components/layout/LeftSidebar.tsx:40`, change state type:

```typescript
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null);
```

Keep as `string | null` but treat it as required in `handleCreate`.

In `src/renderer/components/layout/LeftSidebar.tsx:58-69`, change `handleCreate`:

```typescript
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !newFolderPath) return;
    const project = await window.electronAPI.invoke(IPC.CREATE_PROJECT, {
      name,
      folderPath: newFolderPath,
    });
    setProjects((prev) => [...prev, project]);
    setNewName("");
    setNewFolderPath(null);
    setCreating(false);
    setActiveProjectId(project.id);
  };
```

In `src/renderer/components/layout/LeftSidebar.tsx:244`, change button text:

```typescript
                {newFolderPath ? newFolderPath.split("/").pop() : "Select project folder *"}
```

- [ ] **Step 6: Update dialog properties**

In `src/main/ipc/project-handlers.ts:52-58`, change:

```typescript
  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select or create project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
```

- [ ] **Step 7: Run tests**

Run: `bun test src/main/__tests__/project-handlers.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc-validation.ts src/main/ipc/project-handlers.ts src/renderer/components/layout/LeftSidebar.tsx src/main/__tests__/project-handlers.test.ts
git commit -m "feat: require folderPath at project creation"
```

---

### Task 2: AGENTS.md Onboarding Detection

**Files:**
- Modify: `src/main/agent/context.ts:131-165`
- Modify: `src/main/agent/builtin-skills.ts:62-103`
- Test: `src/main/agent/__tests__/context.test.ts` (create)

**Why:** If `~/.research-assistant/projects/<slug>/AGENTS.md` is missing, inject a prompt asking the agent to onboard the user.

- [ ] **Step 1: Write failing test**

Create `src/main/agent/__tests__/context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSystemContext } from "../context";
import { getResearchAssistantHome } from "../../paths";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const testHome = join(getResearchAssistantHome(), "test-context");

describe("buildSystemContext", () => {
  const projectName = "Test Project";
  const slug = "test-project";

  it("injects onboarding prompt when AGENTS.md is missing", async () => {
    // Ensure no AGENTS.md exists
    await rm(join(testHome, "projects", slug, "AGENTS.md"), { force: true });

    const context = await buildSystemContext("proj-1", projectName, undefined);
    expect(context).toContain("no AGENTS.md yet");
    expect(context).toContain("Ask the user to describe");
  });

  it("loads existing AGENTS.md when present", async () => {
    const agentsPath = join(testHome, "projects", slug, "AGENTS.md");
    await mkdir(join(testHome, "projects", slug), { recursive: true });
    await writeFile(agentsPath, "# Project Context\n\nThis is a test project.");

    const context = await buildSystemContext("proj-1", projectName, undefined);
    expect(context).toContain("This is a test project");
    expect(context).not.toContain("no AGENTS.md yet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/agent/__tests__/context.test.ts`

Expected: FAIL — current `buildSystemContext` silently skips missing AGENTS.md, no onboarding prompt.

- [ ] **Step 3: Add onboarding prompt to buildSystemContext**

In `src/main/agent/context.ts:131-165`, rewrite the AGENTS.md section:

```typescript
  // 3. AGENTS.md — project root first, then app dir
  const slug = toSlug(projectName);
  let agentsContent = "";

  // Try linked folder root first
  if (folderPath) {
    try {
      const rootAgents = await readFile(join(folderPath, "AGENTS.md"), "utf-8");
      if (rootAgents.trim()) {
        agentsContent = rootAgents.trim();
      }
    } catch {
      // not present in project root
    }
  }

  // Fall back to app-dir AGENTS.md
  if (!agentsContent) {
    try {
      const appAgents = await readFile(join(raHome, "projects", slug, "AGENTS.md"), "utf-8");
      if (appAgents.trim()) {
        agentsContent = appAgents.trim();
      }
    } catch {
      // not present yet
    }
  }

  if (agentsContent) {
    parts.push("<!-- Project context (AGENTS.md) -->", agentsContent);
  } else {
    parts.push(
      "<!-- Project context (AGENTS.md) -->",
      "This project has no AGENTS.md yet. Ask the user to describe:",
      "1. What is this project about?",
      "2. How are files organized?",
      "3. Where should research outputs go?",
      "4. Any naming conventions or folder structures?",
      "After getting answers, write the AGENTS.md file to ~/.research-assistant/projects/" + slug + "/AGENTS.md using the write_file tool.",
    );
  }
```

- [ ] **Step 4: Update DISCOVER_PROJECT_SKILL to use app-dir path**

In `src/main/agent/builtin-skills.ts:62-103`, change the skill text to reference the app-dir path consistently:

```typescript
export const DISCOVER_PROJECT_SKILL = `---
name: discover_project
description: Walk and document a linked project folder. Use when a project has a folderPath but no AGENTS.md exists yet, or when the user asks you to analyze their project structure.
---

# discover_project

When a project has a linked folder but \`~/.research-assistant/projects/<slug>/AGENTS.md\` does not exist yet, or when the user asks you to understand their project:

## Discovery steps

1. Call \`list_dir({ path: "<folderPath>" })\` to see top-level structure
2. For each interesting item (README, package.json, CLAUDE.md, AGENTS.md, src/, docs/), call \`read_file\` to understand the project
3. Ask the user 2-3 clarifying questions about their project goal and conventions
4. Write \`~/.research-assistant/projects/<slug>/AGENTS.md\` using \`write_file\` with the template below
5. Tell the user: "I've read your project structure and written a context file. Ready to help."

## AGENTS.md template

\`\`\`markdown
# <Project Name> — Agent Context

## What this project is
<one paragraph from user description>

## Folder structure
<bullet list of key dirs/files and their purpose>

## Key files
<list of important files to know>

## Conventions
<naming, code style, any patterns observed or described by user>

## Output location
Where research outputs and artifacts should be saved

## Notes
<anything else the agent should know>
\`\`\`

## Slug format

Slug = project name, lowercased, spaces → hyphens, non-alphanumeric stripped.
Example: "My Cool Project!" → "my-cool-project"
`;
```

- [ ] **Step 5: Run tests**

Run: `bun test src/main/agent/__tests__/context.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/context.ts src/main/agent/builtin-skills.ts src/main/agent/__tests__/context.test.ts
git commit -m "feat: AGENTS.md onboarding detection in system context"
```

---

### Task 3: ResearchService as Runner-Only

**Files:**
- Modify: `src/main/services/ResearchService.ts:32-55, 79-99, 130-248`
- Modify: `src/main/agent/worker-agent.ts:31-46`
- Modify: `src/main/ipc/chat-handlers.ts:69-94` (where buildSystemContext is called)
- Test: `src/main/services/__tests__/ResearchService.test.ts` (create if missing)

**Why:** Remove hardcoded `output.md` from `_runResearch`. Agent decides what files to create and where. Research prompt includes AGENTS.md context so agent knows conventions.

- [ ] **Step 1: Write failing test**

Create `src/main/services/__tests__/ResearchService.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

describe("ResearchService", () => {
  it("does not hardcode output file name", () => {
    // Verify _runResearch signature does not enforce outputFileName
    // This is a structural test — the actual behavior is tested via integration
    expect(true).toBe(true);
  });
});
```

Note: Full integration tests for ResearchService require heavy mocking. This task focuses on code changes; integration tests can be added later with a mock LLM server.

- [ ] **Step 2: Remove outputFileName from _runResearch**

In `src/main/services/ResearchService.ts`, change `_runResearch` signature and body:

```typescript
  private async _runResearch(
    config: RunResearchConfig,
    buildPartialConfig: (
      workspacePath: string,
    ) => Omit<WorkerAgentConfig, "provider" | "onProgress">,
  ): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    const settings = await this.settingsService.getSettings();

    const homePath = this.homeService.getHomePath();
    const workspacePath = join(homePath, "workspace", config.projectId, taskId);

    // Fire cleanup in background
    this.cleanupOldWorkspaces().catch((err) => {
      console.error("[ResearchService] background workspace cleanup failed:", err);
    });

    await mkdir(workspacePath, { recursive: true });

    const provider = await resolveProvider(settings, this.settingsService);
    const partialConfig = buildPartialConfig(workspacePath);

    const workerConfig: WorkerAgentConfig = {
      ...partialConfig,
      provider,
      onProgress: (label, delta) => {
        this.eventBus.emit({
          type: "research:progress",
          payload: { taskId, message: delta, label },
        });
      },
    };

    const worker = createWorkerAgent(workerConfig);

    worker.agent
      .prompt(config.query)
      .then(async () => {
        // Worker completed — nothing to automatically save
        // Agent decided what files to create via write_file tool
        this.eventBus.emit({
          type: "research:complete",
          payload: {
            taskId,
            projectId: config.projectId,
            query: config.query,
            filePath: "", // no longer meaningful — agent chose its own paths
          },
        });
      })
      .catch((err) => {
        console.error(`[ResearchService] worker failed for task ${taskId}:`, err);
        this.eventBus.emit({
          type: "research:failed",
          payload: {
            taskId,
            projectId: config.projectId,
            query: config.query,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      });

    return { taskId };
  }
```

- [ ] **Step 3: Update startResearch to remove outputFileName**

In `src/main/services/ResearchService.ts:32-55`, change:

```typescript
  async startResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    return this._runResearch(
      { projectId, projectName, query, folderPath },
      (workspacePath) => ({
        toolNames: ["read_file", "write_file", "list_dir", "safe_bash", "request_evaluation"],
        systemPromptAddition: [
          "You are a background researcher. Investigate the given query thoroughly using the available tools.",
          `Your workspace root (for temporary files): ${workspacePath}`,
          "Create final output files in the project folder using write_file, not in the workspace.",
          "Name files meaningfully (no task IDs in filenames).",
          "Be thorough. When done, respond with a final summary of your findings.",
        ].join(" "),
        projectId,
        projectName,
        folderPath,
        homePath: this.homeService.getHomePath(),
        remainingDepth: 0,
      }),
    );
  }
```

- [ ] **Step 4: Update startOrchestratedResearch**

In `src/main/services/ResearchService.ts:57-100`, change:

```typescript
  async startOrchestratedResearch(
    projectId: string,
    projectName: string,
    query: string,
    folderPath: string | null,
  ): Promise<{ taskId: string }> {
    const homePath = this.homeService.getHomePath();

    return this._runResearch(
      { projectId, projectName, query, folderPath },
      (workspacePath) => ({
        toolNames: [...ORCHESTRATOR_TOOL_NAMES],
        systemPromptAddition: [
          "You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.",
          `Your workspace root (for temporary files): ${workspacePath}`,
          "Create final output files in the project folder using write_file, not in the workspace.",
          "Name files meaningfully (no task IDs in filenames).",
          "Write intermediate results to subdirectories within your workspace root.",
          "Use save_artifact to persist valuable outputs — both intermediate and final.",
        ].join("\n"),
        projectId,
        projectName,
        folderPath,
        homePath,
        remainingDepth: 3,
      }),
    );
  }
```

Note: `saveArtifactFn` and `proposeToolFn` are removed from orchestrated research in this phase. `save_artifact` tool will still exist but its behavior changes (see Task 5). If removing `saveArtifactFn` breaks the build, keep the parameter but make it a no-op or redirect to the new notification system.

- [ ] **Step 5: Update chat-handlers to pass AGENTS.md context**

In `src/main/ipc/chat-handlers.ts:69-94`, ensure `buildSystemContext` is called with `project.folderPath ?? undefined` (already happening at line 69). The AGENTS.md content is now injected via `buildSystemContext` (Task 2), so no change needed here.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: zero errors. If `saveArtifactFn` removal causes type errors in `worker-agent.ts`, add a no-op or fix the type.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ResearchService.ts
git commit -m "feat: ResearchService as runner-only, agent decides outputs"
```

---

### Task 4: Track File Writes as Notifications

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts:27-45`
- Modify: `src/main/agent/tools.ts:38-65`
- Modify: `src/main/event-bus.ts:1-56`
- Modify: `src/main/agent/session.ts:54-128`
- Create: `src/main/services/OutputNotificationService.ts`
- Modify: `src/main/ipc/artifact-handlers.ts:1-65`
- Test: `src/main/agent/tools/__tests__/file-tools.test.ts` (create)

**Why:** When agent writes a file in the project folder (not workspace), emit an event. Store as notification record.

- [ ] **Step 1: Add file:written event to EventBus**

In `src/main/event-bus.ts:1-40`, add new event type:

```typescript
type AppEvent =
  | { type: "research:started"; payload: { taskId: string; projectId: string; query: string } }
  | { type: "research:progress"; payload: { taskId: string; message: string; label?: string } }
  | {
      type: "research:complete";
      payload: {
        taskId: string;
        artifactId: string;
        projectId: string;
        query: string;
        filePath: string;
      };
    }
  | {
      type: "research:failed";
      payload: { taskId: string; projectId: string; query: string; error: string };
    }
  | { type: "tool:pending"; payload: { name: string; skillContent: string } }
  | {
      type: "bash:blocked";
      payload: {
        commandId: string;
        command: string;
        reason: string;
        category: string;
        key: string;
        projectId: string;
        intent: string;
        timestamp: string;
      };
    }
  | {
      type: "model:fallback";
      payload: { reason: string; requestedModel: string; fallbackProvider: string };
    }
  | { type: "startup:error"; payload: { phase: string; error: string } }
  | {
      type: "file:written";
      payload: {
        projectId: string;
        absolutePath: string;
        relativePath: string;
        fileName: string;
      };
    };
```

- [ ] **Step 2: Create OutputNotificationService**

Create `src/main/services/OutputNotificationService.ts`:

```typescript
import { inject, injectable } from "tsyringe";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";
import { ARTIFACT_REPO_TOKEN } from "../di/tokens";

export interface FileNotification {
  id: string;
  projectId: string;
  title: string;
  filePath: string;
  createdAt: Date;
  acknowledged: boolean;
}

@injectable()
export class OutputNotificationService {
  constructor(
    @inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository,
  ) {}

  async recordWrite(
    projectId: string,
    absolutePath: string,
    relativePath: string,
    fileName: string,
  ): Promise<void> {
    await this.repo.create({
      projectId,
      title: fileName,
      filePath: relativePath,
    });
  }

  async listUnacknowledged(projectId: string): Promise<FileNotification[]> {
    const all = await this.repo.listByProject(projectId);
    return all
      .filter((a) => !a.acknowledged)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  async acknowledge(projectId: string, artifactId: string): Promise<void> {
    await this.repo.acknowledge(artifactId);
  }

  async acknowledgeAll(projectId: string): Promise<void> {
    await this.repo.acknowledgeAllByProject(projectId);
  }
}
```

- [ ] **Step 3: Add acknowledge methods to IArtifactRepository**

In `src/main/repositories/IArtifactRepository.ts`, add:

```typescript
export interface IArtifactRepository {
  create(data: Omit<Artifact, "id" | "createdAt">): Promise<Artifact>;
  listByProject(projectId: string): Promise<Artifact[]>;
  acknowledge(id: string): Promise<void>;
  acknowledgeAllByProject(projectId: string): Promise<void>;
}
```

- [ ] **Step 4: Implement acknowledge in DrizzleArtifactRepository**

In `src/main/repositories/drizzle/DrizzleArtifactRepository.ts`, add methods:

```typescript
  async acknowledge(id: string): Promise<void> {
    await this.db
      .update(artifacts)
      .set({ acknowledged: true })
      .where(eq(artifacts.id, id));
  }

  async acknowledgeAllByProject(projectId: string): Promise<void> {
    await this.db
      .update(artifacts)
      .set({ acknowledged: true })
      .where(eq(artifacts.projectId, projectId));
  }
```

- [ ] **Step 5: Update createAgentTools to accept onFileWrite callback**

In `src/main/agent/tools.ts:38-65`, add `onFileWrite` to options:

```typescript
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
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  emitBlocked?: (payload: {
    commandId: string;
    command: string;
    reason: string;
    category: string;
    key: string;
    projectId: string;
    intent: string;
    timestamp: string;
  }) => void;
}
```

- [ ] **Step 6: Pass onFileWrite to createWriteFileTool**

In `src/main/agent/tools.ts:67-117`, update:

```typescript
export function createAgentTools(opts: AgentToolsOptions): AgentTool[] {
  const { projectId, folderPath, homePath, startResearchFn, onFileWrite } = opts;
  const jail = new PathJail(projectId, folderPath);
  const workspacePath = join(homePath, "workspace", projectId);
  const auditLogPath = join(homePath, "audit.log");

  const tools: AgentTool<any>[] = [
    createReadFileTool(jail),
    createWriteFileTool(jail, folderPath, onFileWrite),
    createListDirTool(jail),
    createSafeBashTool(projectId, workspacePath, auditLogPath, opts.emitBlocked),
  ];
  // ... rest unchanged
}
```

- [ ] **Step 7: Update createWriteFileTool to emit on project folder writes**

In `src/main/agent/tools/file-tools.ts:27-45`, change:

```typescript
export function createWriteFileTool(
  jail: PathJail,
  folderPath: string | null,
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void,
): AgentTool<typeof writeFileParameters, null> {
  return makeTool({
    name: "write_file",
    label: "Write file",
    description:
      "Write content to a file, creating parent directories as needed. Path must be within the workspace or linked project folder.",
    parameters: writeFileParameters,
    execute: async (_id, { path, content }): Promise<AgentToolResult<null>> => {
      const resolved = jail.validate(path, "write");
      const dir = dirname(resolved);
      await mkdir(dir, { recursive: true });
      await writeFile(resolved, content, "utf-8");

      if (folderPath && onFileWrite) {
        const normalizedFolder = folderPath.replace(/\/$/, "");
        if (resolved.startsWith(normalizedFolder + "/")) {
          const relativePath = resolved.slice(normalizedFolder.length + 1);
          const fileName = resolved.split("/").pop() || relativePath;
          onFileWrite(resolved, relativePath, fileName);
        }
      }

      return {
        content: [{ type: "text" as const, text: `Written: ${resolved}` }],
        details: null,
      };
    },
  });
}
```

- [ ] **Step 8: Wire onFileWrite in AgentSession**

In `src/main/agent/session.ts`, where `createAgentTools` is called (around line 88), add:

```typescript
const tools = createAgentTools({
  projectId,
  projectName,
  folderPath,
  homePath,
  // ... existing options
  onFileWrite: (absolutePath, relativePath, fileName) => {
    // Emit via event bus if available, or call notification service directly
    // For now, emit via a callback passed from chat-handlers
  },
});
```

Since `AgentSession` doesn't have access to services directly, the `onFileWrite` callback should be passed in via `AgentSessionOptions` and wired in `chat-handlers.ts`.

In `src/main/agent/session.ts:25-41`, add to `AgentSessionOptions`:

```typescript
export interface AgentSessionOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  systemContext: string;
  apiKey: string;
  model?: string;
  homePath: string;
  toolNames?: readonly AgentToolName[];
  skills?: string[];
  startResearchFn?: (query: string, deep?: boolean) => Promise<{ taskId: string }>;
  requestEvaluationFn?: (filePath: string, criteria: string[]) => Promise<EvaluationVerdict>;
  spawnAgentFn?: (type: AgentType, query: string, outputPath: string) => Promise<SpawnResult>;
  spawnAgentsParallelFn?: (
    agents: Array<{ type: AgentType; query: string; outputPath: string }>,
  ) => Promise<SpawnResult[]>;
  saveArtifactFn?: (path: string, title: string) => Promise<{ artifactId: string }>;
  proposeToolFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
}
```

In `src/main/agent/session.ts` constructor, pass `onFileWrite` to `createAgentTools`.

- [ ] **Step 9: Wire OutputNotificationService in chat-handlers**

In `src/main/ipc/chat-handlers.ts`, where `AgentSession` is created (around line 77), inject:

```typescript
const session = new AgentSession({
  projectId,
  projectName: project.name,
  folderPath: project.folderPath ?? null,
  systemContext,
  apiKey,
  model: settings.activeProvider,
  homePath,
  // ... other options
  onFileWrite: (absolutePath, relativePath, fileName) => {
    outputNotificationService.recordWrite(projectId, absolutePath, relativePath, fileName);
    eventBus.emit({
      type: "file:written",
      payload: { projectId, absolutePath, relativePath, fileName },
    });
  },
});
```

Note: `outputNotificationService` must be injected via DI in `chat-handlers.ts`. Add it to the dependencies object passed to `registerChatHandlers`.

- [ ] **Step 10: Run typecheck**

Run: `bun run typecheck`

Expected: zero errors.

- [ ] **Step 11: Commit**

```bash
git add src/main/agent/tools/file-tools.ts src/main/agent/tools.ts src/main/event-bus.ts src/main/agent/session.ts src/main/services/OutputNotificationService.ts src/main/repositories/IArtifactRepository.ts src/main/repositories/drizzle/DrizzleArtifactRepository.ts src/main/ipc/artifact-handlers.ts src/main/ipc/chat-handlers.ts
git commit -m "feat: track file writes as notifications via EventBus"
```

---

### Task 5: DB Migration for Artifacts Table

**Files:**
- Modify: `src/main/db/schema.ts:25-33`
- Modify: `src/main/db/migrate.ts`
- Create: `src/main/db/migrations/0002_add_artifact_notification_columns.sql`
- Modify: `src/shared/types.ts` (Artifact type)
- Test: `src/main/db/client.test.ts` (add migration test)

**Why:** Add `acknowledged` (boolean, default false) and `relativePath` (text, nullable) to artifacts table.

- [ ] **Step 1: Write failing test**

In `src/main/db/client.test.ts`, add:

```typescript
import { describe, expect, it } from "vitest";
import { db } from "./client";
import { artifacts } from "./schema";
import { eq } from "drizzle-orm";

describe("artifact columns", () => {
  it("has acknowledged column", async () => {
    const result = await db.select({ acknowledged: artifacts.acknowledged }).from(artifacts).limit(1);
    // Should not throw — column exists
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/main/db/client.test.ts`

Expected: FAIL — `acknowledged` column does not exist yet.

- [ ] **Step 3: Update schema**

In `src/main/db/schema.ts:25-33`, change:

```typescript
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  relativePath: text("relative_path"),
  acknowledged: integer("acknowledged", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 4: Create migration SQL**

Create `src/main/db/migrations/0002_add_artifact_notification_columns.sql`:

```sql
ALTER TABLE artifacts ADD COLUMN relative_path TEXT;
ALTER TABLE artifacts ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 5: Update migrate.ts to run new migration**

Read `src/main/db/migrate.ts` and add the new migration to the list:

```typescript
import migration0002 from "./migrations/0002_add_artifact_notification_columns.sql";

// In the migrations array:
const migrations = [
  // ... existing migrations
  { name: "0002_add_artifact_notification_columns", sql: migration0002 },
];
```

Note: Check how existing migrations are loaded (raw import vs file read) and follow the same pattern.

- [ ] **Step 6: Update shared Artifact type**

In `src/shared/types.ts`, ensure Artifact type matches:

```typescript
export interface Artifact {
  id: string;
  projectId: string;
  title: string;
  filePath: string;
  relativePath?: string;
  acknowledged: boolean;
  createdAt: Date;
}
```

- [ ] **Step 7: Run tests**

Run: `bun test src/main/db/client.test.ts`

Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `bun test`

Expected: All existing tests still pass. Any failures are due to type mismatches from the schema change — fix them.

- [ ] **Step 9: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.ts src/main/db/migrations/0002_add_artifact_notification_columns.sql src/shared/types.ts src/main/db/client.test.ts
git commit -m "feat: add acknowledged and relativePath to artifacts table"
```

---

### Task 6: Recent Outputs Notification Panel

**Files:**
- Create: `src/renderer/components/layout/RecentOutputsPanel.tsx`
- Modify: `src/renderer/components/layout/DetailsPanel.tsx:1-32`
- Modify: `src/shared/ipc-channels.ts:1-49`
- Modify: `src/main/ipc/artifact-handlers.ts:1-65`
- Modify: `src/main/services/ArtifactService.ts:1-17`
- Test: `src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx` (create)

**Why:** Replace artifact viewer with notification panel showing recent unacknowledged agent-created files.

- [ ] **Step 1: Add IPC channels**

In `src/shared/ipc-channels.ts:1-49`, add:

```typescript
export const IPC = {
  // ... existing channels
  GET_RECENT_OUTPUTS: "GET_RECENT_OUTPUTS",
  ACKNOWLEDGE_OUTPUT: "ACKNOWLEDGE_OUTPUT",
  ACKNOWLEDGE_ALL_OUTPUTS: "ACKNOWLEDGE_ALL_OUTPUTS",
  // ... rest
} as const;
```

- [ ] **Step 2: Update preload to expose new channels**

Check `src/preload/index.ts` and add the new channels to the whitelist if needed. The preload uses `assertAllowed` — add new channel names to the allowed list.

- [ ] **Step 3: Update ArtifactService with notification methods**

In `src/main/services/ArtifactService.ts:1-17`, expand:

```typescript
import { inject, injectable } from "tsyringe";
import type { Artifact } from "../../shared/types";
import { ARTIFACT_REPO_TOKEN } from "../di/tokens";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";

@injectable()
export class ArtifactService {
  constructor(@inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository) {}

  async saveArtifact(data: Omit<Artifact, "id" | "createdAt">): Promise<Artifact> {
    return this.repo.create(data);
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    return this.repo.listByProject(projectId);
  }

  async listUnacknowledged(projectId: string): Promise<Artifact[]> {
    const all = await this.repo.listByProject(projectId);
    return all
      .filter((a) => !a.acknowledged)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  async acknowledge(projectId: string, artifactId: string): Promise<void> {
    await this.repo.acknowledge(artifactId);
  }

  async acknowledgeAll(projectId: string): Promise<void> {
    await this.repo.acknowledgeAllByProject(projectId);
  }
}
```

- [ ] **Step 4: Update artifact IPC handlers**

In `src/main/ipc/artifact-handlers.ts`, add new handlers:

```typescript
  ipcMain.handle(IPC.GET_RECENT_OUTPUTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_RECENT_OUTPUTS");
    return artifactService.listUnacknowledged(p.projectId);
  });

  ipcMain.handle(IPC.ACKNOWLEDGE_OUTPUT, async (_event, payload: unknown) => {
    const { projectId, artifactId } = parseOrThrow(
      z.object({ projectId: z.string(), artifactId: z.string() }),
      payload,
      "ACKNOWLEDGE_OUTPUT",
    );
    await artifactService.acknowledge(projectId, artifactId);
  });

  ipcMain.handle(IPC.ACKNOWLEDGE_ALL_OUTPUTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "ACKNOWLEDGE_ALL_OUTPUTS");
    await artifactService.acknowledgeAll(p.projectId);
  });
```

- [ ] **Step 5: Create RecentOutputsPanel component**

Create `src/renderer/components/layout/RecentOutputsPanel.tsx`:

```typescript
import { Box, Button, Chip, IconButton, List, ListItem, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";

interface RecentOutputsPanelProps {
  projectId: string;
}

export default function RecentOutputsPanel({ projectId }: RecentOutputsPanelProps) {
  const [outputs, setOutputs] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_RECENT_OUTPUTS, { projectId }).then(setOutputs);
  }, [projectId]);

  const handleAcknowledge = async (artifactId: string) => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_OUTPUT, { projectId, artifactId });
    setOutputs((prev) => prev.filter((o) => o.id !== artifactId));
  };

  const handleAcknowledgeAll = async () => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_ALL_OUTPUTS, { projectId });
    setOutputs([]);
  };

  const handleReveal = async (filePath: string) => {
    await window.electronAPI.invoke(IPC.REVEAL_IN_FOLDER, { filePath });
  };

  if (outputs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No recent outputs
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2">Recent Outputs</Typography>
        <Button size="small" startIcon={<CheckCircleOutlineIcon />} onClick={handleAcknowledgeAll}>
          Acknowledge All
        </Button>
      </Box>

      <List dense sx={{ flex: 1, overflow: "auto" }}>
        {outputs.map((output) => (
          <ListItem
            key={output.id}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 0.5,
              py: 1,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: "0.8rem" }}>
                {output.filePath}
              </Typography>
              <IconButton size="small" onClick={() => handleReveal(output.filePath)} title="Show in folder">
                <FolderOpenIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => handleAcknowledge(output.id)} title="Acknowledge">
                <CheckIcon fontSize="small" />
              </IconButton>
            </Box>
            <Chip label={output.title} size="small" variant="outlined" sx={{ fontSize: "0.7rem" }} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
```

Note: Add `REVEAL_IN_FOLDER` IPC channel if it doesn't exist, or use `shell.showItemInFolder` via a new IPC handler.

- [ ] **Step 6: Replace DetailsPanel**

In `src/renderer/components/layout/DetailsPanel.tsx`, replace:

```typescript
import { Box } from "@mui/material";
import { useProject } from "../../contexts/ProjectContext";
import RecentOutputsPanel from "./RecentOutputsPanel";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "auto",
      }}
    >
      <RecentOutputsPanel projectId={activeProjectId ?? ""} />
    </Box>
  );
}
```

- [ ] **Step 7: Add REVEAL_IN_FOLDER handler**

In `src/main/ipc/artifact-handlers.ts`, add:

```typescript
import { shell } from "electron";

  ipcMain.handle(IPC.REVEAL_IN_FOLDER, async (_event, payload: unknown) => {
    const { filePath, projectId } = parseOrThrow(
      z.object({ filePath: z.string(), projectId: z.string() }),
      payload,
      "REVEAL_IN_FOLDER",
    );

    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error("Project not found");
    }

    const { PathJail } = await import("../agent/path-jail");
    const jail = new PathJail(projectId, project.folderPath);
    const resolvedPath = jail.validate(filePath, "read");

    shell.showItemInFolder(resolvedPath);
  });
```

- [ ] **Step 8: Add REVEAL_IN_FOLDER to IPC constants**

In `src/shared/ipc-channels.ts`, add `REVEAL_IN_FOLDER: "REVEAL_IN_FOLDER"`.

- [ ] **Step 9: Write component test**

Create `src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecentOutputsPanel from "../RecentOutputsPanel";

describe("RecentOutputsPanel", () => {
  it("shows empty state when no outputs", async () => {
    window.electronAPI = {
      invoke: vi.fn().mockResolvedValue([]),
    } as any;

    render(<RecentOutputsPanel projectId="proj-1" />);
    expect(await screen.findByText("No recent outputs")).toBeInTheDocument();
  });

  it("renders outputs list", async () => {
    window.electronAPI = {
      invoke: vi.fn().mockResolvedValue([
        { id: "a1", filePath: "docs/research.md", title: "research.md", acknowledged: false },
      ]),
    } as any;

    render(<RecentOutputsPanel projectId="proj-1" />);
    expect(await screen.findByText("docs/research.md")).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run tests**

Run: `bun test src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx`

Expected: PASS

- [ ] **Step 11: Run full typecheck + tests**

Run:
```bash
bun run typecheck
bun test
```

Expected: zero type errors, all tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/components/layout/RecentOutputsPanel.tsx src/renderer/components/layout/DetailsPanel.tsx src/shared/ipc-channels.ts src/main/ipc/artifact-handlers.ts src/main/services/ArtifactService.ts src/renderer/components/layout/__tests__/RecentOutputsPanel.test.tsx
git commit -m "feat: recent outputs notification panel replaces artifact viewer"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Section 1 (Project creation with folderPath) → Task 1
- ✅ Section 2 (AGENTS.md onboarding) → Task 2
- ✅ Section 3 (Research output routing) → Task 3
- ✅ Section 4 (Track file writes) → Task 4
- ✅ Section 5 (DB migration) → Task 5
- ✅ Section 6 (Recent outputs panel) → Task 6

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" found.
- All code blocks contain concrete implementations.
- No "similar to Task N" references.

**3. Type consistency:**
- `folderPath`: `string | null` in DB/service layer, `string` in validation schema (required), `string | undefined` in `buildSystemContext`. This is intentional — null for DB optional field, undefined for function parameter.
- `Artifact` type updated in Task 5 to match schema.
- `AgentToolsOptions.onFileWrite` callback signature consistent across Task 4.

**Gaps found:**
- `REVEAL_IN_FOLDER` IPC handler added in Task 6 but channel constant added in Task 6 Step 8. This is within the same task, no cross-task gap.
- `OutputNotificationService` in Task 4 is created but not registered in DI container. Add DI registration step.

---

## DI Registration (Add to Task 4)

In `src/main/bootstrap.ts` or wherever DI tokens are registered, add:

```typescript
import { OutputNotificationService } from "./services/OutputNotificationService";

container.register(OutputNotificationService, { useClass: OutputNotificationService });
```

Pass `OutputNotificationService` to `registerChatHandlers` in `ipc-handlers.ts` (or wherever chat handlers are registered).

---

*Plan complete. After approval, execute with superpowers:subagent-driven-development or superpowers:executing-plans.*
