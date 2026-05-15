# Skill Update Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents propose updates to existing skills via `propose_skill` with an `update: true` flag, with full-replacement semantics and user approval gating identical to new skill proposals.

**Architecture:** Four sequential tasks. Task 1 adds the service primitives (exists checks + META.json storage + update-aware approval). Task 2 adds `update: boolean` to the shared types and event payloads. Task 3 adds the `update` parameter to the tool and enforces the conflict rules in the handler. Task 4 updates the modal UI to show an "Update" badge. No new tools, no new IPC channels — `propose_skill` is extended in place and the approval flow is unchanged.

**Tech Stack:** Bun, TypeScript strict, Node.js `fs/promises`, Vitest, Biome v2, React 19, `@sinclair/typebox` for tool params, `zod/v4` for IPC guards, Electron IPC.

---

## File Map

**Task 1 — Service layer:**
- Modify: `src/main/services/ToolApprovalService.ts`
- Modify: `src/main/services/__tests__/HomeService.test.ts`

**Task 2 — Shared types + events:**
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/shared/ipc-guards.ts`
- Modify: `src/main/event-bus.ts`
- Modify: `src/main/ipc/event-forwarders.ts`

**Task 3 — Tool + propagation + handler:**
- Modify: `src/main/agent/tools/propose-skill.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/ipc/chat-handlers.ts`

**Task 4 — UI:**
- Modify: `src/renderer/components/layout/chat/PendingToolModal.tsx`

---

## Background: current state

The `propose_skill` tool routes to `ToolApprovalService.savePendingTool` (global) or `saveProjectPendingTool` (project). Each method writes a `SKILL.md` and optional `script.sh/.py` into `~/.scholar/pending-tools/<name>/` or `~/.scholar/projects/<slug>/pending-tools/<name>/`. On user approval, the pending dir is moved to the skills dir via `rename`. Skills dirs are write-protected for agents (path-jail) so the only way to place new content there is via the approval flow.

The `approvePendingTool` / `approveProjectPendingTool` methods currently call `rename(src, dst)` which **fails** if `dst` already exists (POSIX rename replaces only if dst is an empty dir; a non-empty skills dir causes EISDIR/ENOTEMPTY). After this plan, when an update is proposed and approved, the old skill dir is deleted before the rename.

---

## Task 1: ToolApprovalService — exists checks, META.json, update-aware approval

**Files:**
- Modify: `src/main/services/ToolApprovalService.ts`
- Modify: `src/main/services/__tests__/HomeService.test.ts`

**Context:** We need three changes to the service:
1. `skillExists` / `projectSkillExists` — so the handler can enforce the `update` flag contract before saving.
2. `savePendingTool` / `saveProjectPendingTool` gain an `update` parameter, written to a `META.json` file alongside `SKILL.md`.
3. `getPendingTools` / `getProjectPendingTools` read `META.json` and include `update: boolean` in the returned entries (defaulting to `false` for old entries without META.json).
4. `approvePendingTool` / `approveProjectPendingTool` read META.json; if `update: true`, they `rm -rf` the destination before the rename.

The `access` import is not yet in `ToolApprovalService.ts` — add it.

- [ ] **Step 1: Write failing tests**

Add a new `describe("ToolApprovalService — update semantics", ...)` block at the end of `src/main/services/__tests__/HomeService.test.ts`, after the existing project-scoped describe block. The `makeToolApproval`, `tmpHome`, `beforeEach`, `afterEach` helpers are already defined at the top of the file — use them.

```typescript
describe("ToolApprovalService — update semantics", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("skillExists returns false when skill is absent", async () => {
    const svc = makeToolApproval();
    expect(await svc.skillExists("no-such-skill")).toBe(false);
  });

  it("skillExists returns true after approvePendingTool", async () => {
    const svc = makeToolApproval();
    await mkdir(join(tmpHome, ".scholar", "skills"), { recursive: true });
    await svc.savePendingTool("my-skill", "# my-skill");
    await svc.approvePendingTool("my-skill");
    expect(await svc.skillExists("my-skill")).toBe(true);
  });

  it("projectSkillExists returns false when skill is absent", async () => {
    const svc = makeToolApproval();
    expect(await svc.projectSkillExists("proj", "no-such-skill")).toBe(false);
  });

  it("projectSkillExists returns true after approveProjectPendingTool", async () => {
    const svc = makeToolApproval();
    await mkdir(join(tmpHome, ".scholar", "projects", "proj", "skills"), { recursive: true });
    await svc.saveProjectPendingTool("proj", "proj-skill", "# proj-skill");
    await svc.approveProjectPendingTool("proj", "proj-skill");
    expect(await svc.projectSkillExists("proj", "proj-skill")).toBe(true);
  });

  it("getPendingTools includes update: false by default", async () => {
    const svc = makeToolApproval();
    await svc.savePendingTool("tool-a", "# tool-a");
    const tools = await svc.getPendingTools();
    expect(tools[0].update).toBe(false);
  });

  it("getPendingTools includes update: true when saved with update=true", async () => {
    const svc = makeToolApproval();
    await svc.savePendingTool("tool-a", "# tool-a", undefined, true);
    const tools = await svc.getPendingTools();
    expect(tools[0].update).toBe(true);
  });

  it("getPendingTools returns update: false for old entries missing META.json", async () => {
    const svc = makeToolApproval();
    // Write an entry manually without META.json (simulating pre-feature data)
    const dir = join(tmpHome, ".scholar", "pending-tools", "legacy-tool");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "# legacy", "utf-8");
    const tools = await svc.getPendingTools();
    expect(tools[0].update).toBe(false);
  });

  it("approvePendingTool replaces existing skill dir when update=true", async () => {
    const svc = makeToolApproval();
    const skillsDir = join(tmpHome, ".scholar", "skills");
    await mkdir(skillsDir, { recursive: true });
    // Create existing skill with old content
    const existingSkillDir = join(skillsDir, "evolving-skill");
    await mkdir(existingSkillDir, { recursive: true });
    await writeFile(join(existingSkillDir, "SKILL.md"), "# old content", "utf-8");
    await writeFile(join(existingSkillDir, "old-file.txt"), "old", "utf-8");
    // Propose update
    await svc.savePendingTool("evolving-skill", "# new content", undefined, true);
    await svc.approvePendingTool("evolving-skill");
    const content = await readFile(join(skillsDir, "evolving-skill", "SKILL.md"), "utf-8");
    expect(content).toBe("# new content");
    // Old file from previous version should be gone
    await expect(access(join(skillsDir, "evolving-skill", "old-file.txt"))).rejects.toThrow();
  });

  it("getProjectPendingTools includes update field", async () => {
    const svc = makeToolApproval();
    await svc.saveProjectPendingTool("my-proj", "proj-tool", "# proj-tool", undefined, true);
    const tools = await svc.getProjectPendingTools("my-proj");
    expect(tools[0].update).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts 2>&1 | tail -20
```

Expected: FAIL — `skillExists`, `projectSkillExists` don't exist; `savePendingTool` has wrong arity; `getPendingTools` result lacks `update`.

- [ ] **Step 3: Implement the changes in ToolApprovalService.ts**

Replace the entire file content (read it first to preserve imports and structure):

**a) Add `access` to the imports:**
```typescript
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
```

**b) Add `skillExists` and `projectSkillExists` after `assertSafePathComponent`:**
```typescript
async skillExists(name: string): Promise<boolean> {
  this.assertSafePathComponent(name, "name");
  try {
    await access(join(this.skillsDir, name));
    return true;
  } catch {
    return false;
  }
}

async projectSkillExists(slug: string, name: string): Promise<boolean> {
  this.assertSafePathComponent(slug, "slug");
  this.assertSafePathComponent(name, "name");
  try {
    await access(join(this.projectSkillsDir(slug), name));
    return true;
  } catch {
    return false;
  }
}
```

**c) Update `savePendingTool` signature and body:**
```typescript
async savePendingTool(
  name: string,
  skillContent: string,
  script?: string,
  update = false,
): Promise<void> {
  this.assertSafePathComponent(name, "name");
  const dir = join(this.pendingToolsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
  await writeFile(join(dir, "META.json"), JSON.stringify({ update }), "utf-8");
  if (script) {
    const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
    await writeFile(join(dir, `script${ext}`), script, "utf-8");
  }
}
```

**d) Update `getPendingTools` to include `update`:**
```typescript
async getPendingTools(): Promise<Array<{ name: string; skillContent: string; update: boolean }>> {
  const dir = this.pendingToolsDir;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const tools: Array<{ name: string; skillContent: string; update: boolean }> = [];
  for (const name of entries) {
    try {
      const skillContent = await readFile(join(dir, name, "SKILL.md"), "utf-8");
      let update = false;
      try {
        const raw = await readFile(join(dir, name, "META.json"), "utf-8");
        const meta = JSON.parse(raw) as { update?: boolean };
        if (typeof meta.update === "boolean") update = meta.update;
      } catch {
        // Old entry without META.json — default to false
      }
      tools.push({ name, skillContent, update });
    } catch (err) {
      console.error(`[ToolApprovalService] getPendingTools: skipping malformed entry ${name}:`, err);
    }
  }
  return tools;
}
```

**e) Update `approvePendingTool` to handle replacement:**
```typescript
async approvePendingTool(name: string): Promise<void> {
  this.assertSafePathComponent(name, "name");
  const src = join(this.pendingToolsDir, name);
  const dst = join(this.skillsDir, name);
  let update = false;
  try {
    const raw = await readFile(join(src, "META.json"), "utf-8");
    const meta = JSON.parse(raw) as { update?: boolean };
    if (typeof meta.update === "boolean") update = meta.update;
  } catch {
    // No META.json
  }
  if (update) {
    await rm(dst, { recursive: true, force: true });
  }
  await rename(src, dst);
}
```

**f) Update `saveProjectPendingTool` to accept `update`:**
```typescript
async saveProjectPendingTool(
  slug: string,
  name: string,
  skillContent: string,
  script?: string,
  update = false,
): Promise<void> {
  this.assertSafePathComponent(slug, "slug");
  this.assertSafePathComponent(name, "name");
  const dir = join(this.projectPendingToolsDir(slug), name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
  await writeFile(join(dir, "META.json"), JSON.stringify({ update }), "utf-8");
  if (script) {
    const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
    await writeFile(join(dir, `script${ext}`), script, "utf-8");
  }
}
```

**g) Update `getProjectPendingTools` to include `update`:**
```typescript
async getProjectPendingTools(
  slug: string,
): Promise<Array<{ name: string; skillContent: string; update: boolean }>> {
  this.assertSafePathComponent(slug, "slug");
  const dir = this.projectPendingToolsDir(slug);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const tools: Array<{ name: string; skillContent: string; update: boolean }> = [];
  for (const name of entries) {
    try {
      const skillContent = await readFile(join(dir, name, "SKILL.md"), "utf-8");
      let update = false;
      try {
        const raw = await readFile(join(dir, name, "META.json"), "utf-8");
        const meta = JSON.parse(raw) as { update?: boolean };
        if (typeof meta.update === "boolean") update = meta.update;
      } catch {
        // Old entry without META.json
      }
      tools.push({ name, skillContent, update });
    } catch (err) {
      console.error(
        `[ToolApprovalService] getProjectPendingTools: skipping malformed entry ${name}:`,
        err,
      );
    }
  }
  return tools;
}
```

**h) Update `approveProjectPendingTool` to handle replacement:**
```typescript
async approveProjectPendingTool(slug: string, name: string): Promise<void> {
  this.assertSafePathComponent(slug, "slug");
  this.assertSafePathComponent(name, "name");
  const src = join(this.projectPendingToolsDir(slug), name);
  const dst = join(this.projectSkillsDir(slug), name);
  let update = false;
  try {
    const raw = await readFile(join(src, "META.json"), "utf-8");
    const meta = JSON.parse(raw) as { update?: boolean };
    if (typeof meta.update === "boolean") update = meta.update;
  } catch {
    // No META.json
  }
  if (update) {
    await rm(dst, { recursive: true, force: true });
  }
  await rename(src, dst);
}
```

Also add `writeFile` to the test file's imports if not already present — check the existing imports and add only what's missing.

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ToolApprovalService.ts \
        src/main/services/__tests__/HomeService.test.ts
git commit -m "feat(skills): add skillExists checks and update-aware approval in ToolApprovalService"
```

---

## Task 2: Shared types + events — add `update: boolean` to PendingTool

**Files:**
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/shared/ipc-guards.ts`
- Modify: `src/main/event-bus.ts`
- Modify: `src/main/ipc/event-forwarders.ts`

**Context:** `PendingTool` (used by both the push event decoder and the IPC response types) needs a non-optional `update: boolean` field. The `PendingToolSchema` Zod schema (in `ipc-guards.ts`) validates push events and must match. The `tool:pending` event payload (in `event-bus.ts`) and its forwarding code (in `event-forwarders.ts`) must carry the field. There are no new IPC channels — only the payloads change.

No new tests are needed for this task; the type changes are validated by typecheck.

- [ ] **Step 1: Update `PendingTool` in ipc-types.ts**

Find the `PendingTool` interface (currently around line 154) and add `update: boolean`:

```typescript
export interface PendingTool {
  name: string;
  skillContent: string;
  scope: "global" | "project";
  projectSlug?: string;
  update: boolean;
}
```

- [ ] **Step 2: Update `PendingToolSchema` in ipc-guards.ts**

Find `PendingToolSchema` (around line 18) and add `update`:

```typescript
const PendingToolSchema = z.object({
  name: z.string(),
  skillContent: z.string(),
  scope: z.enum(["global", "project"]),
  projectSlug: z.string().optional(),
  update: z.boolean(),
});
```

- [ ] **Step 3: Update `tool:pending` payload in event-bus.ts**

Find the `tool:pending` event type (currently around line 18) and add `update`:

```typescript
| {
    type: "tool:pending";
    payload: {
      name: string;
      skillContent: string;
      scope: "global" | "project";
      projectSlug?: string;
      update: boolean;
    };
  }
```

- [ ] **Step 4: Forward `update` in event-forwarders.ts**

Find the `eventBus.on("tool:pending", ...)` handler (around line 85) and add `update` to the emitted push:

```typescript
eventBus.on("tool:pending", (payload) => {
  emitPush(win, {
    type: "TOOL_PENDING",
    name: payload.name,
    skillContent: payload.skillContent,
    scope: payload.scope,
    projectSlug: payload.projectSlug,
    update: payload.update,
  });
});
```

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: TypeScript errors in `chat-handlers.ts` (proposeSkillFn not passing update yet) and possibly `PendingToolBanner.tsx` (add call doesn't include update). These are expected — Task 3 will fix them. All other errors are unexpected.

Actually — read the typecheck output before deciding. If errors only appear in `chat-handlers.ts` and `PendingToolBanner.tsx` (or similar consumer sites), that's expected. If you see errors elsewhere, investigate before proceeding.

- [ ] **Step 6: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests PASS (test files don't reference `update` yet so no runtime failures).

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-types.ts \
        src/shared/ipc-guards.ts \
        src/main/event-bus.ts \
        src/main/ipc/event-forwarders.ts
git commit -m "feat(skills): add update field to PendingTool type and tool:pending event payload"
```

---

## Task 3: propose-skill tool + signature propagation + chat-handlers

**Files:**
- Modify: `src/main/agent/tools/propose-skill.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/ipc/chat-handlers.ts`

**Context:** The `proposeFn` callback type threads through 5 files. All must get the new `update: boolean` argument. The business logic (exist-check + conflict enforcement) lives exclusively in `chat-handlers.ts` — it's the only place with access to both `toolApprovalService` and the event bus. The tool itself just validates the name format and calls `proposeFn`.

After this task, typecheck must be fully clean.

- [ ] **Step 1: Update `propose-skill.ts`**

Full updated file:

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export function createProposeSkillTool(
  proposeFn: (
    name: string,
    skillContent: string,
    script: string | undefined,
    scope: "global" | "project",
    update: boolean,
  ) => Promise<void>,
): AgentTool<typeof proposeSkillParameters, null> {
  return {
    name: "propose_skill",
    label: "Propose new or updated skill",
    description:
      "Propose a new or updated skill for the user to review and approve. " +
      "Use scope='global' for skills useful across all projects, or scope='project' for project-specific helpers. " +
      "Set update=true to propose an update to an existing skill — the tool will error if the skill does not exist. " +
      "Without update=true (default), the tool will error if a skill with the same name already exists. " +
      "The skill becomes available in future sessions once approved.",
    parameters: proposeSkillParameters,
    execute: async (
      _id,
      { name, description: _desc, skillContent, script, scope, update },
    ): Promise<AgentToolResult<null>> => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Invalid skill name "${name}": only lowercase letters, digits, and hyphens allowed`,
        );
      }
      await proposeFn(name, skillContent, script, scope ?? "global", update ?? false);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill "${name}" proposed as ${update ? "update" : "new"} (scope: ${scope ?? "global"}) and pending user approval.`,
          },
        ],
        details: null,
      };
    },
  };
}

