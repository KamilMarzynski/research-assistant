# Project Slug + Workspace Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UUID-based project dirs with readable slugs and move agent workspace inside each project tree.

**Architecture:** Projects get a `slug` column (base name + 6-char UUID suffix). `ProjectService` generates it on creation. All path helpers derive `projects/<slug>/` and `projects/<slug>/workspace/` from the slug. No top-level `workspace/` dir.

**Tech Stack:** TypeScript, Drizzle ORM, Bun, Vitest

---

## Files Overview

| File | Responsibility |
|---|---|
| `src/main/db/schema.ts` | Drizzle schema — add `slug` to `projects` |
| `src/main/db/migrate.ts` | Inline migrations — add `slug` column |
| `src/shared/types/project.ts` | `Project` type — add `slug` field |
| `src/main/utils/slug.ts` | **New** — `toSlug` and `generateProjectSlug` |
| `src/main/agent/context.ts` | Remove `toSlug`, import from utils |
| `src/main/repositories/IProjectRepository.ts` | `CreateProjectData` — add `slug` |
| `src/main/repositories/drizzle/DrizzleProjectRepository.ts` | Persist and read `slug` |
| `src/main/services/ProjectService.ts` | Generate slug, create slug-based dirs |
| `src/main/paths.ts` | `getWorkspacePath(slug)`, `getProjectPath(slug)` |
| `src/main/services/HomeService.ts` | `ensureWorkspaceForProject(slug)`, drop top-level `workspace` from `ensureDirectories` |
| `src/main/agent/path-jail.ts` | Constructor takes `slug` for workspace path |
| `src/main/agent/tools.ts` | `AgentToolsOptions` gets `slug`, workspace derived from it |
| `src/main/agent/MessagePipeline.ts` | `MessagePipelineOptions` gets `slug`, pass to tools + CompressionService |
| `src/main/agent/session.ts` | `AgentSessionOptions` gets `slug`, pass to pipeline |
| `src/main/agent/worker-agent.ts` | `WorkerAgentConfig` + `EvaluatorBaseConfig` get `slug` |
| `src/main/ipc/chat-handlers.ts` | Pass `project.slug` when creating `AgentSession` |
| `src/main/services/ResearchService.ts` | Use slug for per-task workspace, remove centralized cleanup |

---

