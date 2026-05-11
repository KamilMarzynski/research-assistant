# Separate Project Config from Linked Folders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all project configuration (AGENTS.md, MEMORY.md, skills) out of linked project folders into `~/.scholar/projects/<slug>/`, split AGENTS.md into GOAL.md + FILES.md, and drop the `~/.agents` path entirely.

**Architecture:** Clean break approach — no migration, no dual-location fallbacks. All config lives in `~/.scholar/`. Linked project folders are untouched by the app except for research output via `write_file`.

**Tech Stack:** TypeScript, Node.js fs/promises, Vitest, electron IPC.

---

## File Structure Map

| File | Responsibility |
|------|-------------|
| `src/main/paths.ts` | Path helpers. Remove `~/.agents` paths, add project config path. |
| `src/main/agent/context.ts` | Build system prompt. Load `GOAL.md` + `FILES.md` + `MEMORY.md` from `~/.scholar/projects/<slug>/`. No `folderPath` fallback. |
| `src/main/agent/SkillRouter.ts` | Discover skills. Dirs: `~/.scholar/skills` + `~/.scholar/projects/<slug>/skills`. No `~/.agents`. |
| `src/main/agent/path-jail.ts` | Path validation. Remove `~/.agents/skills` and `.agents`/`.scholar` subdir zones. Add per-project skills zone. |
| `src/main/services/ProjectService.ts` | Remove `.scholar` mkdir from create/link. Remove cleanup of `AGENTS.md`/`MEMORY.md`/`.scholar`/`.agents`. |
| `src/main/services/HomeService.ts` | Remove `~/.agents/skills` from `ensureDirectories`. |
| `src/main/services/ResearchService.ts` | Read `FILES.md` from `~/.scholar/projects/<slug>/` only. |
| `src/main/ipc/artifact-handlers.ts` | Remove `.scholar`/`.agents` dot-file exception. |
| `src/main/agent/session.ts` | Update `buildSystemContext` call (remove `folderPath`), update `createDefaultSkillRouter` call (pass `projectName`). |
| `src/main/agent/builtin-skills.ts` | Update first-run onboarding to mention `GOAL.md` + `FILES.md`. |
| `src/main/agent/OutputRouter.ts` | No functional change; caller passes `FILES.md` content instead. |

---

## Task 1: Paths — Remove agents, add project config path

**Files:**
- Modify: `src/main/paths.ts`
- Test: `src/main/__tests__/paths.test.ts`

- [ ] **Step 1: Write failing test**

In `src/main/__tests__/paths.test.ts`, update tests:

```typescript
it("getProjectConfigPath returns ~/.scholar/projects/<slug>", () => {
  const result = getProjectConfigPath("my-project");
  expect(result).toContain(".scholar");
  expect(result).toContain("projects/my-project");
});
```

Also remove any test for `getAgentsHome`, `getAgentsPath`, `getProjectSkillsPaths`.

- [ ] **Step 2: Run test — verify fails**

```bash
bunx vitest run src/main/__tests__/paths.test.ts
```
Expected: FAIL — `getProjectConfigPath is not defined`

- [ ] **Step 3: Implement**

In `src/main/paths.ts`, remove:
```typescript
export function getAgentsHome(): string {
  return join(resolveHome(), ".agents");
}

export function getAgentsPath(): string {
  return getAgentsHome();
}

export function getProjectSkillsPaths(projectFolderPath: string): string[] {
  return [join(projectFolderPath, ".agents"), join(projectFolderPath, ".scholar")];
}
```

Add:
```typescript
export function getProjectConfigPath(slug: string): string {
  return join(getScholarHome(), "projects", slug);
}
```

- [ ] **Step 4: Run test — verify passes**

```bash
bunx vitest run src/main/__tests__/paths.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/paths.ts src/main/__tests__/paths.test.ts
git commit -m "feat: remove ~/.agents paths, add getProjectConfigPath"
```

---

## Task 2: Context — Split AGENTS.md into GOAL.md + FILES.md

