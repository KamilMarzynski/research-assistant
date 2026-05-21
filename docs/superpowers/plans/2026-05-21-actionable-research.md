# Actionable Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the freeform `query` argument to research with an expressive XML `<research_brief>`, make researcher write persistent system changes (skills, FILES.md, GOAL.md) directly via `write_file`, and turn the finisher into an idempotent delivery enforcer that uses skills for format conversion but never touches persistent surfaces.

**Architecture:** Coordinator builds the brief from the user message; brief travels verbatim (no parsing) from `start_research` tool → `ResearchService` → researcher/orchestrator prompt → finisher prompt. Researcher mutates the file system directly under path-jail control; declares every path it wrote to in a `### Files changed` handoff list. Finisher reads FILES.md as the delivery contract, uses conversion skills via `read_skill` + `execute_code` to land final shape, never edits skills / FILES.md / GOAL.md / config.md.

**Tech Stack:** TypeScript / Bun / Electron / TSyringe DI / Vitest / Drizzle (libsql/sqlite) / `@mariozechner/pi-agent-core`.

**Reference spec:** `docs/superpowers/specs/2026-05-21-actionable-research-design.md`

---

## File Plan

| File | Action |
|---|---|
| `src/main/db/schema.ts` | Add nullable `brief` column to `tasks` table |
| `src/main/db/migrations/0003_add_task_brief.sql` | New generated migration |
| `src/main/services/TaskPersistenceService.ts` | Add `brief?: string` to `ResearchTask` + zod schema + save/load |
| `src/main/agent/tools/research-tools.ts` | Tool param `query` → `brief` |
| `src/main/services/ResearchService.ts` | Plumb `brief` through `RunResearchConfig`, `startResearch`, `startOrchestratedResearch`, internal task object |
| `src/main/services/ResearchFinisherService.ts` | Add `brief` to `FinishJob`; rename `parseOutputFiles` → `parseFilesChanged`; pass brief into finisher prompt |
| `src/main/agent/prompts.ts` | Rewrite `BASE_SYSTEM_PROMPT`, `researcherPrompt`, `orchestratorPrompt`, `finisherPrompt` |
| `src/main/agent/worker-agent.ts` | Finisher preset: add `execute_code`, `read_skill` to toolNames; thread `skillIndexXml` into preset for finisher prompt |
| `src/main/agent/builtin-skills.ts` | Delete `FIRST_RUN_SKILL` export |
| `src/main/agent/system-prompt-builder.ts` | Remove `firstRunPrompt` and `isFirstRun` from `SystemPromptContext` |
| `src/main/agent/MessagePipeline.ts` | Drop `firstRunPrompt` from prompt-builder call |
| `src/main/agent/context.ts` | Sharpen empty-state hint to instruct brief-based setup |
| Existing `*.test.ts` files | Add/update assertions per task |

---

## Task 1: Add `brief` column to tasks DB schema

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: `src/main/db/migrations/0003_add_task_brief.sql`

- [ ] **Step 1: Edit schema** — add a nullable `brief` text column to the `tasks` table.

In `src/main/db/schema.ts`, locate the `tasks` table definition (currently around lines 41-56) and add the `brief` column after `query`:

```ts
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  query: text("query").notNull(),
  brief: text("brief"),                       // NEW — nullable for back-compat
  folderPath: text("folder_path"),
  status: text("status", {
    enum: ["pending", "in_progress", "complete", "failed", "interrupted"],
  })
    .notNull()
    .default("in_progress"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

- [ ] **Step 2: Generate migration SQL.**

Run:

```bash
bun run db:generate
```

Expected: drizzle-kit creates a new file at `src/main/db/migrations/000X_*.sql` containing roughly:

```sql
ALTER TABLE `tasks` ADD `brief` text;
```

If the file is not named `0003_add_task_brief.sql` (drizzle's naming is auto-generated), rename it to `0003_add_task_brief.sql` for clarity and update the migration journal if drizzle uses one (`src/main/db/migrations/meta/`).

- [ ] **Step 3: Verify migration applies cleanly.**

Run typecheck to make sure schema types propagate:

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit.**

```bash
git add src/main/db/schema.ts src/main/db/migrations/
git commit -m "feat(db): add nullable brief column to tasks"
```

---

## Task 2: Add `brief` to `ResearchTask` and persistence

**Files:**
- Modify: `src/main/services/TaskPersistenceService.ts:10-28`, `37-51`, `57-72`

- [ ] **Step 1: Write the failing test.**

Open `src/main/services/__tests__/TaskPersistenceService.test.ts` (create if not present — pattern matches `ResearchFinisherService.test.ts`). Add a test that exercises persisting and reading back a task with a `brief`:

```ts
import "reflect-metadata";
import { describe, expect, it, beforeEach } from "vitest";
import { TaskPersistenceService } from "../TaskPersistenceService";
import { createTestDb } from "../../db/client.test-helpers"; // if helper exists; otherwise inline a test DB

describe("TaskPersistenceService — brief field", () => {
  it("persists and reads back the brief on a task", async () => {
    const db = await createTestDb();
    const svc = new TaskPersistenceService(db, "/tmp/.scholar");
    const brief = "<research_brief><user_request>hello</user_request></research_brief>";

    await svc.saveTask({
      taskId: "t1",
      projectId: "p1",
      projectName: "P",
      query: "fallback query",
      brief,
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });

    const tasks = await svc.getInProgressTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].brief).toBe(brief);
  });

  it("loads a task with null brief (back-compat)", async () => {
    const db = await createTestDb();
    const svc = new TaskPersistenceService(db, "/tmp/.scholar");
    await svc.saveTask({
      taskId: "t2",
      projectId: "p1",
      projectName: "P",
      query: "legacy",
      folderPath: null,
      startedAt: new Date().toISOString(),
      status: "in_progress",
    });
    const tasks = await svc.getInProgressTasks();
    expect(tasks[0].brief).toBeUndefined();
  });
});
```

If `createTestDb` helper does not exist, use the same in-memory libsql pattern already used elsewhere (look at `src/main/db/client.test.ts` for the exact import).

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/services/__tests__/TaskPersistenceService.test.ts
```

Expected: FAIL — `brief` does not exist on `ResearchTask` type.

- [ ] **Step 3: Add `brief` to `ResearchTask` interface and zod schema.**

In `src/main/services/TaskPersistenceService.ts`:

```ts
export interface ResearchTask {
  taskId: string;
  projectId: string;
  projectName: string;
  query: string;
  brief?: string;                            // NEW
  folderPath: string | null;
  startedAt: string;
  status?: "pending" | "in_progress" | "complete" | "failed" | "interrupted";
}

const ResearchTaskSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  query: z.string(),
  brief: z.string().optional(),              // NEW
  folderPath: z.string().nullable(),
  startedAt: z.string(),
  status: z.enum(["pending", "in_progress", "complete", "failed", "interrupted"]).optional(),
});
```

- [ ] **Step 4: Write the `brief` column in `saveTask` and read it in `getInProgressTasks` (and any other reader).**

In `saveTask` (currently lines 37-51), add `brief: task.brief ?? null` to the `.values({...})` insert.

