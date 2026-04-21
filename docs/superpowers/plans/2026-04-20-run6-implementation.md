# Run 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent home directory, first-run interview, path-jailed file ops, safe_bash execution, and background research dispatch — all surfaced as Pi tools the agent calls itself.

**Architecture:** `HomeService` bootstraps `~/.research-assistant/` on startup. `loadSkills()` + `buildSystemContext()` in `context.ts` assemble the system prompt prefix from 4 skill dirs + config.md + AGENTS.md. Five Pi tools (`read_file`, `write_file`, `list_dir`, `safe_bash`, `start_research`) are built by `createAgentTools()` and registered on `AgentSession`. `ResearchService` spawns background Pi agents; completions are injected into the main session via `agent.followUp()`.

**Tech Stack:** Bun, Electron, TypeScript strict, Pi SDK (`pi-agent-core`), TypeBox (`@sinclair/typebox`), `yaml`, Vitest, TSyringe, Drizzle ORM + libsql.

---

## File Map

**New files:**
- `src/main/services/HomeService.ts` — dir bootstrap, first-run check, builtin skill copy
- `src/main/services/__tests__/HomeService.test.ts`
- `src/main/agent/path-jail.ts` — PathJail security class
- `src/main/agent/path-jail.test.ts`
- `src/main/agent/context.ts` — loadSkills(), buildSystemContext()
- `src/main/agent/context.test.ts`
- `src/main/agent/extensions/safe-bash.ts` — safe_bash Pi tool implementation
- `src/main/agent/extensions/safe-bash.test.ts`
- `src/main/agent/tools.ts` — createAgentTools() factory
- `src/main/agent/builtin-skills.ts` — inline skill content as TS string constants

**Modified files:**
- `src/shared/types/project.ts` — add `folderPath: string | null`
- `src/shared/ipc-channels.ts` — add `OPEN_FOLDER_DIALOG`, `LINK_FOLDER`
- `src/main/db/schema.ts` — add `folder_path` column
- `src/main/db/migrate.ts` — add ALTER TABLE migration
- `src/main/repositories/IProjectRepository.ts` — add `linkFolder()`
- `src/main/repositories/drizzle/DrizzleProjectRepository.ts` — implement `linkFolder()`
- `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`
- `src/main/services/ProjectService.ts` — add `linkFolder()`
- `src/main/services/__tests__/ProjectService.test.ts`
- `src/main/services/ResearchService.ts` — implement `startResearch()`
- `src/main/services/__tests__/ResearchService.test.ts`
- `src/main/agent/session.ts` — add tools, first-run prompt, folderPath, queueFollowUp()
- `src/main/agent/session.test.ts` — update + add tests
- `src/main/di/tokens.ts` — add `AGENT_HOME_PATH_TOKEN`, `HOME_SERVICE_TOKEN`
- `src/main/bootstrap.ts` — register HomeService, call ensureDirectories()
- `src/main/ipc-handlers.ts` — new handlers, EventBus→IPC wiring, research followUp
- `src/renderer/electron.d.ts` — add new IPC channel types
- `src/renderer/components/layout/LeftSidebar.tsx` — folder picker in create dialog
- `src/renderer/components/layout/chat/ResearchStatusBar.tsx` — wire real events

---

## Task 1: Types and IPC constants

**Files:**
- Modify: `src/shared/types/project.ts`
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Update Project type**

```typescript
// src/shared/types/project.ts
export type Project = {
  id: string;
  name: string;
  folderPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelPreset = {
  id: string;
  name: string;
  provider: "openrouter";
  modelId: string;
};
```

- [ ] **Step 2: Add new IPC channel constants**

```typescript
// src/shared/ipc-channels.ts
export const IPC = {
  // renderer → main (invoke — request/response)
  GET_PROJECTS: "GET_PROJECTS",
  CREATE_PROJECT: "CREATE_PROJECT",
  GET_ARTIFACTS: "GET_ARTIFACTS",
  GET_MESSAGES: "GET_MESSAGES",
  GET_SETTINGS: "GET_SETTINGS",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  OPEN_FOLDER_DIALOG: "OPEN_FOLDER_DIALOG",
  LINK_FOLDER: "LINK_FOLDER",

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

- [ ] **Step 3: Run typecheck to verify no breakage**

```bash
bun run typecheck
```

Expected: errors where `folderPath` is missing from `rowToProject` mapper in `DrizzleProjectRepository.ts`. Those are fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/project.ts src/shared/ipc-channels.ts
git commit -m "feat(run6): add folderPath to Project type and new IPC channels"
```

---

## Task 2: DB schema + migration + repository

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/migrate.ts`
- Modify: `src/main/repositories/IProjectRepository.ts`
- Modify: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`
- Modify: `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`

- [ ] **Step 1: Write failing tests for linkFolder and folderPath mapping**

Add to `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`:

```typescript
describe("linkFolder", () => {
  it("persists folderPath to the project row", async () => {
    const project = await repo.create({ name: "Linked" });
    await repo.linkFolder(project.id, "/Users/me/myproject");

    const found = await repo.get(project.id);
    expect(found?.folderPath).toBe("/Users/me/myproject");
  });

  it("returns null folderPath for newly created projects", async () => {
    const project = await repo.create({ name: "Fresh" });
    expect(project.folderPath).toBeNull();
  });

  it("list() includes folderPath", async () => {
    const project = await repo.create({ name: "Listed" });
    await repo.linkFolder(project.id, "/some/path");
    const list = await repo.list();
    expect(list[0].folderPath).toBe("/some/path");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: TypeScript compile errors — `linkFolder` not on repo, `folderPath` not in `Project`.

- [ ] **Step 3: Update schema**

```typescript
// src/main/db/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  folderPath: text("folder_path"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Messages are immutable after creation — no updatedAt column.
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Artifacts are immutable after creation — no updatedAt column.
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 4: Add migration for folder_path column**

```typescript
// src/main/db/migrate.ts
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./client";

export async function runMigrations(db: DrizzleDB): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Run 6: add folder_path — idempotent, ignore "duplicate column name" error
  try {
    await db.run(sql`ALTER TABLE projects ADD COLUMN folder_path TEXT`);
  } catch {
    // column already exists — safe to ignore
  }
}
```

- [ ] **Step 5: Update IProjectRepository interface**

```typescript
// src/main/repositories/IProjectRepository.ts
import type { Project } from "@shared/types";

export interface IProjectRepository {
  create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
  linkFolder(id: string, folderPath: string): Promise<void>;
}
```

Note: `create` data now includes optional `folderPath` via `Omit` — since `Project` type has `folderPath: string | null`, the `Omit` preserves it.

- [ ] **Step 6: Implement linkFolder in DrizzleProjectRepository**

```typescript
// src/main/repositories/drizzle/DrizzleProjectRepository.ts
import type { Project } from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DrizzleDB } from "../../db/client";
import { projects } from "../../db/schema";
import { DB_TOKEN } from "../../di/tokens";
import type { IProjectRepository } from "../IProjectRepository";

@injectable()
export class DrizzleProjectRepository implements IProjectRepository {
  private lastTimestamp = 0;

  private monotonicNow(): Date {
    const ts = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    return new Date(ts);
  }

  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
    const now = this.monotonicNow();
    const project: Project = {
      id: crypto.randomUUID(),
      name: data.name,
      folderPath: data.folderPath ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    return project;
  }

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt), desc(projects.id));
    return rows.map(this.rowToProject);
  }

  async get(id: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return rows[0] ? this.rowToProject(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async linkFolder(id: string, folderPath: string): Promise<void> {
    await this.db.update(projects).set({ folderPath }).where(eq(projects.id, id));
  }

  private rowToProject = (row: typeof projects.$inferSelect): Project => ({
    id: row.id,
    name: row.name,
    folderPath: row.folderPath ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
```