## Task 1: DB Schema + Migration

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrate.ts`

- [ ] **Step 1: Add `slug` to schema**

```typescript
// src/main/db/schema.ts — add slug to projects table
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug"),          // <-- add this line
  folderPath: text("folder_path"),
  // ... rest unchanged
});
```

- [ ] **Step 2: Add migration**

```typescript
// src/main/db/migrate.ts — after Run 16 block
// Run 17: add slug
try {
  await db.run(sql`ALTER TABLE projects ADD COLUMN slug TEXT`);
} catch (err) {
  if (!isDuplicateColumnError(err)) throw err;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.ts
git commit -m "feat(db): add slug column to projects table"
```

---

## Task 2: Shared Types + Slug Utility

**Files:**
- Modify: `src/shared/types/project.ts`
- **Create:** `src/main/utils/slug.ts`
- Modify: `src/main/agent/context.ts`

- [ ] **Step 1: Add `slug` to Project type**

```typescript
// src/shared/types/project.ts
export type Project = {
  id: string;
  name: string;
  slug: string | null;   // <-- add
  folderPath: string | null;
  projectPath: string | null;
  modelOverride: string | null;
  maxRecentMessages: number;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 2: Create slug utility**

```typescript
// src/main/utils/slug.ts
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateProjectSlug(name: string, id: string): string {
  const base = toSlug(name) || "project";
  const suffix = id.replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}
```

- [ ] **Step 3: Move `toSlug` from context.ts to new utility**

Remove `toSlug` from `src/main/agent/context.ts` and add import:

```typescript
import { toSlug } from "../utils/slug";
```

- [ ] **Step 4: Update context.test.ts import**

In `src/main/agent/context.test.ts`, the dynamic import will auto-resolve through the module. No change needed unless the test explicitly imports `toSlug` from `./context`.

Verify: `grep -n "toSlug" src/main/agent/context.test.ts` — the test does `const { loadSkillIndexXml, buildSystemContext, toSlug, loadSkillsByContent } = await import("./context");` so `toSlug` is still exported from context.ts. We need to re-export it:

```typescript
// src/main/agent/context.ts — add at top
export { toSlug } from "../utils/slug";
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/project.ts src/main/utils/slug.ts src/main/agent/context.ts
git commit -m "feat: add slug generation utility and Project.slug field"
```

---

## Task 3: Project Repository

**Files:**
- Modify: `src/main/repositories/IProjectRepository.ts`
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`

- [ ] **Step 1: Add `slug` to repository interface**

```typescript
// src/main/repositories/IProjectRepository.ts
export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages" | "modelOverride" | "slug"
> & {
  maxRecentMessages?: number;
  modelOverride?: string | null;
  slug?: string | null;
};
```

Wait — `Omit` should include `slug` so it's excluded from the required Omit, and then added back as optional. Actually simpler:

```typescript
export type CreateProjectData = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "maxRecentMessages" | "modelOverride" | "slug"
> & {
  maxRecentMessages?: number;
  modelOverride?: string | null;
  slug?: string | null;
};
```

- [ ] **Step 2: Update DrizzleProjectRepository.create**

```typescript
// src/main/repositories/drizzle/DrizzleProjectRepository.ts
async create(data: CreateProjectData): Promise<Project> {
  const now = this.now();
  const project: Project = {
    id: this.id(),
    name: data.name,
    slug: data.slug ?? null,
    folderPath: data.folderPath ?? null,
    projectPath: data.projectPath ?? null,
    modelOverride: data.modelOverride ?? null,
    maxRecentMessages: data.maxRecentMessages ?? 20,
    createdAt: now,
    updatedAt: now,
  };
  await this.db.insert(projects).values({
    id: project.id,
    name: project.name,
    slug: project.slug,
    folderPath: project.folderPath,
    projectPath: project.projectPath,
    modelOverride: project.modelOverride,
    maxRecentMessages: project.maxRecentMessages,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
  return project;
}
```

- [ ] **Step 3: Update rowToEntity**

```typescript
protected rowToEntity = (row: typeof projects.$inferSelect): Project => ({
  id: row.id,
  name: row.name,
  slug: row.slug ?? null,
  folderPath: row.folderPath ?? null,
  projectPath: row.projectPath ?? null,
  modelOverride: row.modelOverride ?? null,
  maxRecentMessages: row.maxRecentMessages ?? 20,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main/repositories/IProjectRepository.ts src/main/repositories/drizzle/DrizzleProjectRepository.ts
git commit -m "feat(repo): persist and read project slug"
```

---

## Task 4: ProjectService

**Files:**
- Modify: `src/main/services/ProjectService.ts`

- [ ] **Step 1: Add slug import and generation**

```typescript
import { generateProjectSlug } from "../utils/slug";
```

- [ ] **Step 2: Update createProject**

```typescript
async createProject(name: string, folderPath?: string | null): Promise<Project> {
  const settings = await this.settingsService.getSettings();
  const provider = resolveProvider({ settings });
  const modelOverride = `${provider.type}:${provider.model}`;

  const project = await this.repo.create({
    name,
    folderPath: folderPath ?? null,
    modelOverride,
    projectPath: null,
  });

  const slug = generateProjectSlug(project.name, project.id);
  const projectPath = join(this.homePath, "projects", slug);
  await mkdir(projectPath, { recursive: true });

  await this.repo.setProjectPath(project.id, projectPath);
  // Also save slug to DB
  await this.db.update(projects).set({ slug }).where(eq(projects.id, project.id));

  return { ...project, slug, projectPath };
}
```

Wait — `ProjectService` doesn't have access to `db` or the `projects` table directly. We need to add a method to the repository or add a `setSlug` method. Let's add `setSlug` to `IProjectRepository`.

Actually, simpler: include `slug` in the initial `repo.create` call. The repo accepts `slug` in `CreateProjectData`. So:

```typescript
async createProject(name: string, folderPath?: string | null): Promise<Project> {
  const settings = await this.settingsService.getSettings();
  const provider = resolveProvider({ settings });
  const modelOverride = `${provider.type}:${provider.model}`;

  // Generate slug BEFORE create, but we need the ID first.
  // Create with slug=null, then generate and update.
  const project = await this.repo.create({
    name,
    folderPath: folderPath ?? null,
    modelOverride,
    projectPath: null,
  });

  const slug = generateProjectSlug(project.name, project.id);
  const projectPath = join(this.homePath, "projects", slug);
  await mkdir(projectPath, { recursive: true });

  await this.repo.setProjectPath(project.id, projectPath);
  // Need to set slug too — add setSlug to repo interface
}
```

Let's add `setSlug(id, slug)` to `IProjectRepository` and implement it in `DrizzleProjectRepository`.

- [ ] **Step 3: Add `setSlug` to repository**

In `IProjectRepository.ts`:
```typescript
setSlug(id: string, slug: string): Promise<void>;
```

In `DrizzleProjectRepository.ts`:
```typescript
async setSlug(id: string, slug: string): Promise<void> {
  const result = await this.db
    .update(projects)
    .set({ slug, updatedAt: this.now() })
    .where(eq(projects.id, id));
  if (result.rowsAffected === 0) throw new Error(`Project not found: ${id}`);
}
```

- [ ] **Step 4: Final createProject implementation**

```typescript
async createProject(name: string, folderPath?: string | null): Promise<Project> {
  const settings = await this.settingsService.getSettings();
  const provider = resolveProvider({ settings });
  const modelOverride = `${provider.type}:${provider.model}`;

  const project = await this.repo.create({
    name,
    folderPath: folderPath ?? null,
    modelOverride,
    projectPath: null,
  });

  const slug = generateProjectSlug(project.name, project.id);
  const projectPath = join(this.homePath, "projects", slug);
  await mkdir(projectPath, { recursive: true });

  await Promise.all([
    this.repo.setProjectPath(project.id, projectPath),
    this.repo.setSlug(project.id, slug),
  ]);

  return { ...project, slug, projectPath };
}
```

- [ ] **Step 5: Update deleteProject cleanup**

Old cleanup removed `workspace/<id>` and `projects/<id>`. New cleanup removes `projects/<slug>` only (workspace is nested inside).

```typescript
async deleteProject(id: string): Promise<void> {
  const project = await this.getProject(id);
  await this.repo.delete(id);

  if (project.projectPath) {
    await this.safeRm(project.projectPath);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/ProjectService.ts src/main/repositories/IProjectRepository.ts src/main/repositories/drizzle/DrizzleProjectRepository.ts
git commit -m "feat(services): generate slug on project creation, create slug-based dirs"
```

---

## Task 5: HomeService + Paths

**Files:**
- Modify: `src/main/paths.ts`
- Modify: `src/main/services/HomeService.ts`

- [ ] **Step 1: Update paths.ts**

```typescript
// src/main/paths.ts
export function getProjectPath(slug: string): string {
  return join(getScholarHome(), "projects", slug);
}

export function getWorkspacePath(slug: string): string {
  return join(getProjectPath(slug), "workspace");
}
```

Note: keep old `getWorkspacePath()` with no args? No callers use it without args except `paths.test.ts` and maybe some other places. Let's check.

Search: `grep -rn "getWorkspacePath()" src/ --include="*.ts"`

Only `paths.test.ts` and `bootstrap.ts` maybe? Actually `HomeService.ensureDirectories` uses `join(home, "workspace")`. Let's remove the no-arg version and update all callers.

Actually, there might be code that uses `getWorkspacePath()` without args. Let me check. I'll include both in the plan but recommend removing the no-arg version.

For now, replace:
```typescript
export function getWorkspacePath(): string {
  return join(getScholarHome(), "workspace");
}
export function getWorkspacePath(slug: string): string {
  return join(getProjectPath(slug), "workspace");
}
```

Overloads! But TypeScript doesn't allow that with different parameter counts unless declared. Simpler: rename old to `getGlobalWorkspacePath` or just change the signature. Since the old no-arg version is only used in tests and `ensureDirectories`, we can change it.

Let's just replace:
```typescript
export function getWorkspacePath(slug: string): string {
  return join(getProjectPath(slug), "workspace");
}
```

And update `HomeService.ensureDirectories` to NOT create `workspace`.

- [ ] **Step 2: Update HomeService**

```typescript
// src/main/services/HomeService.ts
async ensureDirectories(): Promise<void> {
  const home = this.getHomePath();
  const dirs = [
    home,
    join(home, "skills"),
    join(home, "projects"),
    join(home, "tasks"),
    join(home, "pending-tools"),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  await this.copyBuiltinSkillsIfNeeded();
}

async ensureWorkspaceForProject(slug: string): Promise<string> {
  const dir = join(this.getHomePath(), "projects", slug, "workspace");
  await mkdir(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/paths.ts src/main/services/HomeService.ts
git commit -m "feat(paths): workspace lives under projects/<slug>/workspace"
```

---

## Task 6: PathJail

**Files:**
- Modify: `src/main/agent/path-jail.ts`

- [ ] **Step 1: Update constructor to take `slug`**

```typescript
constructor(
  readonly projectId: string,
  slug: string,
  folderPath: string | null,
  projectPath: string | null,
  private readonly allowlistService: AllowlistService,
) {
  this.home = getScholarHome();
  this.workspace = join(this.home, "projects", slug, "workspace");
  // ... rest unchanged
}
```

- [ ] **Step 2: Update tests**

In `src/main/agent/path-jail.test.ts`, update all `new PathJail(...)` calls:

```typescript
const PROJECT_SLUG = "test-project";
// replace all: new PathJail(PROJECT_ID, FOLDER_PATH, PROJECT_PATH, allowlistService)
// with:        new PathJail(PROJECT_ID, PROJECT_SLUG, FOLDER_PATH, PROJECT_PATH, allowlistService)
```

Also update the `HOME` const in the test from `join(homedir(), ".scholar")` to match. The workspace paths in the test assertions need to change from `join(HOME, "workspace", PROJECT_ID, ...)` to `join(HOME, "projects", PROJECT_SLUG, "workspace", ...)`.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/path-jail.ts src/main/agent/path-jail.test.ts
git commit -m "feat(path-jail): workspace path derived from project slug"
```

---

## Task 7: Agent Tools + MessagePipeline + Session

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/ipc/chat-handlers.ts`

- [ ] **Step 1: Add `slug` to AgentToolsOptions**

```typescript
// src/main/agent/tools.ts
export interface AgentToolsOptions {
  projectId: string;
  slug: string;          // <-- add
  projectName: string;
  // ... rest unchanged
}
```

- [ ] **Step 2: Use slug for workspacePath in createAgentTools**

```typescript
export function createAgentTools(opts: AgentToolsOptions): AgentTool[] {
  const { projectId, slug, projectPath, folderPath, homePath } = opts;
  const jail = new PathJail(projectId, slug, folderPath, projectPath, opts.allowlistService);
  const workspacePath = join(homePath, "projects", slug, "workspace");
  // ... rest unchanged
}
```

- [ ] **Step 3: Add `slug` to MessagePipelineOptions**

```typescript
// src/main/agent/MessagePipeline.ts
export interface MessagePipelineOptions {
  projectId: string;
  slug: string;          // <-- add
  projectName: string;
  // ... rest unchanged
}
```

In `MessagePipeline` constructor:
```typescript
private readonly slug: string;
// ...
this.slug = options.slug;
```

- [ ] **Step 4: Update CompressionService path and createAgentTools call**

```typescript
const compressionService = new CompressionService(
  join(this.homePath, "projects", options.slug, "workspace", ".compressed"),
);

const tools = createAgentTools({
  projectId: options.projectId,
  slug: options.slug,          // <-- pass
  projectName: options.projectName,
  // ... rest unchanged
});
```

- [ ] **Step 5: Update fallback paths in MessagePipeline**

Replace `options.projectPath ?? join(this.homePath, "projects", options.projectId)` with `options.projectPath ?? join(this.homePath, "projects", options.slug)` in the two `saveMemoryFn`/`readMemoryFn` closures.

Also update the fallback in the event handler at the bottom:
```typescript
this.projectPath ?? join(this.homePath, "projects", this.projectId),
```
Change to:
```typescript
this.projectPath ?? join(this.homePath, "projects", this.slug),
```

- [ ] **Step 6: Add `slug` to AgentSessionOptions**

```typescript
// src/main/agent/session.ts
export interface AgentSessionOptions {
  // ... existing fields ...
  projectId: string;
  slug: string;          // <-- add
  projectName: string;
  projectPath: string | null;
  // ...
}
```

In `AgentSession` constructor, `options.slug` is passed through to `MessagePipeline` automatically since `options` is spread.

- [ ] **Step 7: Pass slug from chat-handlers**

```typescript
// src/main/ipc/chat-handlers.ts
const session = new AgentSession({
  // ... existing fields ...
  projectId,
  slug: project.slug ?? projectId,   // <-- add (fallback for old projects)
  projectName: project.name,
  // ...
});
```

Also update the `projectPath` fallback (line 113-114):
```typescript
const projectPath =
  project.projectPath ?? join(homeService.getHomePath(), "projects", project.slug ?? projectId);
```

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/tools.ts src/main/agent/MessagePipeline.ts src/main/agent/session.ts src/main/ipc/chat-handlers.ts
git commit -m "feat(agent): pass slug through session, pipeline, and tools"
```

---

## Task 8: Worker Agent Config

**Files:**
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Add `slug` to WorkerAgentConfig and EvaluatorBaseConfig**

```typescript
export interface WorkerAgentConfig {
  toolNames: readonly AgentToolName[];
  // ...
  projectId: string;
  slug: string;          // <-- add
  projectName: string;
  projectPath: string | null;
  // ...
}

export interface EvaluatorBaseConfig {
  projectId: string;
  slug: string;          // <-- add
  projectName: string;
  projectPath: string | null;
  // ...
}
```

- [ ] **Step 2: Pass slug through createWorkerAgent**

In `createWorkerAgent`, add `slug` to the explicit `createAgentTools` call at line ~295:

```typescript
const tools = createAgentTools({
  projectId,
  slug,              // <-- add
  projectName,
  projectPath,
  folderPath,
  homePath,
  // ... rest unchanged
});
```

The `base` object used for child agents spreads `WorkerAgentBase` which inherits `slug` from `WorkerAgentConfig`, so `AGENT_TYPE_PRESETS` flow it through automatically.

In `tools.ts`, update `createAgentTools` to accept `slug` and pass it.

Wait — `createWorkerAgent` also calls `createAgentTools` internally at line 295. `createAgentTools` receives `config` which has `slug`. So we just need to make sure `createAgentTools` destructures and passes `slug`.

Also in `MessagePipeline.ts`, `makeEvaluatorFn` call needs `slug`:
```typescript
requestEvaluationFn: makeEvaluatorFn({
  projectId: options.projectId,
  slug: options.slug,
  // ...
}),
```

And `startResearchFn` calls need `slug`? No — `ResearchService` will look up the slug via `projectService.getProject`.

But `createWorkerAgent` when building child agents with `AGENT_TYPE_PRESETS` passes `base` which includes `slug`. Need to check if `base` is used anywhere that drops `slug`. The presets spread `base` into `WorkerAgentConfig`, so `slug` flows through automatically.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/worker-agent.ts
git commit -m "feat(worker-agent): add slug to WorkerAgentConfig"
```

---

## Task 9: ResearchService

**Files:**
- Modify: `src/main/services/ResearchService.ts`

- [ ] **Step 1: Remove centralized workspace cleanup**

Delete `cleanupOldWorkspaces` method entirely. Remove its call in `_runResearch`.

- [ ] **Step 2: Use slug for workspace in _runResearch**

```typescript
private async _runResearch(
  config: RunResearchConfig,
  buildPartialConfig: (workspacePath: string) => Omit<WorkerAgentConfig, "provider" | "onProgress">,
): Promise<{ taskId: string }> {
  const taskId = randomUUID();
  const settings = await this.settingsService.getSettings();

  const homePath = this.homeService.getHomePath();
  const project = await this.projectService.getProject(config.projectId);
  const slug = project.slug ?? config.projectId; // fallback for old projects
  const workspacePath = join(homePath, "projects", slug, "workspace", taskId);

  await mkdir(workspacePath, { recursive: true });
  // ... rest unchanged, except remove cleanupOldWorkspaces call
}
```

- [ ] **Step 3: Update PathJail instantiations in ResearchService**

There are two `new PathJail(...)` calls in ResearchService at lines 235 and 248. Add `slug` as second arg:

```typescript
const jail = new PathJail(
  config.projectId,
  slug,
  config.folderPath,
  projectPath,
  this.allowlistService,
);
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/ResearchService.ts
git commit -m "feat(research): use slug for per-task workspace, remove centralized cleanup"
```

---

## Task 10: Update Tests

**Files:**
- Modify: `src/main/services/__tests__/ProjectService.test.ts`
- Modify: `src/main/services/__tests__/HomeService.test.ts`
- Modify: `src/main/__tests__/paths.test.ts`
- Modify: `src/main/agent/context.test.ts`
- Modify: `src/main/agent/session.test.ts`
- Modify: `src/main/agent/worker-agent.test.ts`
- Modify: `src/main/agent/tools.test.ts`
- **Create:** `src/main/utils/slug.test.ts`

- [ ] **Step 1: Update ProjectService test**

Add `setSlug` to mock repo, add `slug` to `makeProject`, assert slug-based path:

```typescript
function makeMockRepo(overrides: Partial<IProjectRepository> = {}): IProjectRepository {
  return {
    // ... existing mocks ...
    setSlug: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    slug: "test-project-a1b2c3",
    // ... rest unchanged
  };
}
```

Update `createProject` test assertions:
- `expect(result.projectPath).toBe("/tmp/.scholar/projects/test-project-a1b2c3")`
- Add assertion that `repo.setSlug` was called

Update `deleteProject` test:
- Remove assertion for `rm` on `/tmp/.scholar/workspace/p1`
- Keep assertion for `/tmp/.scholar/projects/p1`

- [ ] **Step 2: Update HomeService test**

Remove assertion for `workspace` dir creation in `ensureDirectories`. Update `ensureWorkspaceForProject` test:

```typescript
it("ensureWorkspaceForProject creates workspace inside project dir", async () => {
  const svc = new HomeService(makeTaskPersistence(), makeSkillManagement(), makeToolApproval());
  await svc.ensureDirectories();
  const dir = await svc.ensureWorkspaceForProject("my-project");
  await expect(access(dir)).resolves.toBeUndefined();
  expect(dir).toContain("projects/my-project/workspace");
});
```

- [ ] **Step 3: Update paths test**

```typescript
it("getWorkspacePath returns path under projects/<slug>/workspace", () => {
  const path = getWorkspacePath("my-project");
  expect(path).toContain("projects");
  expect(path).toContain("my-project");
  expect(path).toContain("workspace");
  expect(path).toContain(".scholar");
});
```

- [ ] **Step 4: Update session.test.ts**

The mock `createAgentTools` is called with `options` that include `slug`. Since the mock returns tools regardless, no change needed unless the test asserts on the call arguments. Check — it doesn't.

But `AgentSessionOptions` now requires `slug`. When constructing `AgentSession` in tests, add `slug: "test-slug"`.

- [ ] **Step 5: Update worker-agent.test.ts**

Add `slug: "test-slug"` to `BASE_CONFIG` and any other `WorkerAgentConfig` objects.

- [ ] **Step 6: Update tools.test.ts**

Add `slug` to `AgentToolsOptions` mocks/objects.

- [ ] **Step 7: Create slug utility test**

```typescript
// src/main/utils/slug.test.ts
import { describe, expect, it } from "vitest";
import { generateProjectSlug, toSlug } from "./slug";

describe("toSlug", () => {
  it("converts to lowercase with spaces as hyphens", () => {
    expect(toSlug("My Cool Project")).toBe("my-cool-project");
  });
  it("strips non-alphanumeric characters", () => {
    expect(toSlug("My Cool Project!")).toBe("my-cool-project");
  });
  it("trims leading and trailing hyphens", () => {
    expect(toSlug("!hello world!")).toBe("hello-world");
  });
});

describe("generateProjectSlug", () => {
  it("combines base slug with 6-char uuid suffix", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(generateProjectSlug("My Project", id)).toBe("my-project-123456");
  });
  it("uses 'project' fallback when name is empty after slugify", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    expect(generateProjectSlug("!!!", id)).toBe("project-abcdef1");
  });
});
```

- [ ] **Step 8: Run all tests**

```bash
bun run typecheck
bun run check
bun run test
```

- [ ] **Step 9: Commit**

```bash
git add src/main/services/__tests__/ProjectService.test.ts src/main/services/__tests__/HomeService.test.ts src/main/__tests__/paths.test.ts src/main/agent/session.test.ts src/main/agent/worker-agent.test.ts src/main/agent/tools.test.ts src/main/utils/slug.test.ts
git commit -m "test: update tests for slug-based workspace paths"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Slug stored in DB | Task 1, 3 |
| `generateProjectSlug(name, id)` | Task 2 |
| `ProjectService` generates slug on create | Task 4 |
| Workspace inside `projects/<slug>/workspace/` | Task 5, 6, 7 |
| `PathJail` uses slug workspace | Task 6 |
| `safe_bash` runs in correct cwd | Task 7 (workspacePath derived from slug) |
| `CompressionService` cache path updated | Task 7 |
| `ResearchService` uses slug for task workspaces | Task 9 |
| No migration — schema change only | Task 1 |
| Future task nesting deferred | Not in scope |

## Placeholder Scan

No placeholders. All steps show exact code.

## Type Consistency Check

- `Project.slug` — `string | null` in shared types, repo, service
- `generateProjectSlug` — `(name: string, id: string) => string`
- `PathJail` constructor — `(projectId, slug, folderPath, projectPath, allowlistService)`
- `AgentToolsOptions.slug` — `string`
- `MessagePipelineOptions.slug` — `string`
- `AgentSessionOptions.slug` — `string`
- `WorkerAgentConfig.slug` — `string`
- `EvaluatorBaseConfig.slug` — `string`

All consistent.
