# Project Approval Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project approval level that either preserves current approval prompts or auto-approves them live inside the existing project session.

**Architecture:** Persist `approvalLevel` on each project record, expose it through the shared `Project` contract, and add a main-process `ApprovalPolicyService` that approval gates consult at runtime. Project approval changes flow through a dedicated IPC handler, update the live policy cache without deleting the project session, and emit a renderer event that clears any already-visible pending approval UI for that project.

**Tech Stack:** Electron IPC, TypeScript, React, tsyringe, Drizzle SQLite, Vitest, Testing Library, Bun

---

## File Map

- Modify: `src/shared/types/project.ts`
  Add `ApprovalLevel` and `approvalLevel` to the shared `Project` type.
- Modify: `src/main/db/schema.ts`
  Add the `approval_level` column to the `projects` table schema.
- Modify: `src/main/db/migrate.ts`
  Add the idempotent migration for `approval_level`.
- Modify: `src/main/repositories/IProjectRepository.ts`
  Extend create/update methods with approval-level support.
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`
  Persist and hydrate `approvalLevel`.
- Modify: `src/main/services/ProjectService.ts`
  Add project-level update method for approval level.
- Create: `src/main/services/ApprovalPolicyService.ts`
  Own the cached live policy lookup and update logic.
- Create: `src/main/services/__tests__/ApprovalPolicyService.test.ts`
  Unit tests for cache behavior and project-level updates.
- Modify: `src/main/services/__tests__/ProjectService.test.ts`
  Assert new projects default to `default` and updates delegate correctly.
- Modify: `src/main/di/tokens.ts`
  Add an injection token for approval policy if needed.
- Modify: `src/main/bootstrap.ts`
  Register `ApprovalPolicyService`.
- Modify: `src/shared/ipc-channels.ts`
  Add `SET_PROJECT_APPROVAL_LEVEL` and `APPROVALS_AUTO_RESOLVED`.
- Modify: `src/shared/ipc-types.ts`
  Add request payload and push payload typing.
- Modify: `src/main/ipc-validation.ts`
  Add zod schema for setting approval level.
- Modify: `src/main/ipc/project-handlers.ts`
  Add the new project-setting IPC handler without deleting the session.
- Modify: `src/main/ipc/register.ts`
  Pass `ApprovalPolicyService` into handlers that need it.
- Modify: `src/main/ipc/command-handlers.ts`
  Add helpers to enumerate and auto-resolve pending path approvals.
- Modify: `src/main/event-bus.ts`
  Add event type for renderer-side auto-clear notification.
- Modify: `src/main/ipc/event-forwarders.ts`
  Emit the new push event.
- Modify: `src/main/agent/extensions/safe-bash.ts`
  Add pending-query helpers and bypass-aware resolution entrypoint.
- Modify: `src/main/agent/extensions/execute-code-approval.ts`
  Add pending-query helpers for project-scoped auto-resolution.
- Modify: `src/main/agent/extensions/path-approval.ts`
  Add pending-query helpers if `command-handlers` needs direct enumeration of gates.
- Modify: `src/main/agent/tools/file-tools.ts`
  Bypass path approval gates live through `ApprovalPolicyService`.
- Modify: `src/main/agent/tools/execute-code-tool.ts`
  Bypass execute-code approval live through `ApprovalPolicyService`.
- Modify: `src/main/agent/tools.ts`
  Thread `ApprovalPolicyService` through tool creation options.
- Modify: `src/main/agent/MessagePipeline.ts`
  Pass `ApprovalPolicyService` into `createAgentTools`.
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`
  Pass `approvalLevel` into `MessageInput`.
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`
  Render and persist the new selector beside the model selector.
- Modify: `src/renderer/components/layout/chat/PendingCommandBanner.tsx`
  Clear matching pending items on `APPROVALS_AUTO_RESOLVED`.
- Modify: `src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx`
  Clear matching pending items on `APPROVALS_AUTO_RESOLVED`.
- Modify: `src/renderer/components/layout/chat/PendingPathBanner.tsx`
  Clear matching pending items on `APPROVALS_AUTO_RESOLVED`.
- Create: `src/main/ipc/__tests__/project-handlers.test.ts`
  Cover `SET_PROJECT_APPROVAL_LEVEL`.
- Modify: `src/main/agent/extensions/safe-bash.test.ts`
  Cover bypassed blocked commands and helper enumeration.
- Modify: `src/main/agent/tools/__tests__/execute-code-tool.test.ts`
  Cover bypassed execute-code approvals.
- Modify: `src/main/services/__tests__/AllowlistService.test.ts`
  Reuse existing helpers if needed for auto-approved path writes.
- Create: `src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx`
  Cover selector rendering and invoke payload.
- Create: `src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx`
  Cover banner clearing across the three pending-banner components.

### Task 1: Persist Approval Level and Add the Live Policy Service

**Files:**
- Create: `src/main/services/ApprovalPolicyService.ts`
- Create: `src/main/services/__tests__/ApprovalPolicyService.test.ts`
- Modify: `src/shared/types/project.ts`
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrate.ts`
- Modify: `src/main/repositories/IProjectRepository.ts`
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`
- Modify: `src/main/services/ProjectService.ts`
- Modify: `src/main/services/__tests__/ProjectService.test.ts`
- Modify: `src/main/bootstrap.ts`

- [ ] **Step 1: Write the failing service and project-service tests**

```ts
// src/main/services/__tests__/ApprovalPolicyService.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IProjectRepository } from "../../repositories/IProjectRepository";
import { ApprovalPolicyService } from "../ApprovalPolicyService";