- [ ] **Step 7: Run tests — confirm they pass**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrate.ts \
  src/main/repositories/IProjectRepository.ts \
  src/main/repositories/drizzle/DrizzleProjectRepository.ts \
  src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
git commit -m "feat(run6): add folder_path to projects — schema, migration, repo"
```

---

## Task 3: ProjectService.linkFolder

**Files:**
- Modify: `src/main/services/ProjectService.ts`
- Modify: `src/main/services/__tests__/ProjectService.test.ts`

- [ ] **Step 1: Write failing tests for linkFolder**

Add to `src/main/services/__tests__/ProjectService.test.ts`:

```typescript
// At top, add import:
import { access } from "node:fs/promises";
vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

// In makeMockRepo, add linkFolder:
function makeMockRepo(overrides: Partial<IProjectRepository> = {}): IProjectRepository {
  return {
    create: vi.fn().mockResolvedValue(makeProject()),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    linkFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// makeProject update — add folderPath:
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    folderPath: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// New describe block:
describe("linkFolder", () => {
  it("validates the path exists then delegates to repo", async () => {
    vi.mocked(repo.get).mockResolvedValue(makeProject());

    await service.linkFolder("proj-1", "/some/path");

    expect(access).toHaveBeenCalledWith("/some/path");
    expect(repo.linkFolder).toHaveBeenCalledWith("proj-1", "/some/path");
  });

  it("throws NotFoundError when project does not exist", async () => {
    vi.mocked(repo.get).mockResolvedValue(null);

    await expect(service.linkFolder("missing", "/some/path")).rejects.toThrow(NotFoundError);
    expect(repo.linkFolder).not.toHaveBeenCalled();
  });

  it("throws when the path does not exist on disk", async () => {
    vi.mocked(repo.get).mockResolvedValue(makeProject());
    vi.mocked(access).mockRejectedValueOnce(new Error("ENOENT"));

    await expect(service.linkFolder("proj-1", "/no/such/path")).rejects.toThrow(
      "Folder not found: /no/such/path",
    );
    expect(repo.linkFolder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/ProjectService.test.ts
```

Expected: FAIL — `linkFolder` not defined on `ProjectService`.

- [ ] **Step 3: Implement linkFolder in ProjectService**

```typescript
// src/main/services/ProjectService.ts
import { access } from "node:fs/promises";
import { inject, injectable } from "tsyringe";
import type { Project } from "../../shared/types";
import { PROJECT_REPO_TOKEN } from "../di/tokens";
import type { IProjectRepository } from "../repositories/IProjectRepository";
import { NotFoundError } from "./errors";

@injectable()
export class ProjectService {
  constructor(@inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository) {}

  async createProject(name: string, folderPath?: string | null): Promise<Project> {
    return this.repo.create({ name, folderPath: folderPath ?? null });
  }

  async listProjects(): Promise<Project[]> {
    return this.repo.list();
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.repo.get(id);
    if (!project) throw new NotFoundError("Project", id);
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.getProject(id);
    await this.repo.delete(id);
  }

  async linkFolder(id: string, folderPath: string): Promise<void> {
    await this.getProject(id); // throws NotFoundError if missing
    try {
      await access(folderPath);
    } catch {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    await this.repo.linkFolder(id, folderPath);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/ProjectService.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ProjectService.ts src/main/services/__tests__/ProjectService.test.ts
git commit -m "feat(run6): ProjectService.linkFolder — validates path + delegates"
```

---

## Task 4: HomeService

**Files:**
- Create: `src/main/services/HomeService.ts`
- Create: `src/main/services/__tests__/HomeService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/services/__tests__/HomeService.test.ts
import "reflect-metadata";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override HOME so HomeService creates dirs in tmpDir instead of real ~
let tmpHome: string;
let tmpAgents: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

const { HomeService } = await import("../HomeService");

describe("HomeService", () => {
  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
    tmpAgents = join(tmpHome, ".agents");
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("ensureDirectories creates required dirs", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();

    const fs = await import("node:fs/promises");
    await expect(fs.access(join(tmpHome, ".research-assistant"))).resolves.toBeUndefined();
    await expect(fs.access(join(tmpHome, ".research-assistant", "skills"))).resolves.toBeUndefined();
    await expect(fs.access(join(tmpHome, ".research-assistant", "workspace"))).resolves.toBeUndefined();
    await expect(fs.access(join(tmpHome, ".research-assistant", "projects"))).resolves.toBeUndefined();
    await expect(fs.access(join(tmpHome, ".agents", "skills"))).resolves.toBeUndefined();
  });

  it("isFirstRun returns true when config.md missing", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    expect(await svc.isFirstRun()).toBe(true);
  });

  it("isFirstRun returns false after config.md is written", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    await writeFile(join(tmpHome, ".research-assistant", "config.md"), "# Config");
    expect(await svc.isFirstRun()).toBe(false);
  });

  it("ensureWorkspaceForProject creates and returns workspace dir", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const dir = await svc.ensureWorkspaceForProject("proj-abc");
    const fs = await import("node:fs/promises");
    await expect(fs.access(dir)).resolves.toBeUndefined();
    expect(dir).toContain("proj-abc");
  });

  it("ensureDirectories copies builtin skills when skills dir is empty", async () => {
    const svc = new HomeService();
    await svc.ensureDirectories();
    const entries = await readdir(join(tmpHome, ".research-assistant", "skills"));
    expect(entries).toContain("start_research");
    expect(entries).toContain("discover_project");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: FAIL — `HomeService` not found.

- [ ] **Step 3: Create builtin-skills.ts first (HomeService depends on it)**

```typescript
// src/main/agent/builtin-skills.ts

export const START_RESEARCH_SKILL = `---
name: start_research
description: Dispatch a background research task. Use when the user asks for in-depth research that would take more than one exchange to complete.
---

# start_research

Use the \`start_research\` tool to dispatch a background research worker when:
- The user asks to "research", "investigate", "find out about", or "look into" something non-trivial
- The task requires reading multiple files, running scripts, or synthesising across sources
- The research will take more than a quick answer

## Tool signature

\`\`\`
start_research({ query: string })
\`\`\`

- \`query\`: a clear, self-contained research question. Include all necessary context — the worker has no access to the current conversation.

## What happens next

- The tool returns immediately with a \`taskId\`
- A background agent runs the research using \`read_file\`, \`list_dir\`, and \`safe_bash\`
- When done, a summary will be injected into this conversation automatically
- The artifact is saved to the project workspace

## Examples of good queries

- "Summarise the API surface of all TypeScript files in src/main/services/ — list public methods and their signatures"
- "Find all usages of the IProjectRepository interface and list every call site"
- "Read README.md and CLAUDE.md and write a one-page onboarding guide for a new developer"
`;

export const DISCOVER_PROJECT_SKILL = `---
name: discover_project
description: Walk and document a linked project folder. Use automatically when a project has a folderPath but no AGENTS.md exists yet.
---

# discover_project

When a project has a linked folder but \`~/.research-assistant/projects/<slug>/AGENTS.md\` does not exist yet, run project discovery automatically at the start of the first message.

## Discovery steps

1. Call \`list_dir({ path: "<folderPath>" })\` to see top-level structure
2. For each interesting item (README, package.json, CLAUDE.md, AGENTS.md, src/, docs/), call \`read_file\` to understand the project
3. Write \`~/.research-assistant/projects/<slug>/AGENTS.md\` using \`write_file\` with the template below
4. Tell the user: "I've read your project structure and written a context file. Ready to help."

## AGENTS.md template

\`\`\`markdown
# <Project Name> — Agent Context

## What this project is
<one paragraph>

## Folder structure
<bullet list of key dirs/files and their purpose>

## Key files
<list of important files to know>

## Conventions
<naming, code style, any patterns observed>

## Notes
<anything else the agent should know>
\`\`\`

## Slug format

Slug = project name, lowercased, spaces → hyphens, non-alphanumeric stripped.
Example: "My Cool Project!" → "my-cool-project"
`;
```

- [ ] **Step 4: Implement HomeService**

```typescript
// src/main/services/HomeService.ts
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { injectable } from "tsyringe";
import { DISCOVER_PROJECT_SKILL, START_RESEARCH_SKILL } from "../agent/builtin-skills";

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

  private async copyBuiltinSkillsIfNeeded(): Promise<void> {
    const skillsDir = join(this.getHomePath(), "skills");
    let entries: string[] = [];
    try {
      entries = await readdir(skillsDir);
    } catch {
      // dir doesn't exist yet — ensureDirectories just created it
    }
    if (entries.length > 0) return;

    const builtins: Array<[string, string]> = [
      ["start_research", START_RESEARCH_SKILL],
      ["discover_project", DISCOVER_PROJECT_SKILL],
    ];

    for (const [name, content] of builtins) {
      const skillDir = join(skillsDir, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
    }
  }
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/builtin-skills.ts \
  src/main/services/HomeService.ts \
  src/main/services/__tests__/HomeService.test.ts
git commit -m "feat(run6): HomeService — dir bootstrap, first-run check, builtin skills"
```

---

## Task 5: PathJail

**Files:**
- Create: `src/main/agent/path-jail.ts`
- Create: `src/main/agent/path-jail.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent/path-jail.test.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathJail } from "./path-jail";

const HOME = join(homedir(), ".research-assistant");
const PROJECT_ID = "proj-123";
const FOLDER_PATH = "/Users/test/myproject";

describe("PathJail", () => {
  describe("with folderPath", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH);

    it("allows read inside workspace", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside workspace", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside project folder", () => {
      const p = join(FOLDER_PATH, "src", "index.ts");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("allows write inside project folder", () => {
      const p = join(FOLDER_PATH, "output.md");
      expect(() => jail.validate(p, "write")).not.toThrow();
    });

    it("allows read inside ~/.research-assistant/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks write to ~/.research-assistant/skills", () => {
      const p = join(HOME, "skills", "start_research", "SKILL.md");
      expect(() => jail.validate(p, "write")).toThrow(/read-only/);
    });

    it("allows read inside ~/.agents/skills", () => {
      const p = join(homedir(), ".agents", "skills", "myplugin", "SKILL.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks write to ~/.agents/skills", () => {
      const p = join(homedir(), ".agents", "skills", "myplugin", "SKILL.md");
      expect(() => jail.validate(p, "write")).toThrow(/read-only/);
    });

    it("blocks access outside all allowed zones", () => {
      expect(() => jail.validate("/etc/passwd", "read")).toThrow(/not allowed/);
    });

    it("blocks path traversal attempts", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "../../etc/passwd");
      expect(() => jail.validate(p, "read")).toThrow(/not allowed/);
    });
  });

  describe("without folderPath", () => {
    const jail = new PathJail(PROJECT_ID, null);

    it("allows workspace access", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "file.md");
      expect(() => jail.validate(p, "read")).not.toThrow();
    });

    it("blocks project folder access when no folder linked", () => {
      expect(() => jail.validate("/Users/test/myproject/src/index.ts", "read")).toThrow(
        /not allowed/,
      );
    });
  });

  describe("returns resolved absolute path", () => {
    const jail = new PathJail(PROJECT_ID, FOLDER_PATH);

    it("resolves and returns the path", () => {
      const p = join(HOME, "workspace", PROJECT_ID, "output.md");
      const result = jail.validate(p, "read");
      expect(result).toBe(p);
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/agent/path-jail.test.ts
```

Expected: FAIL — `PathJail` not found.

- [ ] **Step 3: Implement PathJail**

```typescript
// src/main/agent/path-jail.ts
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";

export class PathJail {
  private readonly workspace: string;
  private readonly home: string;
  private readonly agentsSkills: string;
  private readonly homeSkills: string;
  private readonly projectFolder: string | null;
  // project-level skill dirs (read-only)
  private readonly projectAgentsSkills: string | null;
  private readonly projectHomeSkills: string | null;

  constructor(
    private readonly projectId: string,
    folderPath: string | null,
  ) {
    this.home = join(homedir(), ".research-assistant");
    this.workspace = join(this.home, "workspace", projectId);
    this.homeSkills = join(this.home, "skills");
    this.agentsSkills = join(homedir(), ".agents", "skills");
    this.projectFolder = folderPath;
    this.projectAgentsSkills = folderPath ? join(folderPath, ".agents", "skills") : null;
    this.projectHomeSkills = folderPath
      ? join(folderPath, ".research-assistant", "skills")
      : null;
  }

  validate(inputPath: string, mode: "read" | "write"): string {
    const resolved = resolve(normalize(inputPath));

    const readWriteZones = [this.workspace, ...(this.projectFolder ? [this.projectFolder] : [])];
    const readOnlyZones = [
      this.homeSkills,
      this.agentsSkills,
      ...(this.projectAgentsSkills ? [this.projectAgentsSkills] : []),
      ...(this.projectHomeSkills ? [this.projectHomeSkills] : []),
    ];

    const inZone = (zones: string[]) => zones.some((z) => resolved.startsWith(z + "/") || resolved === z);

    if (inZone(readWriteZones)) return resolved;

    if (inZone(readOnlyZones)) {
      if (mode === "write") {
        throw new Error(
          `Path "${resolved}" is in a read-only zone (skills directory). Use a workspace or project folder path instead.`,
        );
      }
      return resolved;
    }

    throw new Error(
      `Path "${resolved}" is not allowed. Permitted zones: workspace (${this.workspace}), project folder${this.projectFolder ? ` (${this.projectFolder})` : " (none linked)"}, skills directories.`,
    );
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/agent/path-jail.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/path-jail.ts src/main/agent/path-jail.test.ts
git commit -m "feat(run6): PathJail — enforce read/write zones with path traversal protection"
```

---

## Task 6: context.ts — loadSkills + buildSystemContext

**Files:**
- Create: `src/main/agent/context.ts`
- Create: `src/main/agent/context.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent/context.test.ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => tmpHome };
});

const { loadSkills, buildSystemContext } = await import("./context");

describe("loadSkills", () => {
  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string when no skill dirs exist", async () => {
    const result = await loadSkills(undefined);
    expect(result).toBe("");
  });

  it("returns XML with skills found in ~/.research-assistant/skills", async () => {
    const skillDir = join(tmpHome, ".research-assistant", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Does something useful.\n---\n# Content`,
    );

    const result = await loadSkills(undefined);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("<name>my-skill</name>");
    expect(result).toContain("<description>Does something useful.</description>");
    expect(result).toContain("SKILL.md</location>");
  });

  it("project-level skill overrides global when same name", async () => {
    const globalDir = join(tmpHome, ".research-assistant", "skills", "shared-skill");
    const projectDir = join("/tmp/myproject", ".agents", "skills", "shared-skill");

    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "SKILL.md"),
      `---\nname: shared-skill\ndescription: Global version.\n---`,
    );

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "SKILL.md"),
      `---\nname: shared-skill\ndescription: Project version.\n---`,
    );

    const result = await loadSkills("/tmp/myproject");
    expect(result).toContain("Project version.");
    expect(result).not.toContain("Global version.");

    await rm("/tmp/myproject", { recursive: true, force: true });
  });
});

describe("buildSystemContext", () => {
  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    tmpHome = await mkdtemp(join(tmpdir(), "ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string when no context files exist", async () => {
    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toBe("");
  });

  it("includes config.md content when present", async () => {
    const home = join(tmpHome, ".research-assistant");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "config.md"), "# My working style\nI prefer folders.");

    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toContain("I prefer folders.");
  });

  it("includes AGENTS.md content when present", async () => {
    const home = join(tmpHome, ".research-assistant");
    const slug = "my-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# My Project context\nThis is a TypeScript monorepo.",
    );

    const result = await buildSystemContext("proj-1", "my project", undefined);
    expect(result).toContain("TypeScript monorepo.");
  });

  it("generates correct slug from project name", async () => {
    const home = join(tmpHome, ".research-assistant");
    // "My Cool Project!" → "my-cool-project"
    const slug = "my-cool-project";
    await mkdir(join(home, "projects", slug), { recursive: true });
    await writeFile(
      join(home, "projects", slug, "AGENTS.md"),
      "# Context for cool project.",
    );

    const result = await buildSystemContext("proj-1", "My Cool Project!", undefined);
    expect(result).toContain("Context for cool project.");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/agent/context.test.ts
```

Expected: FAIL — `context.ts` not found.

- [ ] **Step 3: Implement context.ts**

```typescript
// src/main/agent/context.ts
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

interface SkillMeta {
  name: string;
  description: string;
  location: string;
}

async function readSkillsFromDir(dir: string): Promise<SkillMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: SkillMeta[] = [];
  for (const entry of entries) {
    const skillMdPath = join(dir, entry, "SKILL.md");
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name && meta.description) {
        skills.push({ name: meta.name, description: meta.description, location: skillMdPath });
      }
    } catch {
      // skip malformed or missing SKILL.md
    }
  }
  return skills;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!match) return {};
  try {
    return (parse(match[1]) as { name?: string; description?: string }) ?? {};
  } catch {
    return {};
  }
}

export async function loadSkills(projectFolderPath: string | undefined): Promise<string> {
  const home = join(homedir(), ".research-assistant");
  const agents = join(homedir(), ".agents");

  // Load in priority order — later entries win on name collision
  const dirs = [
    join(agents, "skills"),
    join(home, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath
      ? [join(projectFolderPath, ".research-assistant", "skills")]
      : []),
  ];

  const byName = new Map<string, SkillMeta>();
  for (const dir of dirs) {
    const skills = await readSkillsFromDir(dir);
    for (const skill of skills) {
      byName.set(skill.name, skill);
    }
  }

  if (byName.size === 0) return "";

  const lines = ["<available_skills>"];
  for (const skill of byName.values()) {
    lines.push(
      `  <skill>`,
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      `    <location>${skill.location}</location>`,
      `  </skill>`,
    );
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function buildSystemContext(
  _projectId: string,
  projectName: string,
  folderPath: string | undefined,
): Promise<string> {
  const home = join(homedir(), ".research-assistant");
  const slug = toSlug(projectName);
  const parts: string[] = [];

  // 1. config.md
  try {
    const config = await readFile(join(home, "config.md"), "utf-8");
    if (config.trim()) {
      parts.push("<!-- User working style (config.md) -->", config.trim());
    }
  } catch {
    // not present yet
  }

  // 2. skills
  const skillsXml = await loadSkills(folderPath);
  if (skillsXml) parts.push(skillsXml);

  // 3. AGENTS.md
  try {
    const agents = await readFile(join(home, "projects", slug, "AGENTS.md"), "utf-8");
    if (agents.trim()) {
      parts.push("<!-- Project context (AGENTS.md) -->", agents.trim());
    }
  } catch {
    // not yet discovered
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/agent/context.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/context.ts src/main/agent/context.test.ts
git commit -m "feat(run6): context.ts — loadSkills (4 dirs) + buildSystemContext"
```

---

## Task 7: safe-bash extension

**Files:**
- Create: `src/main/agent/extensions/safe-bash.ts`
- Create: `src/main/agent/extensions/safe-bash.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/agent/extensions/safe-bash.test.ts
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBlocklist, runSafeBash } from "./safe-bash";

describe("checkBlocklist", () => {
  it("throws on rm -rf", () => {
    expect(() => checkBlocklist("rm -rf /tmp/test")).toThrow(/blocked/i);
  });

  it("throws on sudo", () => {
    expect(() => checkBlocklist("sudo apt-get install curl")).toThrow(/blocked/i);
  });

  it("throws on curl", () => {
    expect(() => checkBlocklist("curl https://example.com")).toThrow(/blocked/i);
  });

  it("throws on wget", () => {
    expect(() => checkBlocklist("wget https://example.com")).toThrow(/blocked/i);
  });

  it("throws on eval", () => {
    expect(() => checkBlocklist("eval $(cat /etc/passwd)")).toThrow(/blocked/i);
  });

  it("throws on backtick subshell", () => {
    expect(() => checkBlocklist("echo `id`")).toThrow(/blocked/i);
  });

  it("throws on $() subshell", () => {
    expect(() => checkBlocklist("echo $(id)")).toThrow(/blocked/i);
  });

  it("allows safe commands", () => {
    expect(() => checkBlocklist("ls -la")).not.toThrow();
    expect(() => checkBlocklist("cat README.md")).not.toThrow();
    expect(() => checkBlocklist("bun run test")).not.toThrow();
  });
});

describe("runSafeBash", () => {
  let workDir: string;
  let auditLogPath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "safebash-test-"));
    auditLogPath = join(workDir, "audit.log");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs a command and returns stdout", async () => {
    const result = await runSafeBash({
      command: "echo hello",
      intent: "test echo",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("returns non-zero exitCode on failure", async () => {
    const result = await runSafeBash({
      command: "exit 1",
      intent: "test failure",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.exitCode).toBe(1);
  });

  it("captures stderr", async () => {
    const result = await runSafeBash({
      command: "echo error >&2",
      intent: "test stderr",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.stderr).toContain("error");
  });

  it("truncates output exceeding 2KB", async () => {
    // Generate > 2KB output
    const result = await runSafeBash({
      command: "python3 -c \"print('x' * 3000)\" 2>/dev/null || node -e \"console.log('x'.repeat(3000))\" 2>/dev/null || dd if=/dev/zero bs=3000 count=1 2>/dev/null | tr '\\0' 'x'",
      intent: "test truncation",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(2200); // 2048 + truncation message
  });

  it("appends to audit log", async () => {
    await runSafeBash({
      command: "echo audit-test",
      intent: "testing audit",
      projectId: "p1",
      workspacePath: workDir,
      auditLogPath,
    });
    const log = await readFile(auditLogPath, "utf-8");
    expect(log).toContain("testing audit");
    expect(log).toContain("echo audit-test");
  });

  it("rejects blocklisted commands before execution", async () => {
    await expect(
      runSafeBash({
        command: "sudo rm -rf /",
        intent: "bad intent",
        projectId: "p1",
        workspacePath: workDir,
        auditLogPath,
      }),
    ).rejects.toThrow(/blocked/i);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create extensions directory and implement safe-bash.ts**

```typescript
// src/main/agent/extensions/safe-bash.ts
import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const BLOCKLIST_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bsudo\b/,
  /\bchmod\s+\+x\b/,
  /\bmkfs\b/,
  /\bdd\b\s+if=/,
  /\bcurl\b/,
  /\bwget\b/,
  /\beval\b/,
  /`/,
  /\$\(/,
];

export function checkBlocklist(command: string): void {
  for (const pattern of BLOCKLIST_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        `Command blocked by safe_bash policy (matched: ${pattern.toString()}). Use a safer alternative or request a skill.`,
      );
    }
  }
}

export interface SafeBashOptions {
  command: string;
  intent: string;
  projectId: string;
  workspacePath: string;
  auditLogPath: string;
  timeoutMs?: number;
}

export interface SafeBashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

const MAX_OUTPUT_BYTES = 2048;

export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const { command, intent, projectId, workspacePath, auditLogPath, timeoutMs = 30_000 } = opts;

  checkBlocklist(command);

  return new Promise<SafeBashResult>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const proc = spawn("bash", ["-c", command], {
      cwd: workspacePath,
      signal: controller.signal,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
        if (stdout.length >= MAX_OUTPUT_BYTES) {
          truncated = true;
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
        if (stderr.length >= MAX_OUTPUT_BYTES) {
          truncated = true;
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") {
        resolve({ stdout, stderr: "Timeout: command exceeded 30s limit.", exitCode: 124, truncated });
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (truncated) {
        stdout += `\n[truncated — output exceeded ${MAX_OUTPUT_BYTES} bytes]`;
      }

      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        projectId,
        intent,
        command,
        exitCode: code ?? 1,
      });

      // Append to audit log async — do not block resolution
      appendFile(auditLogPath, entry + "\n", "utf-8").catch(console.error);

      resolve({ stdout, stderr, exitCode: code ?? 1, truncated });
    });
  });
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts
```

Expected: all pass. (The truncation test may be flaky if `python3`/`node` unavailable — skip if needed, the unit is tested.)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat(run6): safe_bash extension — blocklist, timeout, output cap, audit log"
```

---

## Task 8: createAgentTools factory

**Files:**
- Create: `src/main/agent/tools.ts`

No separate test file — tools are thin wrappers; correctness tested via PathJail (Task 5) and safe-bash (Task 7) unit tests. Integration covered by session tests in Task 9.

- [ ] **Step 1: Install @sinclair/typebox if not already a direct dep**

```bash
bun add @sinclair/typebox
```

- [ ] **Step 2: Implement tools.ts**

```typescript
// src/main/agent/tools.ts
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { PathJail } from "./path-jail";
import { runSafeBash } from "./extensions/safe-bash";
import { join } from "node:path";

export interface AgentToolsOptions {
  projectId: string;
  projectName: string;
  folderPath: string | null;
  homePath: string;
  startResearchFn?: (query: string) => Promise<{ taskId: string }>;
}

export function createAgentTools(opts: AgentToolsOptions): AgentTool[] {
  const { projectId, folderPath, homePath, startResearchFn } = opts;
  const jail = new PathJail(projectId, folderPath);
  const workspacePath = join(homePath, "workspace", projectId);
  const auditLogPath = join(homePath, "audit.log");

  const tools: AgentTool[] = [
    {
      name: "read_file",
      label: "Read file",
      description:
        "Read the contents of a file. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file" }),
      }),
      execute: async (_id, { path }) => {
        const resolved = jail.validate(path, "read");
        const content = await readFile(resolved, "utf-8");
        return { content: [{ type: "text" as const, text: content }], details: null };
      },
    },

    {
      name: "write_file",
      label: "Write file",
      description:
        "Write content to a file, creating parent directories as needed. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file" }),
        content: Type.String({ description: "Content to write" }),
      }),
      execute: async (_id, { path, content }) => {
        const resolved = jail.validate(path, "write");
        const dir = resolved.substring(0, resolved.lastIndexOf("/"));
        await mkdir(dir, { recursive: true });
        await writeFile(resolved, content, "utf-8");
        return {
          content: [{ type: "text" as const, text: `Written: ${resolved}` }],
          details: null,
        };
      },
    },

    {
      name: "list_dir",
      label: "List directory",
      description:
        "List files and subdirectories in a directory. Path must be within the workspace or linked project folder.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the directory" }),
      }),
      execute: async (_id, { path }) => {
        const resolved = jail.validate(path, "read");
        const entries = await readdir(resolved, { withFileTypes: true });
        const lines = entries.map(
          (e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`,
        );
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: entries.map((e) => e.name),
        };
      },
    },

    {
      name: "safe_bash",
      label: "Run safe bash command",
      description:
        "Execute a bash command in the project workspace. Always state your intent. Blocked commands: rm -rf, sudo, curl, wget, eval, subshells.",
      parameters: Type.Object({
        command: Type.String({ description: "The bash command to run" }),
        intent: Type.String({
          description: "What you are trying to accomplish with this command",
        }),
      }),
      execute: async (_id, { command, intent }) => {
        // Ensure workspace dir exists
        await mkdir(workspacePath, { recursive: true });
        const result = await runSafeBash({
          command,
          intent,
          projectId,
          workspacePath,
          auditLogPath,
        });
        const summary = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
          result.truncated ? "[output was truncated]" : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: summary }],
          details: result,
        };
      },
    },
  ];

  if (startResearchFn) {
    tools.push({
      name: "start_research",
      label: "Start background research",
      description:
        "Dispatch a background research task. Returns immediately with a taskId. A summary will be injected into this conversation when the research completes.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "A clear, self-contained research question including all necessary context",
        }),
      }),
      execute: async (_id, { query }) => {
        const { taskId } = await startResearchFn(query);
        return {
          content: [
            {
              type: "text" as const,
              text: `Research task started (taskId: ${taskId}). I'll report back when it completes.`,
            },
          ],
          details: { taskId },
        };
      },
    });
  }

  return tools;
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors in tools.ts.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/tools.ts
git commit -m "feat(run6): createAgentTools — read_file, write_file, list_dir, safe_bash, start_research"
```

---

## Task 9: AgentSession refactor

**Files:**
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/agent/session.test.ts`