const proposeSkillParameters = Type.Object({
  name: Type.String({
    description: "Kebab-case skill name (lowercase letters, digits, hyphens only)",
  }),
  description: Type.String({ description: "What the skill does" }),
  skillContent: Type.String({ description: "Full markdown skill file content" }),
  script: Type.Optional(
    Type.String({ description: "Optional shell script to bundle with the skill" }),
  ),
  scope: Type.Optional(
    Type.Union([Type.Literal("global"), Type.Literal("project")], {
      description:
        "Whether this skill is for all projects ('global') or just this project ('project'). Defaults to 'global'.",
    }),
  ),
  update: Type.Optional(
    Type.Boolean({
      description:
        "Set to true to propose an update to an existing skill. Defaults to false (new skill). " +
        "The tool errors if update=false and the skill already exists, or if update=true and it does not.",
    }),
  ),
});
```

- [ ] **Step 2: Update `ToolContext.proposeSkillFn` in tools.ts**

Find the `proposeSkillFn` field in the `ToolContext` interface and update the type:

```typescript
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
  update: boolean,
) => Promise<void>;
```

- [ ] **Step 3: Update `WorkerAgentConfig.proposeSkillFn` in worker-agent.ts**

Same 5-arg signature:

```typescript
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
  update: boolean,
) => Promise<void>;
```

- [ ] **Step 4: Update options interface in MessagePipeline.ts**

Same 5-arg signature in the `MessagePipelineOptions` interface (or equivalent):

```typescript
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
  update: boolean,
) => Promise<void>;
```

- [ ] **Step 5: Update options interface in session.ts**

Same 5-arg signature:

```typescript
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
  update: boolean,
) => Promise<void>;
```

- [ ] **Step 6: Update `proposeSkillFn` closure in chat-handlers.ts**

Find the `proposeSkillFn` closure (around line 129). Replace it:

```typescript
proposeSkillFn: async (name, skillContent, script, scope, update) => {
  if (scope === "project") {
    const slug = project.slug ?? projectId;
    const exists = await toolApprovalService.projectSkillExists(slug, name);
    if (!update && exists) {
      throw new Error(
        `Skill "${name}" already exists in this project. Set update: true to propose an update.`,
      );
    }
    if (update && !exists) {
      throw new Error(
        `Skill "${name}" does not exist in this project. Remove update: true to propose a new skill.`,
      );
    }
    await toolApprovalService.saveProjectPendingTool(slug, name, skillContent, script, update);
    eventBus.emit({
      type: "tool:pending",
      payload: { name, skillContent, scope: "project", projectSlug: slug, update },
    });
  } else {
    const exists = await toolApprovalService.skillExists(name);
    if (!update && exists) {
      throw new Error(
        `Skill "${name}" already exists. Set update: true to propose an update.`,
      );
    }
    if (update && !exists) {
      throw new Error(
        `Skill "${name}" does not exist. Remove update: true to propose a new skill.`,
      );
    }
    await toolApprovalService.savePendingTool(name, skillContent, script, update);
    eventBus.emit({
      type: "tool:pending",
      payload: { name, skillContent, scope: "global", update },
    });
  }
},
```

- [ ] **Step 7: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 8: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors. If `PendingToolBanner.tsx` has a typecheck error about missing `update` in the `add({...tool, scope: "global"})` call: the `...tool` spread now includes `update` from the service return, so the spread already satisfies the type. If TypeScript still complains because `tool` is typed as `PendingTool` (which has `update: boolean`) then the spread is already correct — no change needed to the banner.

- [ ] **Step 9: Commit**

```bash
git add src/main/agent/tools/propose-skill.ts \
        src/main/agent/tools.ts \
        src/main/agent/worker-agent.ts \
        src/main/agent/MessagePipeline.ts \
        src/main/agent/session.ts \
        src/main/ipc/chat-handlers.ts