In the mapper used by `getInProgressTasks` (currently lines 57-72), add `brief: r.brief ?? undefined` to the returned object.

Search the file for any other location that constructs a `ResearchTask` from a row and apply the same `brief` mapping.

- [ ] **Step 5: Run test to verify it passes.**

```bash
bun run test src/main/services/__tests__/TaskPersistenceService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit.**

```bash
git add src/main/services/TaskPersistenceService.ts src/main/services/__tests__/TaskPersistenceService.test.ts
git commit -m "feat(tasks): persist brief alongside query"
```

---

## Task 3: Change `start_research` tool parameter from `query` to `brief`

**Files:**
- Modify: `src/main/agent/tools/research-tools.ts`
- Modify: `src/main/agent/tools/research-tools.test.ts` (or inline test if no dedicated file — check `src/main/agent/tools.test.ts`)

- [ ] **Step 1: Write the failing test.**

In whichever test file exercises `createStartResearchTool` (likely `src/main/agent/tools.test.ts`), add or update a test:

```ts
it("start_research tool accepts brief and forwards it", async () => {
  const startFn = vi.fn().mockResolvedValue({ taskId: "t1" });
  const tool = createStartResearchTool(startFn);
  await tool.execute("call-1", {
    brief: "<research_brief><user_request>hi</user_request></research_brief>",
    deep: false,
  });
  expect(startFn).toHaveBeenCalledWith(
    "<research_brief><user_request>hi</user_request></research_brief>",
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: FAIL — tool has no `brief` parameter (still uses `query`).

- [ ] **Step 3: Rewrite the tool.**

Replace the full contents of `src/main/agent/tools/research-tools.ts` with:

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const startResearchParameters = Type.Object({
  brief: Type.String({
    description:
      "A <research_brief> XML chunk built by the coordinator. Must contain all required tags: user_request, coordinator_read, durability, expected_outcomes, success_criteria, existing_state_to_consult, constraints, out_of_scope. Forwarded verbatim to the research worker — code does not parse it.",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "true → orchestrator with parallel subtasks. false → single researcher. Default false.",
    }),
  ),
});

export function createStartResearchTool(
  startResearchFn: (brief: string, deep?: boolean) => Promise<{ taskId: string }>,
): AgentTool<typeof startResearchParameters, { taskId: string }> {
  return {
    name: "start_research",
    label: "Start background research",
    description:
      "Dispatch a background research task. Returns immediately with a taskId. A summary will be injected into this conversation when the research completes.",
    parameters: startResearchParameters,
    execute: async (_id, { brief, deep }) => {
      const { taskId } = await startResearchFn(brief, deep);
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes.**

```bash
bun run test src/main/agent/tools.test.ts
```

Expected: PASS for the new test. Other tests in the file may break because of the callback signature change — those will be fixed in Task 4.

- [ ] **Step 5: Commit.**

```bash
git add src/main/agent/tools/research-tools.ts src/main/agent/tools.test.ts
git commit -m "feat(start_research): rename query param to brief"
```

---

## Task 4: Plumb `brief` through `ResearchService`

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/services/__tests__/ResearchService.test.ts`

`ResearchService` currently has `query: string` as a parameter on `startResearch`, `startOrchestratedResearch`, the internal `RunResearchConfig`, and the task object passed to the worker. Replace `query` with `brief` at every plumbing point. The persisted task still has both: `query` carries a short label (e.g. the first 200 chars of `user_request`); `brief` carries the full XML.

- [ ] **Step 1: Write the failing test.**

Open `src/main/services/__tests__/ResearchService.test.ts`. Add:

```ts
it("forwards brief into the worker prompt and persists it", async () => {
  // Setup is per existing patterns in this file — reuse mock builders.
  const brief = "<research_brief><user_request>investigate X</user_request></research_brief>";
  const svc = makeServiceUnderTest(); // existing helper
  const { taskId } = await svc.startResearch(
    "p1", "Project", brief, /* folderPath */ null, /* projectPath */ null,
  );
  // Existing test pattern uses a spy on TaskPersistenceService.saveTask.
  expect(saveTaskSpy).toHaveBeenCalledWith(expect.objectContaining({ brief }));
  // And on createWorkerAgent's config:
  expect(createWorkerAgentSpy).toHaveBeenCalledWith(expect.objectContaining({
    // The brief should reach worker config — name of the carrying field
    // depends on Task 5 (prompts.ts). For now, assert that it shows up
    // anywhere reachable from config (e.g. systemPromptAddition contains it).
    systemPromptAddition: expect.stringContaining(brief),
  }));
  expect(typeof taskId).toBe("string");
});
```

If the existing test file has its own helper for spying on `saveTask` and `createWorkerAgent`, use those — otherwise add module-level `vi.mock` for both.

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: FAIL — `startResearch` does not accept `brief`.

- [ ] **Step 3: Update `RunResearchConfig` and method signatures.**

In `src/main/services/ResearchService.ts`, change the interface and method signatures:

```ts
interface RunResearchConfig {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  query: string;       // short label — kept for back-compat with persisted tasks and renderer
  brief: string;       // NEW — XML brief forwarded to worker
  folderPath: string | null;
}
```

Update `startResearch` and `startOrchestratedResearch` to accept `brief` and derive `query` (a short label) from it:

```ts
async startResearch(
  projectId: string,
  projectName: string,
  brief: string,
  folderPath: string | null,
  projectPath?: string | null,
): Promise<{ taskId: string }> {
  return this._runResearch(
    {
      projectId,
      projectName,
      projectPath: projectPath ?? null,
      query: deriveQueryLabel(brief),
      brief,
      folderPath,
    },
    "researcher",
    0,
  );
}

async startOrchestratedResearch(
  projectId: string,
  projectName: string,
  brief: string,
  folderPath: string | null,
  projectPath?: string | null,
): Promise<{ taskId: string }> {
  return this._runResearch(
    {
      projectId,
      projectName,
      projectPath: projectPath ?? null,
      query: deriveQueryLabel(brief),
      brief,
      folderPath,
    },
    "orchestrator",
    this.DEFAULT_RESEARCH_DEPTH,
  );
}
```

Add the helper at the bottom of the file (module-private):

```ts
/**
 * Extract a short human-readable label from a brief for use as the
 * task `query` field (back-compat: TaskPersistenceService.query is NOT NULL).
 * Falls back to the first 200 chars of the brief when no tag is found.
 */
function deriveQueryLabel(brief: string): string {
  const match = brief.match(/<user_request>([\s\S]*?)<\/user_request>/);
  const raw = (match?.[1] ?? brief).trim();
  return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
}
```

Find every internal site in `ResearchService.ts` that constructs the worker config or the persisted task (around lines 132, 191, 223, 230, 246, 267, 293 per earlier grep). At each site, add `brief: task.brief ?? task.query` so existing code keeps compiling and brief flows through.

In the worker config construction site (currently line 293, passes `query: config.query` into `createWorkerAgent`), add `brief: config.brief` alongside. The actual prompt-builder integration happens in Task 5 via the worker-agent preset.

In the persisted task save (where `saveTask({...})` is called), add `brief: config.brief` to the object.

- [ ] **Step 4: Run test to verify it passes.**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: PASS. The "systemPromptAddition contains brief" assertion may still fail since prompts aren't rewritten yet — if so, comment that specific expectation out and re-add it after Task 6/7.

- [ ] **Step 5: Update IPC handler call sites.**

Search the codebase for any caller of `ResearchService.startResearch` / `startOrchestratedResearch`:

```bash
grep -rn "startResearch\|startOrchestratedResearch" src --include="*.ts" | grep -v "\.test\."
```

Each caller currently passes a `query` string. The coordinator is responsible for building the brief — but at the IPC layer, the caller (an `ipcMain.handle` or similar) receives the `brief` from the agent tool. Since Task 3 already changed the tool callback signature to `(brief, deep)`, the handler is already passing the brief through under the name `query`/`brief` — verify the variable name matches.

If the handler currently does:

```ts
ipcMain.handle(IPC.START_RESEARCH, async (_, projectId, query, deep) => {
  return deep
    ? await researchService.startOrchestratedResearch(projectId, name, query, folder, projectPath)
    : await researchService.startResearch(projectId, name, query, folder, projectPath);
});
```

The variable just travels through unchanged; rename `query` → `brief` for clarity and consistency.

- [ ] **Step 6: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit.**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat(research): plumb brief through ResearchService"
```

---

## Task 5: Rewrite `BASE_SYSTEM_PROMPT`

**Files:**
- Modify: `src/main/agent/prompts.ts:179-217`
- Create or modify: `src/main/agent/prompts.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `src/main/agent/prompts.test.ts` (or append to existing if present):

```ts
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT } from "./prompts";

describe("BASE_SYSTEM_PROMPT", () => {
  it("contains the persistent system changes section", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Persistent system changes");
    expect(BASE_SYSTEM_PROMPT).toContain("Detecting persistent intent");
    expect(BASE_SYSTEM_PROMPT).toContain("Building the research brief");
    expect(BASE_SYSTEM_PROMPT).toContain("Output conventions are mutable");
  });

  it("contains the durability cue list", () => {
    for (const cue of ["always", "from now on", "for this project", "default to", "every time"]) {
      expect(BASE_SYSTEM_PROMPT).toContain(cue);
    }
  });

  it("removes the legacy Skill creation block", () => {
    expect(BASE_SYSTEM_PROMPT).not.toContain("## Skill creation");
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/If the user asks for a skill, write it to/);
  });

  it("instructs the coordinator to pass brief to start_research", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Pass the brief as the `brief` field of start_research");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: FAIL — assertions on new content don't match the current prompt.

- [ ] **Step 3: Rewrite `BASE_SYSTEM_PROMPT`.**

Replace the entire `BASE_SYSTEM_PROMPT` constant (currently `src/main/agent/prompts.ts:179-217`) with:

```ts
export const BASE_SYSTEM_PROMPT = `You are a research coordinator. Answer directly for simple, certain, or conversational requests. Delegate to background research workers for anything involving files, external data, verification, or uncertainty.

## When to call start_research

- The user asks about files, documents, project structure, or topics
- The request requires current data, web sources, or external verification
- The answer requires multiple steps or sources to be accurate
- You are not fully certain
- The topic may have changed since your training data
- The user implies a persistent system change (see "Detecting persistent intent")

Even simple persistent-intent requests warrant research:
"always output as pdf" sounds trivial but requires checking if a
md-to-pdf skill exists, picking a converter, updating FILES.md, etc.

Pass the brief as the \`brief\` field of start_research. Set deep=true
when the brief implies multi-source or parallel work; deep=false
otherwise. Default to false when unsure.

Do not guess. A quick research task is always better than a wrong answer.

## Persistent system changes — core idea

This assistant grows by writing files. Research may produce not only
artifacts for the user, but persistent changes to the assistant itself:
- skills at ~/.scholar/skills/<name>/SKILL.md (global)
- skills at <assistantProjectSkillsDir>/<name>/SKILL.md (project-scoped)
- FILES.md (output routing) at <assistantProjectDir>/FILES.md
- GOAL.md (project intent) at <assistantProjectDir>/GOAL.md
- config.md (global user prefs) at ~/.scholar/config.md
- integration helpers (credentials paths, connector skills)

Every file write to these locations is a persistent system change.
Path-jail will ask the user to approve each write at write time.

## Detecting persistent intent

Phrases that imply persistent change:
  "always", "from now on", "for this project", "default to",
  "every time", "stop doing X", "switch to Y", "make it so"

When you detect such a cue, the research brief MUST set
<durability>persistent</durability> and list the surfaces the
researcher should consider mutating in <expected_outcomes>.

When the cue is faint, ask the user before classifying as persistent.
A wrong persistent classification leads to silent system mutation —
worse than asking one extra question.

## Building the research brief

Before calling start_research, construct a <research_brief> with all
eight required tags. Empty content is OK; missing tags is not. The
researcher uses these tags to choose methodology and scope.

Required tags (in order):
  <user_request>     verbatim user message that triggered research
  <coordinator_read> 1-2 sentences: what user wants long-term
  <durability>       one_shot | persistent
  <expected_outcomes> free text: what shape the result takes
  <success_criteria>  bullet list: how finisher decides done
  <existing_state_to_consult> files / skills researcher must read first
  <constraints>      methodology hints, format preferences, secrets rules
  <out_of_scope>     explicit do-not-touch list

## Skills

Skills are reusable technique guides in ~/.scholar/skills/ and in the
project skills directory. The available_skills index lists only skill
names and descriptions. When a task matches a skill description, use
read_skill with the skill name before applying it. If a skill includes
a script, run it through execute_code.

## Large files

Large files are auto-summarized when they exceed context limits. The
summary includes the path to the full saved content — use read_file
with startLine/maxLines to read specific sections.

## Output conventions are mutable

FILES.md and GOAL.md are not constants. If research shows these should
change, the researcher will write the updated version directly with
write_file (path-jail will gate). Reading them is good. Updating them
is core to how this app learns the user.

## Error handling

- If a tool returns "Approval required", explain what path was blocked and ask the user if they want to allow it.
- If a bash command is blocked, explain why and suggest an alternative.
- If research fails, report the error clearly and offer to retry or adjust.`;
```

- [ ] **Step 4: Run test to verify it passes.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full lint to catch backtick/escape issues in the template literal.**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 6: Commit.**

```bash
git add src/main/agent/prompts.ts src/main/agent/prompts.test.ts
git commit -m "feat(prompts): rewrite BASE_SYSTEM_PROMPT for brief-driven research"
```

---

## Task 6: Rewrite `researcherPrompt`

**Files:**
- Modify: `src/main/agent/prompts.ts:46-94`
- Modify: `src/main/agent/prompts.test.ts`

The function signature changes: it now receives the verbatim brief XML as a parameter.

- [ ] **Step 1: Write the failing test.**

Append to `src/main/agent/prompts.test.ts`:

```ts
import { researcherPrompt, buildAgentDirs } from "./prompts";

describe("researcherPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the verbatim brief in a Research Brief section", () => {
    const out = researcherPrompt(dirs, "/h/.scholar/projects/p/workspace/T1/out.md", undefined, brief);
    expect(out).toContain("## Research Brief");
    expect(out).toContain(brief);
  });

  it("lists mutable surfaces explicitly", () => {
    const out = researcherPrompt(dirs, "/h/.scholar/projects/p/workspace/T1/out.md", undefined, brief);
    expect(out).toContain("## Mutable surfaces");
    expect(out).toContain("~/.scholar/skills/");
    expect(out).toContain("FILES.md");
    expect(out).toContain("GOAL.md");
    expect(out).toContain("config.md");
  });

  it("contains the update-over-create rule with list_skills + read_skill steps", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("## Update over create");
    expect(out).toContain("list_skills");
    expect(out).toContain("read_skill");
  });

  it("contains the format-and-delivery deferral", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("A finisher agent runs after you");
    expect(out).toContain("prioritize content correctness over final format");
  });

  it("uses the new ### Files changed handoff format", () => {
    const out = researcherPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("### Files changed");
    expect(out).not.toContain("### Output Files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: FAIL — function signature does not accept `brief`; new content missing.

- [ ] **Step 3: Rewrite the function.**

Replace `researcherPrompt` (lines 46-94 of `src/main/agent/prompts.ts`) with:

```ts
export function researcherPrompt(
  dirs: AgentDirs,
  outputPath: string,
  filesMdContent?: string,
  brief?: string,
): string {
  const briefSection = brief
    ? `## Research Brief
\`\`\`
${brief.trim()}
\`\`\``
    : `## Research Brief
(no brief — answer the query as best you can; legacy invocation)`;

  const outputSection = filesMdContent
    ? `## Output Routing

FILES.md defines where research outputs should be saved. Best-effort follow it; the finisher will enforce.

\`\`\`
${filesMdContent.trim()}
\`\`\`

Write scratch and intermediate notes to \`taskWorkspaceDir\`. Write final outputs directly to \`userProjectDir\` following FILES.md conventions. Use descriptive filenames — no task IDs, no UUIDs.`
    : `## Output

Write scratch and intermediate notes to \`taskWorkspaceDir\`. Write your final output to \`${outputPath}\`. Use descriptive filenames — no task IDs, no UUIDs.`;

  return `You are a background researcher.

${briefSection}

${dirSection(dirs)}

## Mutable surfaces — you may write to these as persistent system changes

- ~/.scholar/skills/<name>/SKILL.md           — global capabilities
- ${dirs.assistantProjectSkillsDir}/<name>/SKILL.md — project-scoped capabilities
- ${dirs.assistantProjectDir}/FILES.md        — output routing for this project
- ${dirs.assistantProjectDir}/GOAL.md         — project intent
- ~/.scholar/config.md                        — global user preferences
- ${dirs.userProjectDir}/<anything>           — research artifacts

Each write here is a persistent system change. Path-jail will ask the user
to approve. Treat as you would a code commit, not a scratch file.

## Update over create

Before creating a new skill, you MUST:
  1. consult the <available_skills> index (in your system prompt) to see existing skills
  2. read_skill on any name-similar or topic-similar candidate
  3. if any match within reason — update its body via write_file; do NOT create a sibling
  4. only create new when no reasonable match exists
  5. justify your choice in the handoff Summary

The same principle applies to FILES.md and GOAL.md: read before write,
update existing content rather than appending or replacing wholesale.

## Every user request can mutate FILES.md and GOAL.md

If the brief's <durability> is persistent OR <expected_outcomes> implies
convention change, you MUST read FILES.md/GOAL.md first, then write_file
the updated version. Silently producing a one-off output when the brief
implied a rule is wrong.

${outputSection}

## Approach

Choose methodology based on brief.<expected_outcomes> and <constraints>:
- factual external claims  → search broadly, cite primary sources
- internal tool/skill pick → enumerate options, probe via execute_code, choose
- convention change        → read existing FILES.md/GOAL.md/skills, write updated content
- integration setup        → probe auth flow, draft skill that calls it, document secrets path
Mixed outcomes → mix approaches.

## Format and delivery

Work in whatever format suits the research — markdown for prose, scripts
for code, jsonl for data. You may best-effort write the final artifact
in the format FILES.md requests, but you are not required to.
A finisher agent runs after you and enforces FILES.md conformance using
conversion skills.

Therefore: prioritize content correctness over final format.
If converting would distract from the research, leave conversion to the finisher.

## Scale autonomy

You are running as a single researcher. If you discover the brief implies
independent parallel subtopics, note this in the handoff Summary — do not
spawn children. The coordinator may rerun as deep=true if appropriate.

## Handoff (REQUIRED)

End your response with a \`## Handoff\` section:

### Summary
Free prose. Cover:
  - what you found
  - methodology you chose and why
  - for any persistent change: justification (especially skill update vs create)
  - one-line self-check against each <success_criteria> item: pass / fail / unknown + evidence

### Files changed
List every path you wrote to during this run, one per line, absolute paths.
Include scratch, artifacts, skills, FILES.md, GOAL.md, integrations.
The finisher will categorize. If you wrote nothing, write "(none)".`;
}
```

Note: `assistantProjectSkillsDir` is interpolated from `dirs` — verify the field exists on `AgentDirs` (it does, per `prompts.ts:13`).

- [ ] **Step 4: Update the caller in `worker-agent.ts`.**

Find the researcher preset (around `worker-agent.ts:196`) and pass `brief`:

```ts
researcher: (base, outputPath) => {
  // ... existing code ...
  return {
    ...base,
    toolNames: [...RESEARCHER_TOOL_NAMES],
    systemPromptAddition: researcherPrompt(dirs, outputPath, base.filesMdContent, base.brief),
    remainingDepth: 0,
  };
},
```

Add `brief?: string` to `WorkerAgentBase` interface (search the file for that interface definition) so the field type-checks. Plumb `brief` into the worker config from `ResearchService.ts` (the call to `createWorkerAgent` already has access to `config.brief` from Task 4).

- [ ] **Step 5: Run test to verify it passes.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors. If a caller in another file passes only three args to `researcherPrompt`, that still type-checks (brief is optional).

- [ ] **Step 7: Commit.**

```bash
git add src/main/agent/prompts.ts src/main/agent/prompts.test.ts src/main/agent/worker-agent.ts src/main/services/ResearchService.ts
git commit -m "feat(prompts): rewrite researcherPrompt around brief + mutable surfaces"
```

---

## Task 7: Rewrite `orchestratorPrompt`

**Files:**
- Modify: `src/main/agent/prompts.ts:96-134`
- Modify: `src/main/agent/prompts.test.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Write the failing test.**

Append to `src/main/agent/prompts.test.ts`:

```ts
import { orchestratorPrompt } from "./prompts";

describe("orchestratorPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the verbatim brief in a Research Brief section", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("## Research Brief");
    expect(out).toContain(brief);
  });

  it("instructs the orchestrator to construct sub-briefs", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("sub-brief");
    expect(out).toContain("spawn_agents_parallel");
  });

  it("uses ### Files changed handoff with union semantics", () => {
    const out = orchestratorPrompt(dirs, "/out", undefined, brief);
    expect(out).toContain("### Files changed");
    expect(out).toContain("union");
    expect(out).not.toContain("### Output Files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite the function.**

Replace `orchestratorPrompt` (lines 96-134 of `src/main/agent/prompts.ts`) with:

```ts
export function orchestratorPrompt(
  dirs: AgentDirs,
  outputPath: string,
  filesMdContent?: string,
  brief?: string,
): string {
  const briefSection = brief
    ? `## Research Brief
\`\`\`
${brief.trim()}
\`\`\``
    : `## Research Brief
(no brief — orchestrate the query as best you can; legacy invocation)`;

  const outputSection = filesMdContent
    ? `## Output Routing

FILES.md defines where research outputs should be saved. Best-effort follow it; the finisher will enforce.

\`\`\`
${filesMdContent.trim()}
\`\`\`

Write your final synthesis directly to \`userProjectDir\` following FILES.md conventions. Subtask outputs from spawned agents go to \`taskWorkspaceDir\` subdirectories — spawned agents write to their provided outputPath.`
    : `## Output

Write subtask outputs to subdirectories of \`taskWorkspaceDir\`. Write your final synthesis to \`${outputPath}\`.`;

  return `You are a research orchestrator. Plan and delegate subtasks to specialist agents, then synthesise their findings.

${briefSection}

${dirSection(dirs)}

## Mutable surfaces — you and your children may write to these

- ~/.scholar/skills/<name>/SKILL.md           — global capabilities
- ${dirs.assistantProjectSkillsDir}/<name>/SKILL.md — project-scoped capabilities
- ${dirs.assistantProjectDir}/FILES.md        — output routing for this project
- ${dirs.assistantProjectDir}/GOAL.md         — project intent
- ~/.scholar/config.md                        — global user preferences
- ${dirs.userProjectDir}/<anything>           — research artifacts

Each write here is a persistent system change. Path-jail will ask the user
to approve. Treat as you would a code commit, not a scratch file.

## Update over create

Before creating a new skill, the same rules apply to you and to your
spawned children: consult <available_skills>, read_skill on close matches,
prefer update via write_file, create only when no match exists.

${outputSection}

## Planning

1. Break the query into independent subtasks
2. For each subtask, construct a sub-brief — a narrower <research_brief>
   with <expected_outcomes> and <success_criteria> scoped to that subtask
   alone. Pass the sub-brief as the query to spawned children. The brief
   shape is uniform across nesting depth.
3. Use spawn_agents_parallel for subtasks that can run simultaneously
4. Use spawn_agent for sequential subtasks with dependencies
5. Each spawned agent receives its own outputPath within \`taskWorkspaceDir\`

## Scale autonomy

You are running as an orchestrator. You may spawn parallel or sequential
sub-researchers. If a brief turns out trivial, just answer without
spawning. Always justify chosen scale in the handoff Summary.

## Handoff (REQUIRED)

End your response with a \`## Handoff\` section:

### Summary
Free prose. Cover:
  - what you found
  - scale you chose and why
  - for any persistent change: justification
  - one-line self-check against each <success_criteria> item: pass / fail / unknown + evidence

### Files changed
Take the union of all \`### Files changed\` lists from spawned agents,
plus any file you wrote yourself. Dedup by absolute path. One per line.
If nothing was written, write "(none)".`;
}
```

- [ ] **Step 4: Update the caller in `worker-agent.ts`.**

Find the orchestrator preset (around `worker-agent.ts:224`) and pass `brief`:

```ts
orchestrator: (base, outputPath, depth) => {
  // ... existing code ...
  return {
    ...base,
    toolNames: [...ORCHESTRATOR_TOOL_NAMES],
    systemPromptAddition: orchestratorPrompt(dirs, outputPath, base.filesMdContent, base.brief),
    remainingDepth: depth,
  };
},
```

- [ ] **Step 5: Run test to verify it passes.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/main/agent/prompts.ts src/main/agent/prompts.test.ts src/main/agent/worker-agent.ts
git commit -m "feat(prompts): rewrite orchestratorPrompt with sub-brief planning"
```

---

## Task 8: Rewrite `finisherPrompt` to accept brief and enforce delivery

**Files:**
- Modify: `src/main/agent/prompts.ts:157-177`
- Modify: `src/main/agent/prompts.test.ts`

- [ ] **Step 1: Write the failing test.**

Append to `src/main/agent/prompts.test.ts`:

```ts
import { finisherPrompt } from "./prompts";

describe("finisherPrompt", () => {
  const dirs = buildAgentDirs({
    folderPath: "/u/proj",
    homePath: "/h/.scholar",
    slug: "p",
    taskWorkspaceDir: "/h/.scholar/projects/p/workspace/T1",
  });
  const brief = "<research_brief><user_request>R</user_request></research_brief>";

  it("includes the brief verbatim", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("## Research Brief (forwarded from coordinator)");
    expect(out).toContain(brief);
  });

  it("lists do-NOT-touch persistent surfaces", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("What you do NOT touch");
    expect(out).toContain("FILES.md");
    expect(out).toContain("GOAL.md");
    expect(out).toContain("config.md");
    expect(out).toContain("skill bodies");
  });

  it("documents the idempotency rule", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("Idempotency");
    expect(out).toContain("Do not overwrite correct work");
  });

  it("instructs format conversion via skills not inline scripts", () => {
    const out = finisherPrompt(dirs, undefined, brief);
    expect(out).toContain("read_skill");
    expect(out).toContain("execute_code");
    expect(out).toContain("do NOT improvise heavy logic");
  });

  it("includes FILES.md as delivery contract when present", () => {
    const out = finisherPrompt(dirs, "## Output locations\n- default: ./reports", brief);
    expect(out).toContain("Delivery contract — FILES.md");
    expect(out).toContain("default: ./reports");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite the function.**

Replace `finisherPrompt` (lines 157-177 of `src/main/agent/prompts.ts`) with:

```ts
export function finisherPrompt(
  dirs: AgentDirs,
  filesMdContent?: string,
  brief?: string,
): string {
  const briefSection = brief
    ? `## Research Brief (forwarded from coordinator)
\`\`\`
${brief.trim()}
\`\`\``
    : `## Research Brief (forwarded from coordinator)
(no brief — legacy invocation)`;

  const deliverySection = filesMdContent
    ? `## Delivery contract — FILES.md
\`\`\`
${filesMdContent.trim()}
\`\`\``
    : `## Delivery contract — FILES.md
(none — write to userProjectDir with descriptive filenames)`;

  return `You are a research finisher.

A research run just completed. Your job is two things:
  1. Deliver the user-facing artifacts in the shape FILES.md specifies
  2. Report what happened — including any persistent system changes the
     researcher made

${dirSection(dirs)}

${deliverySection}

## What you own
- Final format of user-facing artifacts (use conversion skills as needed)
- Final location of user-facing artifacts (respect FILES.md)
- Final naming of user-facing artifacts (respect FILES.md)
- The user-facing summary message

## What you do NOT touch
- ~/.scholar/skills/, ${dirs.assistantProjectSkillsDir}/  (skill bodies)
- ${dirs.assistantProjectDir}/FILES.md
- ${dirs.assistantProjectDir}/GOAL.md
- ~/.scholar/config.md
- Any file listed under <existing_state_to_consult> that researcher already wrote to

The researcher already wrote those. Your job is to surface them to the
user, not edit them.

## Idempotency

If the researcher already produced a file in the right format, in the
right location, with the right name — no action. Just acknowledge it.
Do not overwrite correct work.

## Workflow

1. Parse \`### Files changed\` from research output
2. Read the brief above to know success criteria
3. For each declared file:
     - read it
     - categorize: artifact / skill / FILES.md / GOAL.md / config / integration / scratch
     - if artifact and not yet matching FILES.md:
         - decide what transformation is needed (location, format, name)
         - if format conversion needed: consult <available_skills> →
           find a converter (e.g. md-to-pdf) → read_skill → execute_code to run it
         - if no skill exists for the needed conversion: surface the gap
           in your message — do NOT improvise heavy logic
4. Verify final delivery against <success_criteria>
5. Write user-facing summary

${briefSection}

## Tools
read_file, list_dir, read_memory, read_skill,
execute_code (running conversion skills),
write_file (artifacts only — path-jail blocks writes to skill dirs and
  config.md with an approval popup; FILES.md/GOAL.md are technically
  reachable but you MUST NOT touch them per "What you do NOT touch" above),
safe_bash (mv / rename / lightweight scripting only — no inline conversion)

## Output

Plain message to user. Under 200 words. Cover:
  - 2-3 concrete findings from the research itself
  - persistent system changes the researcher made (one bullet per change)
    e.g. "Updated FILES.md to require pdf for all outputs"
         "Created new skill md-to-pdf (~/.scholar/skills/md-to-pdf/)"
  - artifacts delivered (final paths + format)
  - any success_criteria that did NOT pass + why
  - any gap you couldn't fix (missing converter skill, FILES.md ambiguity)

Write ONLY the final message — no preamble, no tool output, no XML.`;
}
```

- [ ] **Step 4: Run test to verify it passes.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/agent/prompts.ts src/main/agent/prompts.test.ts
git commit -m "feat(prompts): rewrite finisherPrompt as delivery enforcer"
```

---

## Task 9: Rename handoff parser + plumb brief into finisher

**Files:**
- Modify: `src/main/services/ResearchFinisherService.ts`
- Modify: `src/main/services/__tests__/ResearchFinisherService.test.ts`

- [ ] **Step 1: Write the failing test.**

In `src/main/services/__tests__/ResearchFinisherService.test.ts`, find the existing test that exercises file-list parsing and rename the expected heading. Add a new test for back-compat absence:

```ts
import { parseFilesChanged } from "../ResearchFinisherService";

describe("parseFilesChanged", () => {
  it("parses paths under ### Files changed", () => {
    const text = `
## Handoff
### Files changed
/abs/path/one.md
/abs/path/two.pdf
`;
    expect(parseFilesChanged(text)).toEqual(["/abs/path/one.md", "/abs/path/two.pdf"]);
  });

  it("returns empty array when section absent", () => {
    expect(parseFilesChanged("no handoff here")).toEqual([]);
  });

  it("treats (none) as no files", () => {
    const text = "### Files changed\n(none)\n";
    expect(parseFilesChanged(text)).toEqual([]);
  });
});

describe("ResearchFinisherService — brief plumbing", () => {
  it("forwards brief into the finisher worker config", async () => {
    // Reuse existing mock setup in this file; add a brief to the job.
    const brief = "<research_brief><user_request>X</user_request></research_brief>";
    // existing makeJob() helper — extend its signature or override:
    const job = { ...makeJob(), brief };
    // assert that AGENT_TYPE_PRESETS.finisher receives `brief` somewhere
    // in its base (the mock can capture the call):
    await svc.finish(job);
    expect(presetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ brief }),
      expect.any(String),
      expect.any(Number),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/services/__tests__/ResearchFinisherService.test.ts
```

Expected: FAIL — `parseFilesChanged` not exported; `brief` not on `FinishJob`.

- [ ] **Step 3: Rename parser and add brief to `FinishJob`.**

In `src/main/services/ResearchFinisherService.ts`:

```ts
export interface FinishJob {
  projectId: string;
  projectName: string;
  query: string;
  brief?: string;           // NEW
  researchOutput: string;
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}

export function parseFilesChanged(text: string): string[] {
  const idx = text.indexOf("### Files changed");
  if (idx === -1) return [];
  const section = text.slice(idx + "### Files changed".length);
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
}
```

Delete the old `parseOutputFiles` function (was lines 24-32). Find every internal call to `parseOutputFiles` (likely in `_processJob` around line 68) and rename to `parseFilesChanged`.

In `_runFinisher` (around line 93), pass the brief into the preset call:

```ts
const workerConfig = AGENT_TYPE_PRESETS.finisher(
  {
    projectId: job.projectId,
    slug: job.slug,
    projectName: job.projectName,
    projectPath: job.projectPath,
    folderPath: job.folderPath,
    homePath,
    taskWorkspacePath: job.taskWorkspacePath,
    filesMdContent,
    brief: job.brief,                    // NEW
    provider: job.provider,
    allowlistService: this.allowlistService,
  },
  job.taskWorkspacePath,
  0,
);
```

- [ ] **Step 4: Update `ResearchService` to forward brief into `FinishJob`.**

In `src/main/services/ResearchService.ts`, find where `finisherService.finish({...})` is called (around line 220-250 typically, where `researchOutput` is constructed). Add `brief: task.brief ?? config.brief` to the object passed to `finish`. Verify the task object has `brief` (set in Task 4).

- [ ] **Step 5: Run test to verify it passes.**

```bash
bun run test src/main/services/__tests__/ResearchFinisherService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit.**

```bash
git add src/main/services/ResearchFinisherService.ts src/main/services/ResearchService.ts src/main/services/__tests__/ResearchFinisherService.test.ts
git commit -m "feat(finisher): rename parser to parseFilesChanged + plumb brief"
```

---

## Task 10: Expand finisher tool set + add `brief` to `WorkerAgentBase`

**Files:**
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/worker-agent.test.ts`

- [ ] **Step 1: Write the failing test.**

In `src/main/agent/worker-agent.test.ts`, add:

```ts
describe("AGENT_TYPE_PRESETS.finisher", () => {
  it("includes execute_code and read_skill in toolNames", () => {
    const dirs = {
      // minimal base fixture — copy from existing test pattern in this file
      projectId: "p1",
      slug: "p",
      projectName: "P",
      projectPath: null,
      folderPath: null,
      homePath: "/h/.scholar",
      taskWorkspacePath: "/h/.scholar/projects/p/workspace/T1",
      provider: { type: "openrouter", apiKey: "k", model: "m" } as any,
      allowlistService: {} as any,
    };
    const cfg = AGENT_TYPE_PRESETS.finisher(dirs, "/out", 0);
    expect(cfg.toolNames).toContain("execute_code");
    expect(cfg.toolNames).toContain("read_skill");
    expect(cfg.toolNames).toContain("write_file");
    expect(cfg.toolNames).toContain("safe_bash");
    expect(cfg.toolNames).toContain("read_file");
  });

  it("forwards brief into systemPromptAddition", () => {
    const brief = "<research_brief><user_request>X</user_request></research_brief>";
    const dirs = {
      projectId: "p1", slug: "p", projectName: "P", projectPath: null,
      folderPath: null, homePath: "/h/.scholar",
      taskWorkspacePath: "/h/.scholar/projects/p/workspace/T1",
      provider: { type: "openrouter", apiKey: "k", model: "m" } as any,
      allowlistService: {} as any,
      brief,
    };
    const cfg = AGENT_TYPE_PRESETS.finisher(dirs, "/out", 0);
    expect(cfg.systemPromptAddition).toContain(brief);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: FAIL — `execute_code` and `read_skill` not in finisher toolNames; `brief` not in `WorkerAgentBase`.

- [ ] **Step 3: Add `brief` to `WorkerAgentBase`.**

In `src/main/agent/worker-agent.ts`, find the `WorkerAgentBase` interface declaration (search for `interface WorkerAgentBase`). Add:

```ts
  brief?: string;
```

- [ ] **Step 4: Update the finisher preset.**

Replace the finisher preset (currently at `worker-agent.ts:228-241`) with:

```ts
finisher: (base, _outputPath) => {
  const dirs = buildAgentDirs({
    folderPath: base.folderPath,
    homePath: base.homePath,
    slug: base.slug,
    taskWorkspaceDir: base.taskWorkspacePath ?? base.homePath,
  });
  return {
    ...base,
    toolNames: [
      "read_file",
      "list_dir",
      "read_memory",
      "safe_bash",
      "write_file",
      "execute_code",
      "read_skill",
    ],
    systemPromptAddition: finisherPrompt(dirs, base.filesMdContent, base.brief),
    remainingDepth: 0,
  };
},
```

- [ ] **Step 5: Run test to verify it passes.**

```bash
bun run test src/main/agent/worker-agent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit.**

```bash
git add src/main/agent/worker-agent.ts src/main/agent/worker-agent.test.ts
git commit -m "feat(worker): finisher gains execute_code + read_skill + brief"
```

---

## Task 11: Kill `FIRST_RUN_SKILL`

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`
- Modify: `src/main/agent/system-prompt-builder.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/context.ts:120-127`
- Modify: any test that asserts `FIRST_RUN_SKILL` behavior

- [ ] **Step 1: Find all references.**

```bash
grep -rn "FIRST_RUN_SKILL\|firstRunPrompt\|isFirstRun" src --include="*.ts"
```

Expected references (verify each):
- `src/main/agent/builtin-skills.ts:3-44` — declaration
- `src/main/agent/system-prompt-builder.ts:3-10` — interface fields + branch
- `src/main/agent/MessagePipeline.ts:14, 96` — import + usage
- `src/main/agent/context.ts:120-127` — empty-state hint (does NOT reference the constant but is the alternative we strengthen)
- Any test file asserting first-run behavior

- [ ] **Step 2: Write the failing test.**

Append to `src/main/agent/prompts.test.ts` (or a new `system-prompt-builder.test.ts`):

```ts
import { buildSystemPrompt } from "./system-prompt-builder";

describe("buildSystemPrompt — no first-run branch", () => {
  it("returns the single base prompt regardless of project setup state", () => {
    const out = buildSystemPrompt({ basePrompt: "BASE", memorySummary: "MEM" });
    expect(out).toContain("BASE");
    expect(out).toContain("MEM");
  });

  it("does not accept firstRunPrompt or isFirstRun", () => {
    // TypeScript-level assertion: the field should not exist on the type.
    // Runtime: passing an extra unknown field should not change output.
    const out = buildSystemPrompt({
      basePrompt: "BASE",
      // @ts-expect-error firstRunPrompt is no longer on SystemPromptContext
      firstRunPrompt: "FIRST",
      // @ts-expect-error isFirstRun is no longer on SystemPromptContext
      isFirstRun: true,
    });
    expect(out).toContain("BASE");
    expect(out).not.toContain("FIRST");
  });
});
```

- [ ] **Step 3: Run test to verify it fails.**

```bash
bun run test src/main/agent/prompts.test.ts
```

Expected: FAIL — `firstRunPrompt` and `isFirstRun` still on `SystemPromptContext`, no `@ts-expect-error` error fires.

- [ ] **Step 4: Delete `FIRST_RUN_SKILL` from `builtin-skills.ts`.**

In `src/main/agent/builtin-skills.ts`, delete the entire `FIRST_RUN_SKILL` constant (currently lines 3-44, including the `export const FIRST_RUN_SKILL = ` line through the closing backtick).

- [ ] **Step 5: Strip first-run branch from `system-prompt-builder.ts`.**

Replace the full contents of `src/main/agent/system-prompt-builder.ts` with:

```ts
export interface SystemPromptContext {
  basePrompt: string;
  memorySummary?: string;
  systemContext?: string;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  return [ctx.basePrompt, ctx.memorySummary, ctx.systemContext].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 6: Drop the `firstRunPrompt` argument in `MessagePipeline.ts`.**

In `src/main/agent/MessagePipeline.ts`, find the prompt-builder call (around line 96) and remove the `firstRunPrompt: FIRST_RUN_SKILL` field and the `isFirstRun:` field from the object literal. Also remove the `import { FIRST_RUN_SKILL } from "./builtin-skills"` at the top of the file (line 14).

Search the file for any `isFirstRun` reference and remove. If the file derives `isFirstRun` from project state (e.g. "no GOAL.md exists"), the derivation logic can be deleted entirely — `context.ts` already surfaces an empty-state hint into the system context, which is now the single first-run signal.

- [ ] **Step 7: Sharpen `context.ts` empty-state hint.**

In `src/main/agent/context.ts`, find the empty-state block (lines 117-128) and replace with:

```ts
    const goalPath = join(projectPath, "GOAL.md");
    const filesPath = join(projectPath, "FILES.md");
    const setupHint = [
      "<!-- Missing project configuration — Create GOAL.md and FILES.md to guide the assistant -->",
      "This project has no GOAL.md or FILES.md yet. Ask the user the questions",
      "below, then construct a <research_brief> with",
      "<durability>persistent</durability> and <expected_outcomes> covering",
      "GOAL.md and FILES.md creation. Pass the brief to start_research even",
      "though it is a setup task — researcher will write the files following",
      "the same approval flow as any other persistent change.",
      "",
      "Questions to gather (one at a time):",
      "1. What is this project about? (for GOAL.md)",
      "2. Where should research outputs go? (for FILES.md)",
      "3. What file types do you mainly work with? (for FILES.md)",
      "4. Any naming conventions or folder structures? (for FILES.md)",
      "5. Detailed reports or concise summaries? (for config.md)",
      "6. Frequently used tools or workflows? (for config.md)",
      "",
      `GOAL.md goes to ${goalPath}; FILES.md goes to ${filesPath}.`,
    ].join("\n");
```

(The variable assignment that this block produces — likely concatenated into the `systemContext` returned by the function — should keep its existing wiring; only the multi-line string content changes.)

- [ ] **Step 8: Update any test that mocks first-run behavior.**

Search for tests that exercise `isFirstRun` or `FIRST_RUN_SKILL`:

```bash
grep -rn "FIRST_RUN_SKILL\|isFirstRun\|firstRunPrompt" src --include="*.test.ts"
```

In each test file, remove the corresponding assertion or replace with an assertion against the new `context.ts` empty-state hint (e.g. `expect(out).toContain("Missing project configuration")`).

- [ ] **Step 9: Run all tests.**

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 10: Run typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 11: Commit.**

```bash
git add src/main/agent/builtin-skills.ts src/main/agent/system-prompt-builder.ts src/main/agent/MessagePipeline.ts src/main/agent/context.ts src/main/agent/prompts.test.ts
git commit -m "refactor(setup): kill FIRST_RUN_SKILL — setup is persistent research over empty state"
```

---

## Task 12: Integration test — persistent flow

**Files:**
- Create: `src/main/services/__tests__/actionable-research.integration.test.ts`

This is an integration-style test that exercises the full chain: brief in → researcher prompt out → handoff parsed → finisher receives brief. It uses heavy mocking of the LLM call but real prompt construction.

- [ ] **Step 1: Write the test.**

```ts
import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";

const mockRun = vi.fn();
const mockAgent = { subscribe: vi.fn(), abort: vi.fn() };
const presetSpy = vi.fn().mockReturnValue({ systemPromptAddition: "", toolNames: [] });

vi.mock("../../agent/worker-agent", () => ({
  createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
  AGENT_TYPE_PRESETS: {
    researcher: presetSpy,
    finisher: presetSpy,
  },
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi.fn().mockReturnValue({ type: "openrouter", apiKey: "k", model: "m" }),
}));

describe("actionable research — persistent flow", () => {
  it("brief reaches researcher and finisher unchanged", async () => {
    const brief = `<research_brief>
  <user_request>from now on, all outputs as PDF</user_request>
  <durability>persistent</durability>
  <expected_outcomes>update FILES.md; create md-to-pdf skill</expected_outcomes>
</research_brief>`;

    // Mock the researcher's response to include the new handoff format.
    mockRun.mockResolvedValueOnce(`Research done.

## Handoff
### Summary
Picked pandoc. Updated FILES.md, created skill.
### Files changed
/h/.scholar/skills/md-to-pdf/SKILL.md
/h/.scholar/projects/p/FILES.md
`);
    mockRun.mockResolvedValueOnce("Set up PDF-only outputs.");

    // Build a ResearchService with mocked dependencies (reuse mock builders
    // from ResearchService.test.ts — copy the makeServiceUnderTest helper).
    const { ResearchService } = await import("../ResearchService");
    const svc = makeServiceUnderTest(); // see ResearchService.test.ts

    await svc.startResearch("p1", "P", brief, null, null);

    // Use one spy per preset so calls don't mix:
    expect(presetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ brief }),
      expect.any(String),
      expect.any(Number),
    );
    // Verify both researcher AND finisher receive the brief by mocking
    // them as separate spies:
    //
    //   const researcherSpy = vi.fn().mockReturnValue({ ... });
    //   const finisherSpy = vi.fn().mockReturnValue({ ... });
    //   vi.mock("../../agent/worker-agent", () => ({
    //     createWorkerAgent: vi.fn().mockResolvedValue({ run: mockRun, agent: mockAgent }),
    //     AGENT_TYPE_PRESETS: { researcher: researcherSpy, finisher: finisherSpy },
    //   }));
    //
    // Then:
    //   expect(researcherSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ brief }));
    //   expect(finisherSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ brief }));
  });
});
```

If the `makeServiceUnderTest` helper does not exist in the repo, copy the pattern from `ResearchService.test.ts` or refactor it into a shared `src/main/services/__tests__/_helpers.ts`.

- [ ] **Step 2: Run test to verify it passes.**

```bash
bun run test src/main/services/__tests__/actionable-research.integration.test.ts
```

Expected: PASS. If wiring gaps exist (e.g. brief not yet reaching finisher), the test surfaces them — fix the gap before claiming complete.

- [ ] **Step 3: Commit.**

```bash
git add src/main/services/__tests__/actionable-research.integration.test.ts
git commit -m "test: integration test for brief plumbing end-to-end"
```

---

## Task 13: Run full quality gate

- [ ] **Step 1: Typecheck.**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Biome lint + format.**

```bash
bun run check
```

Expected: zero issues (auto-fixed).

- [ ] **Step 3: Full test suite.**

```bash
bun run test
```

Expected: all green.

- [ ] **Step 4: Coverage.**

```bash
bun run test:coverage
```

Expected: ≥90% branches/functions/lines/statements per CLAUDE.md. If a new file falls below, add targeted tests for the missing branches.

- [ ] **Step 5: Manual smoke test (UI verification per CLAUDE.md).**

```bash
bun run dev -- --remote-debugging-port=9222
```

Steps:
1. Open a project. Verify the coordinator no longer enters the old `FIRST_RUN_SKILL` setup flow on an empty project — instead it surfaces the new empty-state hint and walks the questions.
2. Type "from now on, output everything as pdf". Verify coordinator detects persistent intent, constructs a brief, calls `start_research`. Watch for the path-jail approval popup when researcher writes `FILES.md` and/or any new skill.
3. After research completes, read the finisher's summary message: it should bullet the FILES.md change and skill creation.
4. Type a simple factual question ("what is 2+2"). Verify either direct answer or a one_shot brief — no system mutations attempted.

- [ ] **Step 6: Commit any quality-gate fixes if needed.**

```bash
git status
# If there are auto-fixes from `bun run check`:
git add -A
git commit -m "chore: apply biome auto-fixes from quality gate"
```

---

## Self-review checklist

After implementing, verify against the spec at `docs/superpowers/specs/2026-05-21-actionable-research-design.md`:

- [ ] Brief XML required tags wired (Task 5 ensures coordinator instructs researcher to produce all 8)
- [ ] `start_research(brief, deep)` signature change (Task 3)
- [ ] Researcher prompt has Research Brief slot, Mutable surfaces, Update-over-create, Format-and-delivery, Scale-autonomy, `### Files changed` (Task 6)
- [ ] Orchestrator prompt: sub-brief planning, union aggregation, `### Files changed` (Task 7)
- [ ] Finisher prompt: "What you own" / "What you do NOT touch" / Idempotency / Workflow / brief slot (Task 8)
- [ ] Finisher tool set expanded with `execute_code` + `read_skill` (Task 10)
- [ ] `parseOutputFiles` → `parseFilesChanged` rename (Task 9)
- [ ] `FIRST_RUN_SKILL` deleted; setup is brief over empty state (Task 11)
- [ ] `brief` persisted to tasks DB (Tasks 1+2) and forwarded through `ResearchService` → `FinishJob` (Tasks 4+9)
- [ ] Coverage ≥90% (Task 13)

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-actionable-research.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