- [ ] **Step 1: Write new failing tests (add alongside existing ones)**

Add to `src/main/agent/session.test.ts`:

```typescript
// Add mockAgent properties for new features:
const mockAgent = {
  subscribe: vi.fn((cb) => { capturedSubscriber = cb; }),
  prompt: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn(),
  followUp: vi.fn(),
  state: { tools: [] as AgentTool[], isStreaming: false },
};

// Update AgentSession constructor mock options helper:
function makeHomeService(firstRun = false) {
  return { isFirstRun: vi.fn().mockResolvedValue(firstRun) };
}

function makeResearchService() {
  return {
    startResearch: vi.fn().mockResolvedValue({ taskId: "task-1" }),
  };
}
```

Add test cases:

```typescript
describe("first-run prompt injection", () => {
  it("includes first-run interview instructions when isFirstRun=true", () => {
    const { Agent } = require("@mariozechner/pi-agent-core");
    const constructorCall = vi.mocked(Agent).mock.calls.at(-1);
    const options = constructorCall[0] as { initialState: { systemPrompt: string } };
    // AgentSession with isFirstRun=true should have interview text in systemPrompt
    const sessionWithFirstRun = new AgentSession({
      win,
      messageService: messageService as never,
      homeService: makeHomeService(true) as never,
      researchService: makeResearchService() as never,
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: true,
    });
    // The session should have been constructed — isFirstRun instructions added
    // We verify by checking Agent was called with systemPrompt containing interview text
    const lastCall = vi.mocked(Agent).mock.calls.at(-1);
    expect(lastCall![0].initialState.systemPrompt).toContain("How do you organise your projects");
  });

  it("does not include first-run instructions when isFirstRun=false", () => {
    new AgentSession({
      win,
      messageService: messageService as never,
      homeService: makeHomeService(false) as never,
      researchService: makeResearchService() as never,
      projectId: "p-1",
      projectName: "Test",
      folderPath: null,
      apiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
      isFirstRun: false,
    });
    const lastCall = vi.mocked(Agent).mock.calls.at(-1);
    expect(lastCall![0].initialState.systemPrompt).not.toContain("How do you organise");
  });
});

describe("queueFollowUp", () => {
  it("calls agent.followUp with the message", () => {
    session.queueFollowUp("Research complete: found 5 files.");
    expect(mockAgent.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "Research complete: found 5 files." }),
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
bun run test src/main/agent/session.test.ts
```