git commit -m "feat(skills): add update flag to propose_skill tool with conflict enforcement"
```

---

## Task 4: UI — show Update badge in PendingToolModal

**Files:**
- Modify: `src/renderer/components/layout/chat/PendingToolModal.tsx`

**Context:** When a tool proposal is an update (`tool.update === true`), the modal should make this clear visually: a different badge color/label and different body copy. The banner itself needs no changes — the `update` field flows through the `...tool` spread automatically once `PendingTool` includes it.

- [ ] **Step 1: Update `PendingToolModal.tsx`**

Full updated file:

```tsx
import { Dialog } from "@mui/material";
import type { PendingTool } from "../../../../shared/ipc-channels";

const paperSx = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
  overflow: "hidden",
} as const;

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
  const isUpdate = tool.update === true;
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="pending-tool-modal"
      slotProps={{
        paper: {
          sx: paperSx,
        },
      }}
    >
      <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>
          {isUpdate ? "Update proposed skill" : "Review proposed skill"}: {tool.name}
        </span>
        <span className={isUpdate ? "chip chip--warning" : "chip chip--accent"}>
          {isUpdate ? "update" : "new"}
        </span>
      </div>
      <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>
        <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginBottom: 8 }}>
          {isUpdate
            ? "An agent has proposed an update to this skill. Approving will replace the existing skill entirely."
            : "An agent has proposed this new skill. Once approved, it will be available in future sessions."}
        </p>
        <pre
          className="thin-scroll"
          style={{
            padding: 12,
            background: "var(--surface-2)",
            borderRadius: "var(--r-md)",
            fontSize: 12,
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {tool.skillContent}
        </pre>
      </div>
      <div
        style={{
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={onReject}
          data-testid="reject-tool-btn"
        >
          Reject
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onApprove}
          data-testid="approve-tool-btn"
        >
          {isUpdate ? "Approve Update" : "Approve"}
        </button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
bun run test 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 3: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/PendingToolModal.tsx
git commit -m "feat(skills): show update badge and copy in PendingToolModal"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| `update: true` flag on `propose_skill` tool | Task 3 |
| Tool errors if `update: false` and skill already exists | Task 3 (chat-handlers conflict check) |
| Tool errors if `update: true` and skill does not exist | Task 3 (chat-handlers conflict check) |
| `approvePendingTool` replaces existing skill dir on update | Task 1 |
| `approveProjectPendingTool` replaces existing project skill dir on update | Task 1 |
| `update` flag visible in approval UI with badge | Task 4 |
| Copy in modal distinguishes new vs update | Task 4 |
| Push events include `update` for real-time banner updates | Task 2 |
| Old entries without META.json default to `update: false` | Task 1 (graceful fallback in getPendingTools) |

**Gaps checked:**
- `PendingToolBanner.tsx` — no changes needed. The `add({ ...tool, scope: "global" })` spreads `tool` which is now `PendingTool` (with `update`). The `update` field flows through automatically.
- `ipc-channels.ts` — no new channels needed.
- `ipc-validation.ts` — no new schemas needed (existing handlers are unchanged).
- `admin-handlers.ts` — no changes needed (handlers just delegate to service).

**Placeholder scan:** No TBDs, no "add validation later", no stubs. All code complete.

**Type consistency:**
- `proposeFn` 5-arg signature updated consistently in `propose-skill.ts`, `tools.ts`, `worker-agent.ts`, `MessagePipeline.ts`, `session.ts`, `chat-handlers.ts`
- `savePendingTool` 4th arg `update` consistent between service, tests, and call site in `chat-handlers.ts`
- `saveProjectPendingTool` 5th arg `update` consistent between service, tests, and call site
- `PendingTool.update: boolean` consistent between `ipc-types.ts`, `ipc-guards.ts`, and the event payload