**Files:**
- Modify: `src/main/agent/context.ts`
- Test: `src/main/agent/context.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/context.test.ts`, update the `buildSystemContext` describe block:

1. Remove `folderPath` parameter from all `buildSystemContext` calls (change to 1 arg: `projectName`).
2. Replace `"no AGENTS.md yet"` assertions with `"no GOAL.md yet"` and `"no FILES.md yet"`.
3. Replace `AGENTS.md` file creation with `GOAL.md` + `FILES.md`.
4. Add a test for `GOAL.md` inclusion.
5. Remove all `projectDir` / `folderPath` test cases (no more project folder fallback).

Key test changes:

```typescript
it("returns onboarding prompt when no context files exist", async () => {
  const result = await buildSystemContext("my project");
  expect(result).toContain("no GOAL.md yet");
  expect(result).toContain("no FILES.md yet");
});

it("includes GOAL.md content when present", async () => {
  const home = join(tmpHome, ".scholar");
  const slug = "my-project";
  await mkdir(join(home, "projects", slug), { recursive: true });
  await writeFile(
    join(home, "projects", slug, "GOAL.md"),
    "# Goal\nBuild a TypeScript monorepo.",
  );

  const result = await buildSystemContext("my project");
  expect(result).toContain("Build a TypeScript monorepo.");
});

it("includes FILES.md content when present", async () => {
  const home = join(tmpHome, ".scholar");
  const slug = "my-project";
  await mkdir(join(home, "projects", slug), { recursive: true });
  await writeFile(
    join(home, "projects", slug, "FILES.md"),
    "# Files\nAll code in src/. Output to dist/.",
  );

  const result = await buildSystemContext("my project");
  expect(result).toContain("All code in src/. Output to dist/.");
});

it("skips empty GOAL.md", async () => {
  const home = join(tmpHome, ".scholar");
  const slug = "my-project";
  await mkdir(join(home, "projects", slug), { recursive: true });
  await writeFile(join(home, "projects", slug, "GOAL.md"), "   ");

  const result = await buildSystemContext("my project");
  expect(result).not.toContain("Project goal");
});

it("skips empty FILES.md", async () => {
  const home = join(tmpHome, ".scholar");
  const slug = "my-project";
  await mkdir(join(home, "projects", slug), { recursive: true });
  await writeFile(join(home, "projects", slug, "FILES.md"), "   ");

  const result = await buildSystemContext("my project");
  expect(result).not.toContain("Project files");
});

it("includes project-level MEMORY.md from ~/.scholar/projects/<slug>/", async () => {
  const home = join(tmpHome, ".scholar");
  const slug = "my-project";
  await mkdir(join(home, "projects", slug), { recursive: true });
  await writeFile(join(home, "projects", slug, "MEMORY.md"), "# Project Memory\nThis project uses Bun.");

  const result = await buildSystemContext("my project");
  expect(result).toContain("Project Memory");
  expect(result).toContain("This project uses Bun.");
});
```

Also update `loadSkillIndexXml` tests — remove the project-level skill override test that used `.agents/skills`. Replace with a test using `~/.scholar/projects/<slug>/skills`:

```typescript
it("project-level skill overrides global when same name", async () => {
  const globalDir = join(tmpHome, ".scholar", "skills", "shared-skill");
  const projectDir = join(tmpHome, ".scholar", "projects", "my-project", "skills", "shared-skill");

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

  const result = await loadSkillIndexXml("my project");
  expect(result).toContain("Project version.");
  expect(result).not.toContain("Global version.");
});
```

Update `loadSkillsByContent` tests similarly.

- [ ] **Step 2: Run tests — verify failures**

```bash
bunx vitest run src/main/agent/context.test.ts
```
Expected: Multiple FAILs — `buildSystemContext` signature mismatch, `GOAL.md` not found, etc.

- [ ] **Step 3: Implement**

In `src/main/agent/context.ts`:

1. Remove `folderPath` parameter from `buildSystemContext` and `loadSkillIndexXml` and `loadSkillsByContent`.
2. In `buildSystemContext`, replace the AGENTS.md section with GOAL.md + FILES.md loading from `~/.scholar/projects/<slug>/`.
3. Update MEMORY.md loading to only read from `~/.scholar/projects/<slug>/MEMORY.md`.
4. Update `loadSkillIndexXml` and `loadSkillsByContent` to take `projectName` (not `folderPath`) and pass it to `createDefaultSkillRouter`.

```typescript
export async function loadSkillIndexXml(projectName: string | undefined): Promise<string> {
  const router = createDefaultSkillRouter(projectName);
  await router.buildIndex();
  return router.toXml();
}

export async function loadSkillsByContent(
  skillNames: string[],
  projectName: string | undefined,
): Promise<string> {
  if (skillNames.length === 0) return "";

  const router = createDefaultSkillRouter(projectName);
  await router.buildIndex();
  const parts: string[] = [];
  for (const name of skillNames) {
    try {
      const content = await router.loadSkillWithExtras(name);
      parts.push(content);
    } catch (err) {
      console.error(`[context] failed to load skill "${name}":`, err);
    }
  }
  return parts.join("\n\n---\n\n");
}

export async function buildSystemContext(
  projectName: string,
  skillIndexXml?: string,
): Promise<string> {
  const scholarHome = getScholarHome();
  const slug = toSlug(projectName);
  const parts: string[] = [];

  // 1. config.md
  try {
    const config = await readFile(join(scholarHome, "config.md"), "utf-8");
    if (config.trim()) {
      parts.push("<!-- User working style (config.md) -->", config.trim());
    }
  } catch {
    // not present yet
  }

  // 2. skills
  const skillIndex = skillIndexXml ?? (await loadSkillIndexXml(projectName));
  if (skillIndex) parts.push(skillIndex);

  // 3. GOAL.md
  let goalFile: string | undefined;
  try {
    goalFile = await readFile(join(scholarHome, "projects", slug, "GOAL.md"), "utf-8");
  } catch {
    // not yet discovered
  }

  // 4. FILES.md
  let filesFile: string | undefined;
  try {
    filesFile = await readFile(join(scholarHome, "projects", slug, "FILES.md"), "utf-8");
  } catch {
    // not yet discovered
  }

  if (goalFile?.trim()) {
    parts.push("<!-- Project goal (GOAL.md) -->", goalFile.trim());
  }
  if (filesFile?.trim()) {
    parts.push("<!-- Project files (FILES.md) -->", filesFile.trim());
  }

  if (!goalFile?.trim() || !filesFile?.trim()) {
    const goalPath = `~/.scholar/projects/${slug}/GOAL.md`;
    const filesPath = `~/.scholar/projects/${slug}/FILES.md`;
    parts.push(
      "This project has no GOAL.md or FILES.md yet. If the user already described their project in their first message, use the `write_file` tool to create both files directly.",
      "If they have not yet described it, ask them one question at a time:",
      "1. What is this project about? (write answer to GOAL.md)",
      "2. How are files organized? (write answer to FILES.md)",
      "3. Where should research outputs go? (add to FILES.md)",
      "4. Any naming conventions or folder structures? (add to FILES.md)",
      `After gathering answers, write the GOAL.md file to ${goalPath} and the FILES.md file to ${filesPath} using the write_file tool.`,
    );
  }

  // 5. App-level MEMORY.md
  try {
    const appMemory = await readFile(join(scholarHome, "app-memory", "MEMORY.md"), "utf-8");
    if (appMemory.trim()) {
      parts.push("<!-- App-level memory (MEMORY.md) -->", appMemory.trim());
    }
  } catch {
    // not present yet
  }

  // 6. Project-level MEMORY.md
  let projectMemory: string | undefined;
  try {
    projectMemory = await readFile(join(scholarHome, "projects", slug, "MEMORY.md"), "utf-8");
  } catch {
    // not yet discovered
  }
  if (projectMemory?.trim()) {
    parts.push("<!-- Project memory (MEMORY.md) -->", projectMemory.trim());
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests — verify passes**

```bash
bunx vitest run src/main/agent/context.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/context.ts src/main/agent/context.test.ts
git commit -m "feat: split AGENTS.md into GOAL.md + FILES.md, load from ~/.scholar only"
```

---

## Task 3: SkillRouter — Remove agents, add per-project skills

**Files:**
- Modify: `src/main/agent/SkillRouter.ts`
- Test: `src/main/agent/context.test.ts` (already updated in Task 2)

- [ ] **Step 1: Write failing test**

Already covered in Task 2's updated `context.test.ts` which calls `loadSkillIndexXml("my project")` and `loadSkillsByContent([...], "my project")`. Running those tests after only changing `context.ts` will fail because `createDefaultSkillRouter` still expects `projectFolderPath: string | undefined`.

- [ ] **Step 2: Run tests — verify fails**

```bash
bunx vitest run src/main/agent/context.test.ts
```
Expected: FAIL — `createDefaultSkillRouter` type mismatch

- [ ] **Step 3: Implement**

In `src/main/agent/SkillRouter.ts`:

```typescript
export function createDefaultSkillRouter(
  projectName: string | undefined,
  onChange?: (skillName: string, summary: string) => void,
): SkillRouter {
  const dirs = [join(getScholarHome(), "skills")];
  if (projectName) {
    dirs.push(join(getScholarHome(), "projects", toSlug(projectName), "skills"));
  }
  return new SkillRouter(dirs, onChange);
}
```

Note: `toSlug` must be importable from `context.ts` or redefined here. Since `SkillRouter.ts` already imports `getScholarHome` from `../paths`, add `toSlug` import from `./context` if it's exported there (it is).

Add import at top:
```typescript
import { toSlug } from "./context";
```

- [ ] **Step 4: Run tests — verify passes**

```bash
bunx vitest run src/main/agent/context.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/SkillRouter.ts
git commit -m "feat: restructure skills to global + per-project in ~/.scholar only"
```

---

## Task 4: PathJail — Update zones

**Files:**
- Modify: `src/main/agent/path-jail.ts`
- Test: `src/main/agent/path-jail.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/agent/path-jail.test.ts`:

1. Remove tests for `~/.agents/skills` ("allows read inside ~/.agents/skills", "blocks write to ~/.agents/skills").
2. Add tests for per-project skills zone:

```typescript
it("allows read inside ~/.scholar/projects/<slug>/skills", () => {
  const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
  expect(() => jail.validate(p, "read")).not.toThrow();
});