Expected: FAIL on new tests.

- [ ] **Step 3: Update session.ts**

```typescript
// src/main/agent/session.ts
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { buildSystemContext } from "./context";
import { createAgentTools } from "./tools";
import type { MessageService } from "../services/MessageService";
import type { HomeService } from "../services/HomeService";
import type { ResearchService } from "../services/ResearchService";

const FIRST_RUN_PROMPT = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;

const BASE_SYSTEM_PROMPT = "You are a helpful research assistant.";

interface AgentSessionOptions {
  win: BrowserWindow;
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  apiKey: string;
  model: string;
  isFirstRun: boolean;
  systemContext?: string; // pre-built context, optional
}

export class AgentSession {
  private readonly agent: Agent;
  private readonly win: BrowserWindow;
  private readonly messageService: MessageService;
  private readonly projectId: string;
  private assistantContent = "";

  constructor({
    win,
    messageService,
    homeService,
    researchService,
    projectId,
    projectName,
    folderPath,
    apiKey,
    model,
    isFirstRun,
    systemContext = "",
  }: AgentSessionOptions) {
    this.win = win;
    this.messageService = messageService;
    this.projectId = projectId;

    const homePath = homeService.getHomePath();

    const systemPrompt = [
      isFirstRun ? FIRST_RUN_PROMPT : BASE_SYSTEM_PROMPT,
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model: getModel("openrouter", model as never),
      },
      getApiKey: async () => apiKey,
      beforeToolCall: async (ctx) => {
        const allowed = new Set(this.agent.state.tools.map((t) => t.name));
        if (!allowed.has(ctx.toolCall.name)) {
          return { block: true, reason: `Tool "${ctx.toolCall.name}" is not registered.` };
        }
        return undefined;
      },
    });

    // Register tools — start_research calls ResearchService
    this.agent.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
      startResearchFn: (query) =>
        researchService.startResearch(projectId, projectName, query, folderPath),
    });

    this.agent.subscribe(async (event) => {
      try {
        const e = event as {
          type: string;
          assistantMessageEvent?: { type: string; delta: string };
          messages?: unknown[];
        };

        if (e.type === "message_update") {
          const ae = e.assistantMessageEvent;
          if (ae?.type === "text_delta") {
            this.assistantContent += ae.delta;
            this.win.webContents.send(IPC.MESSAGE_CHUNK, ae.delta);
          }
        } else if (e.type === "agent_end") {
          if (this.assistantContent) {
            await this.messageService.addMessage({
              projectId: this.projectId,
              role: "assistant",
              content: this.assistantContent,
            });
            this.assistantContent = "";
          }
          this.win.webContents.send(IPC.MESSAGE_DONE);
        }
      } catch (err) {
        console.error("[AgentSession] subscriber error:", err);
        this.win.webContents.send(IPC.MESSAGE_DONE);
      }
    });
  }

  async send(content: string): Promise<void> {
    await this.messageService.addMessage({
      projectId: this.projectId,
      role: "user",
      content,
    });
    await this.agent.prompt(content);
  }

  queueFollowUp(content: string): void {
    this.agent.followUp({ role: "user", content, timestamp: Date.now() });
  }

  abort(): void {
    this.agent.abort();
  }
}
```