function makeRepo() {
  return {
    get: vi.fn(),
    setApprovalLevel: vi.fn().mockResolvedValue(undefined),
  } as Pick<IProjectRepository, "get" | "setApprovalLevel">;
}

describe("ApprovalPolicyService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: ApprovalPolicyService;

  beforeEach(() => {
    repo = makeRepo();
    service = new ApprovalPolicyService(repo as never);
  });

  it("reads default approval level from the project record", async () => {
    repo.get.mockResolvedValue({ id: "p1", approvalLevel: "default" });

    await expect(service.getLevel("p1")).resolves.toBe("default");
    await expect(service.shouldBypass("p1")).resolves.toBe(false);
  });

  it("updates cache immediately on setLevel", async () => {
    repo.get.mockResolvedValue({ id: "p1", approvalLevel: "default" });

    await service.setLevel("p1", "bypass_approvals");

    await expect(service.shouldBypass("p1")).resolves.toBe(true);
    expect(repo.setApprovalLevel).toHaveBeenCalledWith("p1", "bypass_approvals");
  });
});

// add to src/main/services/__tests__/ProjectService.test.ts
it("creates projects with default approval level", async () => {
  await service.createProject("New");

  expect(repo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      approvalLevel: "default",
    }),
  );
});

it("updates approval level through the repository", async () => {
  vi.mocked(repo.get).mockResolvedValue(makeProject());

  await service.setApprovalLevel("proj-1", "bypass_approvals");

  expect(repo.setApprovalLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `bun run test src/main/services/__tests__/ProjectService.test.ts src/main/services/__tests__/ApprovalPolicyService.test.ts`

Expected: FAIL with missing `approvalLevel`, missing `setApprovalLevel`, and missing `ApprovalPolicyService`.

- [ ] **Step 3: Add the shared type, schema, repository contract, and service**

```ts
// src/shared/types/project.ts
export type ApprovalLevel = "default" | "bypass_approvals";

export type Project = {
  id: string;
  name: string;
  slug: string | null;
  folderPath: string | null;
  projectPath: string | null;
  modelOverride: string | null;
  approvalLevel: ApprovalLevel;
  maxRecentMessages: number;
  createdAt: Date;
  updatedAt: Date;
};
```

```ts
// src/main/repositories/IProjectRepository.ts
export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages" | "modelOverride" | "approvalLevel"
> & {
  maxRecentMessages?: number;
  modelOverride?: string | null;
  approvalLevel?: ApprovalLevel;
};

export interface IProjectRepository {
  // existing methods ...
  setApprovalLevel(id: string, approvalLevel: ApprovalLevel): Promise<void>;
}
```

```ts
// src/main/services/ApprovalPolicyService.ts
import { inject, injectable } from "tsyringe";
import type { ApprovalLevel } from "../../shared/types";
import { PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { NotFoundError } from "./errors";

@injectable()
export class ApprovalPolicyService {
  private readonly cache = new Map<string, ApprovalLevel>();

  constructor(@inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository) {}

  async getLevel(projectId: string): Promise<ApprovalLevel> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    const project = await this.repo.get(projectId);
    if (!project) throw new NotFoundError("Project", projectId);
    const level = project.approvalLevel ?? "default";
    this.cache.set(projectId, level);
    return level;
  }

  async shouldBypass(projectId: string): Promise<boolean> {
    return (await this.getLevel(projectId)) === "bypass_approvals";
  }

  async setLevel(projectId: string, level: ApprovalLevel): Promise<void> {
    await this.repo.setApprovalLevel(projectId, level);
    this.cache.set(projectId, level);
  }
}
```

- [ ] **Step 4: Register the service and finish the persistence plumbing**

```ts
// src/main/db/schema.ts
approvalLevel: text("approval_level").notNull().default("default"),
```

```ts
// src/main/db/migrate.ts
try {
  await db.run(
    sql`ALTER TABLE projects ADD COLUMN approval_level TEXT NOT NULL DEFAULT 'default'`,
  );
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
```

```ts
// src/main/services/ProjectService.ts
async setApprovalLevel(id: string, approvalLevel: ApprovalLevel): Promise<void> {
  await this.getProject(id);
  await this.repo.setApprovalLevel(id, approvalLevel);
}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `bun run test src/main/services/__tests__/ProjectService.test.ts src/main/services/__tests__/ApprovalPolicyService.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/project.ts src/main/db/schema.ts src/main/db/migrate.ts src/main/repositories/IProjectRepository.ts src/main/repositories/drizzle/DrizzleProjectRepository.ts src/main/services/ProjectService.ts src/main/services/ApprovalPolicyService.ts src/main/services/__tests__/ProjectService.test.ts src/main/services/__tests__/ApprovalPolicyService.test.ts src/main/bootstrap.ts
git commit -m "feat: persist project approval levels"
```

### Task 2: Add IPC Contracts and Project-Level Update Flow

**Files:**
- Create: `src/main/ipc/__tests__/project-handlers.test.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/main/ipc-validation.ts`
- Modify: `src/main/ipc/project-handlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/event-bus.ts`
- Modify: `src/main/ipc/event-forwarders.ts`

- [ ] **Step 1: Write the failing IPC handler test**

```ts
// src/main/ipc/__tests__/project-handlers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcHandles = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandles.set(channel, handler);
    }),
  },
  dialog: { showOpenDialog: vi.fn() },
}));