it("blocks write to ~/.scholar/projects/<slug>/skills", () => {
  const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
  expect(() => jail.validate(p, "write")).toThrow(/read-only/);
});
```

3. Update the "allows write inside ~/.scholar/projects/<slug>" test to use `GOAL.md` or `FILES.md` instead of `AGENTS.md`:

```typescript
it("allows write inside ~/.scholar/projects/<slug>", () => {
  const p = join(HOME, "projects", "test-project", "GOAL.md");
  expect(() => jail.validate(p, "write")).not.toThrow();
});
```

- [ ] **Step 2: Run tests — verify failures**

```bash
bunx vitest run src/main/agent/path-jail.test.ts
```
Expected: FAILs on removed `.agents` tests and new per-project skills tests.

- [ ] **Step 3: Implement**

In `src/main/agent/path-jail.ts`:

Remove:
- `agentsSkills` field and its usage
- `projectAgentsSkills` field and its usage
- `projectHomeSkills` field and its usage

Add:
- `projectSkills` field

```typescript
export class PathJail {
  private readonly workspace: string;
  private readonly home: string;
  private readonly homeSkills: string;
  private readonly projectFolder: string | null;
  private readonly projectSkills: string;
  private readonly projectsDir: string;
  private readonly readWriteZones: string[];
  private readonly readOnlyZones: string[];
  private readonly allZones: string[];