- [ ] **Step 4: Run all session tests — confirm they pass**

```bash
bun run test src/main/agent/session.test.ts
```

Expected: all pass (update existing `makeWin`/`makeMessageService` test helpers to pass new required options).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat(run6): AgentSession — Pi tools, first-run prompt, queueFollowUp"
```

---

## Task 10: ResearchService

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/services/__tests__/ResearchService.test.ts
import "reflect-metadata";
import { describe, expect, it, vi, beforeEach } from "vitest";

let capturedSubscriber: ((event: unknown) => void) | null = null;

const mockWorker = {
  state: { tools: [] },
  subscribe: vi.fn((cb) => { capturedSubscriber = cb; }),
  prompt: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: vi.fn(() => mockWorker),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("../agent/context", () => ({
  buildSystemContext: vi.fn().mockResolvedValue("mock context"),
  toSlug: vi.fn().mockReturnValue("test-project"),
}));

vi.mock("../agent/tools", () => ({
  createAgentTools: vi.fn().mockReturnValue([]),
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
    createArtifact: vi.fn().mockResolvedValue({
      id: "art-1",
      filePath: "/workspace/output.md",
    }),
  };
}

function makeSettingsService() {
  return {
    getSettings: vi.fn().mockResolvedValue({
      openrouterApiKey: "sk-or-test",
      model: "anthropic/claude-sonnet-4-6",
    }),
  };
}

function makeHomeService() {
  return {
    getHomePath: vi.fn().mockReturnValue("/tmp/.research-assistant"),
    ensureWorkspaceForProject: vi.fn().mockResolvedValue("/tmp/.research-assistant/workspace/p1"),
  };
}

describe("ResearchService", () => {
  let service: InstanceType<typeof ResearchService>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscriber = null;
    service = new ResearchService(
      makeEventBus() as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
  });

  it("returns taskId immediately without awaiting worker", async () => {
    const { taskId } = await service.startResearch("p1", "My Project", "research query", null);
    expect(taskId).toBeTypeOf("string");
    expect(taskId).toHaveLength(36);
  });

  it("fires research:started on EventBus", async () => {
    const eventBus = makeEventBus();
    service = new ResearchService(
      eventBus as never,
      makeArtifactService() as never,
      makeSettingsService() as never,
      makeHomeService() as never,
    );
    await service.startResearch("p1", "My Project", "query", null);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "research:started" }),
    );
  });

  it("spawns a Pi Agent with researcher system prompt", async () => {
    const { Agent } = await import("@mariozechner/pi-agent-core");
    await service.startResearch("p1", "My Project", "summarise the codebase", null);
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        initialState: expect.objectContaining({
          systemPrompt: expect.stringContaining("researcher"),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement ResearchService**

```typescript
// src/main/services/ResearchService.ts
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { inject, injectable } from "tsyringe";
import { ARTIFACT_REPO_TOKEN, RESEARCH_SERVICE_DEPS } from "../di/tokens";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";
import type { ArtifactService } from "./ArtifactService";
import type { EventBus } from "../event-bus";
import type { SettingsService } from "./SettingsService";
import type { HomeService } from "./HomeService";
import { buildSystemContext } from "../agent/context";
import { createAgentTools } from "../agent/tools";
import { join } from "node:path";

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

    const systemContext = await buildSystemContext(projectId, projectName, folderPath ?? undefined);

    const systemPrompt = [
      "You are a background research assistant. Your job is to investigate the given query thoroughly using the available tools, then write a comprehensive Markdown report to the workspace file 'output.md'. Be thorough. When done, respond with a final summary of your findings.",
      systemContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    const worker = new Agent({
      initialState: {
        systemPrompt,
        model: getModel("openrouter", settings.model as never),
      },
      getApiKey: async () => settings.openrouterApiKey!,
    });

    // Register tools — no start_research (no recursive dispatch)
    worker.state.tools = createAgentTools({
      projectId,
      projectName,
      folderPath,
      homePath,
    });

    this.eventBus.emit({
      type: "research:started",
      payload: { taskId, projectId, query },
    });

    let workerOutput = "";

    worker.subscribe(async (event) => {
      const e = event as {
        type: string;
        assistantMessageEvent?: { type: string; delta: string };
        messages?: unknown[];
      };

      if (e.type === "message_update") {
        const ae = e.assistantMessageEvent;
        if (ae?.type === "text_delta") {
          workerOutput += ae.delta;
          this.eventBus.emit({
            type: "research:progress",
            payload: { taskId, message: ae.delta },
          });
        }
      } else if (e.type === "agent_end") {
        try {
          const outputPath = join(homePath, "workspace", projectId, "output.md");
          const artifact = await this.artifactService.createArtifact({
            projectId,
            title: `Research: ${query.slice(0, 60)}`,
            filePath: outputPath,
          });
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
          this.eventBus.emit({
            type: "research:failed",
            payload: { taskId, error: String(err) },
          });
        }
      }
    });

    // Fire-and-forget — caller gets taskId immediately
    worker.prompt(query).catch((err) => {
      console.error("[ResearchService] worker error:", err);
      this.eventBus.emit({
        type: "research:failed",
        payload: { taskId, error: String(err) },
      });
    });

    return { taskId };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(run6): ResearchService.startResearch — background Pi agent + EventBus"
```

---

## Task 11: EventBus — add research:complete payload + update event types

**Files:**
- Modify: `src/main/event-bus.ts`

- [ ] **Step 1: Update AppEvent discriminated union to carry all needed fields**

```typescript
// src/main/event-bus.ts
import { EventEmitter } from "node:events";
import { injectable } from "tsyringe";

type AppEvent =
  | { type: "research:started"; payload: { taskId: string; projectId: string; query: string } }
  | { type: "research:progress"; payload: { taskId: string; message: string } }
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
  | { type: "research:failed"; payload: { taskId: string; error: string } };

@injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  emit<T extends AppEvent>(event: T): void {
    this.emitter.emit(event.type, event.payload);
  }

  on<K extends AppEvent["type"]>(
    type: K,
    handler: (payload: Extract<AppEvent, { type: K }>["payload"]) => void,
  ): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }
}
```

- [ ] **Step 2: Run tests**

```bash
bun run test src/main/event-bus.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/event-bus.ts
git commit -m "feat(run6): EventBus — extend research:complete payload"
```

---

## Task 12: DI tokens + bootstrap + IPC handlers

**Files:**
- Modify: `src/main/di/tokens.ts`
- Modify: `src/main/bootstrap.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Add new DI tokens**