import { registerProjectHandlers } from "../project-handlers";

describe("SET_PROJECT_APPROVAL_LEVEL", () => {
  const win = {} as Electron.BrowserWindow;
  const projectService = {
    setApprovalLevel: vi.fn().mockResolvedValue(undefined),
  };
  const sessionManager = {
    delete: vi.fn(),
  };
  const approvalPolicyService = {
    setLevel: vi.fn().mockResolvedValue(undefined),
  };
  const approvalResolver = {
    resolveAllForProject: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    ipcHandles.clear();
    registerProjectHandlers(win, {
      projectService: projectService as never,
      sessionManager: sessionManager as never,
      approvalPolicyService: approvalPolicyService as never,
      approvalResolver: approvalResolver as never,
    });
  });

  it("updates approval level without deleting the session", async () => {
    const handler = ipcHandles.get("SET_PROJECT_APPROVAL_LEVEL");
    await handler?.({}, { projectId: "proj-1", approvalLevel: "bypass_approvals" });

    expect(projectService.setApprovalLevel).toHaveBeenCalledWith("proj-1", "bypass_approvals");
    expect(sessionManager.delete).not.toHaveBeenCalled();
    expect(approvalResolver.resolveAllForProject).toHaveBeenCalledWith("proj-1");
  });
});
```

- [ ] **Step 2: Run the focused IPC test and verify it fails**

Run: `bun run test src/main/ipc/__tests__/project-handlers.test.ts`

Expected: FAIL because `SET_PROJECT_APPROVAL_LEVEL` and the new dependencies do not exist yet.

- [ ] **Step 3: Add the shared IPC request/push contracts and validation**

```ts
// src/shared/ipc-channels.ts
SET_PROJECT_APPROVAL_LEVEL: "SET_PROJECT_APPROVAL_LEVEL",
APPROVALS_AUTO_RESOLVED: "APPROVALS_AUTO_RESOLVED",
```

```ts
// src/shared/ipc-types.ts
export interface IpcRequestMap {
  // existing fields ...
  SET_PROJECT_APPROVAL_LEVEL: {
    projectId: string;
    approvalLevel: "default" | "bypass_approvals";
  };
}