  constructor(
    readonly projectId: string,
    folderPath: string | null,
    projectName: string,
    private readonly allowlistService: AllowlistService,
  ) {
    this.home = getScholarHome();
    this.workspace = join(this.home, "workspace", projectId);
    this.homeSkills = join(this.home, "skills");
    this.projectFolder = folderPath ? resolve(normalize(folderPath)) : null;
    this.projectSkills = join(this.home, "projects", toSlug(projectName), "skills");
    this.projectsDir = join(this.home, "projects", toSlug(projectName));

    this.readWriteZones = [
      this.workspace,
      this.projectsDir,
      ...(this.projectFolder ? [this.projectFolder] : []),
    ];

    this.readOnlyZones = [
      this.homeSkills,
      this.projectSkills,
    ];

    this.allZones = [...this.readWriteZones, ...this.readOnlyZones];
  }
```

Also need to import `toSlug` from `./context` at the top of `path-jail.ts`:
```typescript
import { toSlug } from "./context";
```

- [ ] **Step 4: Run tests — verify passes**

```bash
bunx vitest run src/main/agent/path-jail.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/path-jail.ts src/main/agent/path-jail.test.ts
git commit -m "feat: update PathJail zones, drop ~/.agents, add per-project skills"
```

---

## Task 5: ProjectService — Stop touching linked folders

**Files:**
- Modify: `src/main/services/ProjectService.ts`
- Test: `src/main/services/__tests__/ProjectService.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/main/services/__tests__/ProjectService.test.ts`:

1. Remove test assertions for `.scholar` mkdir in `createProject`.
2. Remove test assertions for `.scholar` mkdir in `linkFolder`.
3. Remove the entire "cleans up linked folder artifacts" test (the one asserting `rm` on `/user/project/.scholar`, `.agents`, `AGENTS.md`, `MEMORY.md`).

Update the `createProject` test that checks `mkdir`:
```typescript
it("creates project without folderPath does not call mkdir", async () => {
  // ... existing test, ensure no mkdir assertion for .scholar
});
```

- [ ] **Step 2: Run tests — verify failures**

```bash
bunx vitest run src/main/services/__tests__/ProjectService.test.ts
```
Expected: FAIL — `mkdir` called unexpectedly, `rm` assertions fail.

- [ ] **Step 3: Implement**

In `src/main/services/ProjectService.ts`:

Remove from `createProject`:
```typescript
if (folderPath) {
  await mkdir(join(folderPath, ".scholar"), { recursive: true });
}
```

Remove from `deleteProject`:
```typescript
if (project.folderPath) {
  await this.safeRm(join(project.folderPath, "AGENTS.md"));
  await this.safeRm(join(project.folderPath, "MEMORY.md"));
  await this.safeRm(join(project.folderPath, ".scholar"));
  await this.safeRm(join(project.folderPath, ".agents"));
}
```

Remove from `linkFolder`:
```typescript
await mkdir(join(folderPath, ".scholar"), { recursive: true });
```

- [ ] **Step 4: Run tests — verify passes**

```bash
bunx vitest run src/main/services/__tests__/ProjectService.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ProjectService.ts src/main/services/__tests__/ProjectService.test.ts
git commit -m "feat: stop creating .scholar in linked folders, stop cleaning project folder artifacts"
```

---

## Task 6: HomeService — Remove ~/.agents/skills

**Files:**
- Modify: `src/main/services/HomeService.ts`
- Test: `src/main/services/__tests__/HomeService.test.ts`

- [ ] **Step 1: Write failing test**

In `src/main/services/__tests__/HomeService.test.ts`:

Remove the assertion:
```typescript
await expect(access(join(tmpHome, ".agents", "skills"))).resolves.toBeUndefined();
```

- [ ] **Step 2: Run tests — verify failures**

```bash
bunx vitest run src/main/services/__tests__/HomeService.test.ts
```
Expected: FAIL — `.agents/skills` directory not created.

- [ ] **Step 3: Implement**

In `src/main/services/HomeService.ts`, in `ensureDirectories`:

Remove:
```typescript
const agents = this.getAgentsPath();
```

Remove from `dirs` array:
```typescript
join(agents, "skills"),
```

Also remove `getAgentsPath()` method if it's no longer used anywhere. Search first:
```bash
grep -r "getAgentsPath" --include="*.ts" src/
```
If only used in `HomeService.ts`, delete the method.

- [ ] **Step 4: Run tests — verify passes**

```bash
bunx vitest run src/main/services/__tests__/HomeService.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/HomeService.ts src/main/services/__tests__/HomeService.test.ts
git commit -m "feat: remove ~/.agents/skills from ensureDirectories"
```

---

## Task 7: ResearchService — Read FILES.md from ~/.scholar only

**Files:**
- Modify: `src/main/services/ResearchService.ts`

- [ ] **Step 1: Inspect current code**

The relevant section is in the `agent_end` handler around line 194. Current code reads `AGENTS.md` from `config.folderPath` first, then falls back to `~/.scholar/projects/<slug>/AGENTS.md`.

- [ ] **Step 2: Implement**

Replace the AGENTS.md reading block:

```typescript
// Read FILES.md for output conventions
let filePaths: string[] = [];
try {
  const homePath = this.homeService.getHomePath();
  const slug = toSlug(config.projectName);
  let filesMdContent = "";

  try {
    filesMdContent = await readFile(
      join(homePath, "projects", slug, "FILES.md"),
      "utf-8",
    );
  } catch {
    /* not found */
  }

  let conventions: { default: string; code?: string; reports?: string } | null = null;
  if (filesMdContent) {
    const jail = new PathJail(
      config.projectId,
      config.folderPath,
      config.projectName,
      this.allowlistService,
    );
    const router = new OutputRouter(jail, this.artifactService);
    conventions = router.parseConventions(filesMdContent);
  }
  if (!conventions && config.folderPath) {
    conventions = { default: config.folderPath };
  }
  if (conventions) {
    const jail = new PathJail(
      config.projectId,
      config.folderPath,
      config.projectName,
      this.allowlistService,
    );
    const router = new OutputRouter(jail, this.artifactService);
    const result = await router.moveFinals(workspacePath, conventions);
    filePaths = result.moved.map((name) => join(conventions.default, name));
  }
} catch (err) {
  console.error("[ResearchService] output routing failed:", err);
}
```

Also verify `toSlug` is imported in `ResearchService.ts`.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/main/services/ResearchService.ts
git commit -m "feat: read FILES.md from ~/.scholar only for output conventions"
```

---

## Task 8: Artifact handlers — Remove .scholar/.agents dot-file exception

**Files:**
- Modify: `src/main/ipc/artifact-handlers.ts`

- [ ] **Step 1: Implement**

In `src/main/ipc/artifact-handlers.ts`, inside the `walk` function, replace:

```typescript
if (
  entry.name.startsWith(".") &&
  !entry.name.startsWith(".scholar") &&
  !entry.name.startsWith(".agents")
) {
  continue;
}
```

With:
```typescript
if (entry.name.startsWith(".")) {
  continue;
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/artifact-handlers.ts
git commit -m "feat: hide all dot files in artifact tree, remove .scholar/.agents exception"
```

---

## Task 9: Session — Update buildSystemContext and SkillRouter calls

**Files:**
- Modify: `src/main/agent/session.ts`
- Test: `src/main/agent/session.test.ts`

- [ ] **Step 1: Write failing test**

In `src/main/agent/session.test.ts`, the mock for `buildSystemContext` already ignores args, so tests should still pass. But verify by running:

```bash
bunx vitest run src/main/agent/session.test.ts
```
Expected: FAIL if `buildSystemContext` call in `session.ts` passes wrong number of args.

- [ ] **Step 2: Implement**

In `src/main/agent/session.ts`, find the two calls to `buildSystemContext`:

1. In constructor (line ~248):
```typescript
const systemContext = await buildSystemContext(
  this.projectName,
  this.folderPath ?? undefined,
  this.skillRouter.toXml(),
);
```
Change to:
```typescript
const systemContext = await buildSystemContext(
  this.projectName,
  this.skillRouter.toXml(),
);
```

2. In `send` method (line ~248):
```typescript
const systemContext = await buildSystemContext(
  this.projectName,
  this.folderPath ?? undefined,
  this.skillRouter.toXml(),
);
```
Change to:
```typescript
const systemContext = await buildSystemContext(
  this.projectName,
  this.skillRouter.toXml(),
);
```

Also update `createDefaultSkillRouter` call in constructor (line ~98):
```typescript
this.skillRouter = createDefaultSkillRouter(folderPath ?? undefined, ...);
```
Change to:
```typescript
this.skillRouter = createDefaultSkillRouter(projectName, ...);
```

- [ ] **Step 3: Run tests**

```bash
bunx vitest run src/main/agent/session.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/session.ts src/main/agent/session.test.ts
git commit -m "feat: update session for new context and skill router signatures"
```

---

## Task 10: Onboarding prompt — Update builtin-skills.ts

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`

- [ ] **Step 1: Implement**

Update `FIRST_RUN_SKILL` to mention both `GOAL.md` and `FILES.md`:

```typescript
export const FIRST_RUN_SKILL = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. What is this project about? (for GOAL.md)
2. How do you organise your projects? (e.g. folder per project, by topic, other)
3. Do you use a note-taking app or work with plain folders?
4. What file types do you mainly work with?
5. Any naming conventions or folder structures you always follow?

If the user's setup is complex (e.g. cloud sync, LaTeX pipelines, custom tooling, multiple workspaces), start a research task with start_research to understand their full workflow before writing config.md. Do not guess — research it.

After receiving all answers (or after the research completes), write:
- GOAL.md to ~/.scholar/projects/<slug>/GOAL.md (what the project is about)
- FILES.md to ~/.scholar/projects/<slug>/FILES.md (file organization, naming, output locations)
- config.md to ~/.scholar/config.md (plain Markdown, human-editable)

Then confirm setup is complete.`;
```

Note: The `<slug>` in the prompt is a placeholder — the actual prompt text in `context.ts` will contain the resolved path. This skill text is just the high-level guidance. The exact path is injected by `buildSystemContext`.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/builtin-skills.ts
git commit -m "feat: update onboarding prompt for GOAL.md + FILES.md"
```

---

## Task 11: OutputRouter test — Rename AGENTS.md to FILES.md in test strings

**Files:**
- Modify: `src/main/agent/OutputRouter.test.ts`

- [ ] **Step 1: Implement**

In `OutputRouter.test.ts`, replace all `# AGENTS.md` in test content strings with `# FILES.md`:

```typescript
const content = `# FILES.md

## Output location
...`;
```

Do 4 replacements (lines 27, 46, 56, 66 in the original file).

- [ ] **Step 2: Run tests**

```bash
bunx vitest run src/main/agent/OutputRouter.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/OutputRouter.test.ts
git commit -m "test: rename AGENTS.md to FILES.md in OutputRouter tests"
```

---

## Task 12: Full test suite + typecheck

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```
Expected: zero errors

- [ ] **Step 2: Run lint**

```bash
bun run check
```
Expected: clean

- [ ] **Step 3: Run all tests**

```bash
bun run test
```
Expected: all PASS

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address typecheck and test issues from full suite run"
```

---

## Spec Coverage Self-Review

| Spec Section | Task |
|-------------|------|
| Directory structure | Tasks 1–11 |
| `paths.ts` changes | Task 1 |
| `context.ts` changes | Task 2 |
| `SkillRouter.ts` changes | Task 3 |
| `path-jail.ts` changes | Task 4 |
| `ProjectService.ts` changes | Task 5 |
| `HomeService.ts` changes | Task 6 |
| `ResearchService.ts` changes | Task 7 |
| `artifact-handlers.ts` changes | Task 8 |
| `session.ts` changes | Task 9 |
| `builtin-skills.ts` changes | Task 10 |
| `OutputRouter.ts` — no functional change | Task 11 (test rename) |
| Test updates across all files | Embedded in each task |
| Onboarding flow update | Tasks 2 + 10 |

No placeholders. No gaps.