```typescript
// src/main/di/tokens.ts
import type { InjectionToken } from "tsyringe";
import type { DrizzleDB } from "../db/client";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";
import type { IMessageRepository } from "../repositories/IMessageRepository";
import type { IProjectRepository } from "../repositories/IProjectRepository";

export const DB_TOKEN: InjectionToken<DrizzleDB> = Symbol("DrizzleDB");
export const PROJECT_REPO_TOKEN: InjectionToken<IProjectRepository> = Symbol("IProjectRepository");
export const MESSAGE_REPO_TOKEN: InjectionToken<IMessageRepository> = Symbol("IMessageRepository");
export const ARTIFACT_REPO_TOKEN: InjectionToken<IArtifactRepository> =
  Symbol("IArtifactRepository");
export const USER_DATA_PATH_TOKEN: InjectionToken<string> = Symbol("userDataPath");
export const AGENT_HOME_PATH_TOKEN: InjectionToken<string> = Symbol("agentHomePath");
```

- [ ] **Step 2: Update bootstrap to register HomeService and call ensureDirectories**

```typescript
// src/main/bootstrap.ts
import { join } from "node:path";
import { app } from "electron";
import { container, type DependencyContainer } from "tsyringe";
import { createDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import {
  AGENT_HOME_PATH_TOKEN,
  ARTIFACT_REPO_TOKEN,
  DB_TOKEN,
  MESSAGE_REPO_TOKEN,
  PROJECT_REPO_TOKEN,
  USER_DATA_PATH_TOKEN,
} from "./di/tokens";
import { EventBus } from "./event-bus";
import { DrizzleArtifactRepository } from "./repositories/drizzle/DrizzleArtifactRepository";
import { DrizzleMessageRepository } from "./repositories/drizzle/DrizzleMessageRepository";
import { DrizzleProjectRepository } from "./repositories/drizzle/DrizzleProjectRepository";
import { ArtifactService } from "./services/ArtifactService";
import { FileService } from "./services/FileService";
import { HomeService } from "./services/HomeService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

export async function bootstrap(): Promise<DependencyContainer> {
  const userDataPath = app.getPath("userData");
  const dbPath = join(userDataPath, "research-assistant.db");
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const appContainer = container.createChildContainer();

  appContainer.registerInstance(DB_TOKEN, db);
  appContainer.registerInstance(USER_DATA_PATH_TOKEN, userDataPath);

  appContainer.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  appContainer.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  appContainer.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  appContainer.registerSingleton(ProjectService);
  appContainer.registerSingleton(MessageService);
  appContainer.registerSingleton(ArtifactService);
  appContainer.registerSingleton(FileService);
  appContainer.registerSingleton(EventBus);
  appContainer.registerSingleton(SettingsService);
  appContainer.registerSingleton(HomeService);
  appContainer.registerSingleton(ResearchService);

  // Bootstrap home directory — must run before any agent session
  const homeService = appContainer.resolve(HomeService);
  await homeService.ensureDirectories();
  appContainer.registerInstance(AGENT_HOME_PATH_TOKEN, homeService.getHomePath());

  return appContainer;
}
```