export type IpcPushEvent =
  // existing variants ...
  | { type: "APPROVALS_AUTO_RESOLVED"; projectId: string };
```

```ts
// src/main/ipc-validation.ts
export const SetProjectApprovalLevelSchema = z.object({
  projectId: z.string(),
  approvalLevel: z.enum(["default", "bypass_approvals"]),
});
```

- [ ] **Step 4: Implement the project handler and event forwarding**

```ts
// src/main/ipc/project-handlers.ts
ipcMain.handle(IPC.SET_PROJECT_APPROVAL_LEVEL, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { projectId, approvalLevel } = parseOrThrow(
      SetProjectApprovalLevelSchema,
      payload,
      "SET_PROJECT_APPROVAL_LEVEL",
    );

    await projectService.setApprovalLevel(projectId, approvalLevel);
    await approvalPolicyService.setLevel(projectId, approvalLevel);

    if (approvalLevel === "bypass_approvals") {
      await approvalResolver.resolveAllForProject(projectId);
      eventBus.emit({ type: "approvals:auto_resolved", payload: { projectId } });
    }
  }),
);
```

```ts
// src/main/event-bus.ts
| { type: "approvals:auto_resolved"; payload: { projectId: string } }
```

```ts
// src/main/ipc/event-forwarders.ts
eventBus.on("approvals:auto_resolved", (payload) => {
  emitPush(win, { type: "APPROVALS_AUTO_RESOLVED", projectId: payload.projectId });
});
```

- [ ] **Step 5: Run the focused IPC test and verify it passes**

Run: `bun run test src/main/ipc/__tests__/project-handlers.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/shared/ipc-types.ts src/main/ipc-validation.ts src/main/ipc/project-handlers.ts src/main/ipc/register.ts src/main/event-bus.ts src/main/ipc/event-forwarders.ts src/main/ipc/__tests__/project-handlers.test.ts
git commit -m "feat: add project approval level ipc"
```

### Task 3: Make Approval Gates Consult the Live Policy and Auto-Resolve Pending Items

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/extensions/safe-bash.ts`
- Modify: `src/main/agent/extensions/execute-code-approval.ts`
- Modify: `src/main/agent/extensions/path-approval.ts`
- Modify: `src/main/agent/tools/file-tools.ts`
- Modify: `src/main/agent/tools/execute-code-tool.ts`
- Modify: `src/main/ipc/command-handlers.ts`
- Modify: `src/main/agent/extensions/safe-bash.test.ts`
- Modify: `src/main/agent/tools/__tests__/execute-code-tool.test.ts`

- [ ] **Step 1: Write the failing approval-gate tests**

```ts
// add to src/main/agent/extensions/safe-bash.test.ts
it("executes immediately when project approval level bypasses blocked commands", async () => {
  const emitBlocked = vi.fn();

  const result = await runSafeBash({
    projectId: "p1",
    command: "curl https://example.com",
    intent: "Fetch docs",
    cwd: process.cwd(),
    auditLogPath: "/tmp/audit.log",
    emitBlocked,
    shouldBypassApproval: async () => true,
  });

  expect(emitBlocked).not.toHaveBeenCalled();
  expect(result.exitCode).toBeTypeOf("number");
});
```