- [ ] **Step 3: Update ipc-handlers.ts — new handlers + EventBus→IPC wiring + research followUp**

```typescript
// src/main/ipc-handlers.ts
import { dialog, shell, type BrowserWindow, ipcMain } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { AgentSession } from "./agent/session";
import { buildSystemContext } from "./agent/context";
import { ArtifactService } from "./services/ArtifactService";
import { EventBus } from "./event-bus";
import { HomeService } from "./services/HomeService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);
  const homeService = container.resolve(HomeService);
  const researchService = container.resolve(ResearchService);
  const eventBus = container.resolve(EventBus);

  const sessions = new Map<string, AgentSession>();

  // ── Standard handlers ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_PROJECTS, async () => projectService.listProjects());

  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { name: string }");
    }
    const p = payload as { name: string; folderPath?: string };
    return projectService.createProject(p.name, p.folderPath ?? null);
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return artifactService.listArtifacts((payload as { projectId: string }).projectId);
  });

  ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return messageService.getHistory((payload as { projectId: string }).projectId);
  });

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    const settings = await settingsService.getSettings();
    return {
      hasApiKey: settings.openrouterApiKey !== null && settings.openrouterApiKey !== "",
      openrouterApiKey: settings.openrouterApiKey,
      model: settings.model,
    };
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid payload");
    }
    const p = payload as Record<string, unknown>;
    if ("model" in p && typeof p.model !== "string") {
      throw new Error("model must be a string");
    }
    if (
      "openrouterApiKey" in p &&
      p.openrouterApiKey !== null &&
      typeof p.openrouterApiKey !== "string"
    ) {
      throw new Error("openrouterApiKey must be a string or null");
    }
    await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);
    if ("model" in p) {
      sessions.clear();
    }
  });

  // ── New Run 6 handlers ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.LINK_FOLDER, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string" ||
      typeof (payload as { folderPath?: unknown }).folderPath !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string, folderPath: string }");
    }
    const { projectId, folderPath } = payload as { projectId: string; folderPath: string };
    await projectService.linkFolder(projectId, folderPath);
    // Invalidate session so next message picks up the new folderPath
    sessions.delete(projectId);
  });

  // ── EventBus → IPC forwarder ───────────────────────────────────────────────

  eventBus.on("research:started", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "started",
      ...payload,
    });
  });

  eventBus.on("research:progress", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "progress",
      ...payload,
    });
  });

  eventBus.on("research:complete", (payload) => {
    win.webContents.send(IPC.RESEARCH_COMPLETE, payload);
    // Inject summary into the main agent session for this project
    const session = sessions.get(payload.projectId);
    if (session) {
      session.queueFollowUp(
        `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${payload.filePath}. Please briefly summarise the findings for the user.`,
      );
    }
  });

  eventBus.on("research:failed", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, {
      status: "failed",
      ...payload,
    });
  });

  // ── SEND_MESSAGE ───────────────────────────────────────────────────────────

  ipcMain.on(IPC.SEND_MESSAGE, (_event, payload: unknown) => {
    void (async () => {
      try {
        if (
          typeof payload !== "object" ||
          payload === null ||
          typeof (payload as { projectId?: unknown }).projectId !== "string" ||
          typeof (payload as { content?: unknown }).content !== "string"
        ) {
          console.error("[IPC] SEND_MESSAGE: invalid payload", payload);
          return;
        }
        const { projectId, content } = payload as { projectId: string; content: string };

        const settings = await settingsService.getSettings();
        if (!settings.openrouterApiKey) {
          win.webContents.send(
            IPC.MESSAGE_CHUNK,
            "⚠️ No API key configured. Open Settings to add your OpenRouter API key.",
          );
          win.webContents.send(IPC.MESSAGE_DONE);
          return;
        }

        if (!sessions.has(projectId)) {
          const project = await projectService.getProject(projectId);
          const isFirstRun = await homeService.isFirstRun();
          const systemContext = await buildSystemContext(
            projectId,
            project.name,
            project.folderPath ?? undefined,
          );
          sessions.set(
            projectId,
            new AgentSession({
              win,
              messageService,
              homeService,
              researchService,
              projectId,
              projectName: project.name,
              folderPath: project.folderPath,
              apiKey: settings.openrouterApiKey,
              model: settings.model,
              isFirstRun,
              systemContext,
            }),
          );
        }

        const session = sessions.get(projectId);
        if (!session) return;
        await session.send(content);
      } catch (err) {
        console.error("[IPC] SEND_MESSAGE error:", err);
        win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ An error occurred. Please try again.");
        win.webContents.send(IPC.MESSAGE_DONE);
      }
    })();
  });
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/di/tokens.ts src/main/bootstrap.ts src/main/ipc-handlers.ts
git commit -m "feat(run6): wire HomeService, ResearchService, new IPC handlers, EventBus forwarder"
```