```ts
// add to src/main/agent/tools/__tests__/execute-code-tool.test.ts
it("skips execute_code approval when bypass mode is enabled", async () => {
  const tool = createExecuteCodeTool({
    projectId: "p1",
    shouldBypassApproval: async () => true,
    emitApprovalRequired: vi.fn(),
    // keep existing dependencies from the test helper
  });

  await tool.execute({
    language: "python",
    code: "print('hello')",
  });

  expect(emitApprovalRequired).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused backend tests and verify they fail**

Run: `bun run test src/main/agent/extensions/safe-bash.test.ts src/main/agent/tools/__tests__/execute-code-tool.test.ts`

Expected: FAIL with missing `shouldBypassApproval` support and missing pending-resolution helpers.

- [ ] **Step 3: Thread the live approval-policy callback into tool creation**

```ts
// src/main/agent/tools.ts
export interface CreateAgentToolsOptions {
  // existing fields ...
  approvalPolicyService: ApprovalPolicyService;
}

// when building tools
shouldBypassApproval: () => options.approvalPolicyService.shouldBypass(options.projectId),
```

```ts
// src/main/agent/MessagePipeline.ts
approvalPolicyService: options.approvalPolicyService,
```

- [ ] **Step 4: Implement bypass logic and pending-resolution helpers**

```ts
// src/main/agent/extensions/safe-bash.ts
export interface SafeBashOptions {
  // existing fields ...
  shouldBypassApproval?: () => Promise<boolean>;
}

export function getPendingBlockedCommandsForProject(projectId: string): string[] {
  return Array.from(blockedPromises.values())
    .filter((entry) => entry.options.projectId === projectId)
    .map((entry) => entry.commandId);
}

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  // existing inline/file checks...
  const entry = checkCommand(opts.command);
  if (!entry) return runSafeBashInternal(opts);
  if (getProjectAllowlist(opts.projectId).has(hashCommand(opts.command))) {
    return runSafeBashInternal(opts);
  }
  if (opts.shouldBypassApproval && (await opts.shouldBypassApproval())) {
    return runSafeBashInternal(opts);
  }
  if (opts.emitBlocked) return enterApprovalGate(opts, entry);
  throw new BlockedCommandError(`Blocked: ${entry.reason}`, undefined, entry.category);
}
```

```ts
// src/main/agent/extensions/execute-code-approval.ts
export function getPendingExecuteCodeApprovalsForProject(projectId: string): string[] {
  return Array.from(pendingApprovals.values())
    .filter((entry) => entry.payload.projectId === projectId)
    .map((entry) => entry.payload.executionId);
}
```

```ts
// src/main/ipc/command-handlers.ts
export async function resolveAllPendingApprovalsForProject(
  projectId: string,
  allowlistService: AllowlistService,
): Promise<void> {
  for (const commandId of getPendingBlockedCommandsForProject(projectId)) {
    resolveBlockedCommand(commandId, "approve_once", projectId);
  }
  for (const executionId of getPendingExecuteCodeApprovalsForProject(projectId)) {
    resolveExecuteCodeApproval(executionId, "approve_once");
  }
  for (const payload of getPendingPathApprovalsForProject(projectId)) {
    allowlistService.approveSession(projectId, payload.path);
    resolvePathApprovalGate(projectId, payload.path, payload.mode, true);
  }
}
```

- [ ] **Step 5: Add path-tool bypass behavior**

```ts
// src/main/agent/tools/file-tools.ts
try {
  jail.validate(path, "write");
} catch (err) {
  if (err instanceof ApprovalRequiredError && (await shouldBypassApproval())) {
    allowlistService.approveSession(jail.projectId, err.path);
    jail.validate(path, "write");
  } else {
    throw err;
  }
}
```

```ts
// src/main/agent/tools/execute-code-tool.ts
if (options.shouldBypassApproval && (await options.shouldBypassApproval())) {
  // continue directly without enterExecuteCodeApprovalGate
} else {
  const approval = await enterExecuteCodeApprovalGate(...);
}
```

- [ ] **Step 6: Run the focused backend tests and verify they pass**

Run: `bun run test src/main/agent/extensions/safe-bash.test.ts src/main/agent/tools/__tests__/execute-code-tool.test.ts src/main/services/__tests__/AllowlistService.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/MessagePipeline.ts src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/execute-code-approval.ts src/main/agent/extensions/path-approval.ts src/main/agent/tools/file-tools.ts src/main/agent/tools/execute-code-tool.ts src/main/ipc/command-handlers.ts src/main/agent/extensions/safe-bash.test.ts src/main/agent/tools/__tests__/execute-code-tool.test.ts
git commit -m "feat: bypass approval gates live per project"
```

### Task 4: Add the Selector in `MessageInput` and Clear Pending Approval UI

**Files:**
- Create: `src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx`
- Create: `src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`
- Modify: `src/renderer/components/layout/chat/PendingCommandBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingPathBanner.tsx`

- [ ] **Step 1: Write the failing renderer tests**

```tsx
// src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageInput from "../MessageInput";