---

## Task 13: Renderer — electron.d.ts + LeftSidebar + ResearchStatusBar

**Files:**
- Modify: `src/renderer/electron.d.ts`
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`
- Modify: `src/renderer/components/layout/chat/ResearchStatusBar.tsx`

- [ ] **Step 1: Update electron.d.ts with new IPC channels**

```typescript
// src/renderer/electron.d.ts
import type { IpcChannel } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
    };
  }
}
```

(If this already matches the existing file, no change needed — just verify new channels are covered by the `IpcChannel` type, which they are since we updated `ipc-channels.ts` in Task 1.)

- [ ] **Step 2: Update LeftSidebar — folder picker in create dialog**

```typescript
// src/renderer/components/layout/LeftSidebar.tsx
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";

interface LeftSidebarProps {
  onOpenSettings: () => void;
}

export default function LeftSidebar({ onOpenSettings }: LeftSidebarProps) {
  const { activeProjectId, setActiveProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p as Project[]));
  }, []);

  const handleBrowseFolder = async () => {
    const path = await window.electronAPI.invoke(IPC.OPEN_FOLDER_DIALOG);
    setNewFolderPath(path as string | null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const project = (await window.electronAPI.invoke(IPC.CREATE_PROJECT, {
      name,
      folderPath: newFolderPath,
    })) as Project;
    setProjects((prev) => [...prev, project]);
    setNewName("");
    setNewFolderPath(null);
    setCreating(false);
    setActiveProjectId(project.id);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "action.hover" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" color="text.secondary">
          Projects
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List dense disablePadding>
          {projects.map((p) => (
            <ListItemButton
              key={p.id}
              selected={p.id === activeProjectId}
              onClick={() => setActiveProjectId(p.id)}
            >
              <ListItemText
                primary={p.name}
                slotProps={{ primary: { variant: "body2", noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ px: 1, py: 0.5 }}>
          {creating ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Project name"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setNewFolderPath(null);
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) {
                    setCreating(false);
                    setNewFolderPath(null);
                  }
                }}
              />
              <Button
                size="small"
                startIcon={<FolderOpenIcon />}
                onClick={handleBrowseFolder}
                sx={{ justifyContent: "flex-start" }}
              >
                {newFolderPath ? newFolderPath.split("/").pop() : "Link folder (optional)"}
              </Button>
              {newFolderPath && (
                <Chip
                  label={newFolderPath}
                  size="small"
                  onDelete={() => setNewFolderPath(null)}
                  sx={{ maxWidth: "100%", fontSize: 10 }}
                />
              )}
            </Box>
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setCreating(true)}
              fullWidth
              sx={{ justifyContent: "flex-start" }}
            >
              New project
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
        <IconButton size="small" onClick={onOpenSettings} title="Settings">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Wire ResearchStatusBar**

```typescript
// src/renderer/components/layout/chat/ResearchStatusBar.tsx
import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

interface ResearchState {
  active: boolean;
  message: string;
  doneMessage: string | null;
}

export default function ResearchStatusBar() {
  const [state, setState] = useState<ResearchState>({
    active: false,
    message: "",
    doneMessage: null,
  });

  useEffect(() => {
    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data) => {
      const d = data as { status: string; message?: string; query?: string };
      if (d.status === "started") {
        setState({ active: true, message: "Research started…", doneMessage: null });
      } else if (d.status === "progress" && d.message) {
        setState((prev) => ({ ...prev, message: d.message! }));
      } else if (d.status === "failed") {
        setState({ active: false, message: "", doneMessage: "Research failed." });
        setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000);
      }
    });

    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data) => {
      const d = data as { query: string };
      setState({ active: false, message: "", doneMessage: `Done: ${d.query}` });
      setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000);
    });

    return () => {
      unsubUpdate();
      unsubComplete();
    };
  }, []);

  if (!state.active && !state.doneMessage) {
    return (
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", minHeight: 40 }} />
    );
  }

  return (
    <Box
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        gap: 1,
        minHeight: 40,
      }}
    >
      {state.active && <CircularProgress size={14} />}
      <Typography variant="caption" color="text.secondary" noWrap>
        {state.doneMessage ?? state.message}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Run typecheck + lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/electron.d.ts \
  src/renderer/components/layout/LeftSidebar.tsx \
  src/renderer/components/layout/chat/ResearchStatusBar.tsx
git commit -m "feat(run6): UI — folder picker, wired ResearchStatusBar"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: all tests pass. Fix any failures before continuing.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run lint**

```bash
bun run check
```

Expected: clean.

- [ ] **Step 4: Start the app and smoke-test**

```bash
bun run dev
```

Verify:
- App launches without error
- Can create a project (with and without folder)
- "Link folder" button appears, opens native folder picker
- Chat works (messages stream)
- No console errors about missing IPC channels

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(run6): final typecheck + lint pass"
```