describe("MessageInput", () => {
  it("renders the approval-level selector and sends the update payload", async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === "GET_SETTINGS") {
        return Promise.resolve({
          activeProvider: "openrouter",
          providerCredentials: {
            openrouter: { apiKey: "sk", defaultModel: "anthropic/claude-sonnet-4-6" },
            openai: { apiKey: null, defaultModel: "gpt-4o" },
            anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
            ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
          },
        });
      }
      if (channel === "GET_PROVIDER_MODELS") {
        return Promise.resolve({ models: [{ id: "anthropic/claude-sonnet-4-6", name: "Claude" }] });
      }
      return Promise.resolve(undefined);
    });

    window.electronAPI = { invoke, send: vi.fn(), on: vi.fn().mockReturnValue(() => {}) } as never;

    render(
      <MessageInput
        onSend={vi.fn()}
        projectId="proj-1"
        projectModelOverride="openrouter:anthropic/claude-sonnet-4-6"
        projectApprovalLevel="default"
      />,
    );

    fireEvent.mouseDown(screen.getByLabelText("Approval level"));
    fireEvent.click(await screen.findByText("Bypass approvals"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SET_PROJECT_APPROVAL_LEVEL", {
        projectId: "proj-1",
        approvalLevel: "bypass_approvals",
      }),
    );
  });
});
```

```tsx
// src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PendingCommandBanner from "../PendingCommandBanner";

describe("pending approval banners", () => {
  it("remove project-matching items on APPROVALS_AUTO_RESOLVED", async () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    window.electronAPI = {
      invoke: vi.fn(),
      send: vi.fn(),
      on: vi.fn((channel: string, cb: (payload: unknown) => void) => {
        listeners.set(channel, cb);
        return () => listeners.delete(channel);
      }),
    } as never;

    render(<PendingCommandBanner />);

    act(() => {
      listeners.get("BASH_BLOCKED")?.({
        type: "BASH_BLOCKED",
        commandId: "cmd-1",
        command: "curl https://example.com",
        reason: "Network outbound",
        category: "exfiltration",
        key: "curl",
        projectId: "proj-1",
        intent: "Fetch docs",
        timestamp: new Date().toISOString(),
      });
    });

    expect(await screen.findByText(/Blocked command/)).toBeTruthy();

    act(() => {
      listeners.get("APPROVALS_AUTO_RESOLVED")?.({ type: "APPROVALS_AUTO_RESOLVED", projectId: "proj-1" });
    });

    expect(screen.queryByText(/Blocked command/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused renderer tests and verify they fail**

Run: `bun run test src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx`

Expected: FAIL with missing `projectApprovalLevel`, missing UI text, and missing `APPROVALS_AUTO_RESOLVED` handling.

- [ ] **Step 3: Add the selector to `ChatPanel` and `MessageInput`**

```tsx
// src/renderer/components/layout/chat/ChatPanel.tsx
<MessageInput
  onSend={handleSend}
  onAbort={handleAbort}
  disabled={processing || streamingSegments.length > 0}
  projectId={activeProjectId}
  projectModelOverride={activeProject?.modelOverride ?? null}
  projectApprovalLevel={activeProject?.approvalLevel ?? "default"}
/>
```

```tsx
// src/renderer/components/layout/chat/MessageInput.tsx
interface MessageInputProps {
  onSend: (content: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  projectId: string;
  projectModelOverride: string | null;
  projectApprovalLevel: "default" | "bypass_approvals";
}

const [approvalLevel, setApprovalLevel] = useState(projectApprovalLevel);

async function handleApprovalLevelChange(newLevel: "default" | "bypass_approvals") {
  setApprovalLevel(newLevel);
  await ipc.invoke(IPC.SET_PROJECT_APPROVAL_LEVEL, {
    projectId,
    approvalLevel: newLevel,
  });
}
```

- [ ] **Step 4: Clear pending items on the new push event**

```tsx
// pattern for each pending banner
useEffect(() => {
  return ipc.on(IPC.APPROVALS_AUTO_RESOLVED, (event) => {
    setSelected((current) => (current?.projectId === event.projectId ? null : current));
    items
      .filter((item) => item.projectId === event.projectId)
      .forEach((item) => remove(item));
  });
}, [items, remove]);
```

Add the UI label styles in `MessageInput` so `Bypass approvals` uses `var(--accent)` or the same accent treatment used for active controls, not `var(--danger)`.

- [ ] **Step 5: Run the focused renderer tests and verify they pass**

Run: `bun run test src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/chat/ChatPanel.tsx src/renderer/components/layout/chat/MessageInput.tsx src/renderer/components/layout/chat/PendingCommandBanner.tsx src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx src/renderer/components/layout/chat/PendingPathBanner.tsx src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx
git commit -m "feat: add approval level chat controls"
```

### Task 5: Full Verification and Cleanup

**Files:**
- Modify: any touched files from Tasks 1-4 only if verification exposes real issues

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 2: Run Biome check**

Run: `bun run check`

Expected: PASS with zero lint/format issues.

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`

Expected: PASS

- [ ] **Step 4: Run coverage**

Run: `bun run test:coverage`

Expected: PASS with all thresholds at or above 90%.

- [ ] **Step 5: Make any focused fixes exposed by verification and rerun the failing command**

```ts
// Example of acceptable scope: fix only the file named by the failing test or typecheck error,
// then rerun the exact failed command before moving back to the full suite.
```

- [ ] **Step 6: Final commit**

```bash
git add src/shared/types/project.ts src/main/db/schema.ts src/main/db/migrate.ts src/main/repositories/IProjectRepository.ts src/main/repositories/drizzle/DrizzleProjectRepository.ts src/main/services/ProjectService.ts src/main/services/ApprovalPolicyService.ts src/main/services/__tests__/ApprovalPolicyService.test.ts src/main/services/__tests__/ProjectService.test.ts src/main/agent/tools.ts src/main/agent/MessagePipeline.ts src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/execute-code-approval.ts src/main/agent/extensions/path-approval.ts src/main/agent/tools/file-tools.ts src/main/agent/tools/execute-code-tool.ts src/main/ipc/command-handlers.ts src/main/ipc/project-handlers.ts src/main/ipc/register.ts src/main/ipc-validation.ts src/main/ipc/event-forwarders.ts src/main/event-bus.ts src/shared/ipc-channels.ts src/shared/ipc-types.ts src/renderer/components/layout/chat/ChatPanel.tsx src/renderer/components/layout/chat/MessageInput.tsx src/renderer/components/layout/chat/PendingCommandBanner.tsx src/renderer/components/layout/chat/PendingExecuteCodeBanner.tsx src/renderer/components/layout/chat/PendingPathBanner.tsx src/main/ipc/__tests__/project-handlers.test.ts src/main/agent/extensions/safe-bash.test.ts src/main/agent/tools/__tests__/execute-code-tool.test.ts src/renderer/components/layout/chat/__tests__/MessageInput.test.tsx src/renderer/components/layout/chat/__tests__/PendingApprovalsAutoResolved.test.tsx
git commit -m "feat: add per-project approval levels"
```

## Self-Review

### Spec coverage

- Data model: Task 1
- Live policy service: Task 1
- IPC contracts and project-level switching: Task 2
- Live approval gate checks: Task 3
- Mid-turn auto-resolution: Task 3 plus Task 2 event forwarding
- Renderer selector and banner clearing: Task 4
- Verification requirements: Task 5

No spec gaps remain.

### Placeholder scan

This plan contains no `TBD`, `TODO`, or deferred implementation notes. Every task includes exact files, concrete test names, command lines, and code sketches for the key changes.

### Type consistency

The plan uses `ApprovalLevel`, `approvalLevel`, `SET_PROJECT_APPROVAL_LEVEL`, and `APPROVALS_AUTO_RESOLVED` consistently across persistence, IPC, backend tools, and renderer components.
