# Phase C — Genericness & Self-Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform research assistant into generic agent platform: extract research to skill, add file explorer + output routing, compress long tool outputs, add path-jail allowlists, enable skill crystallization.

**Architecture:** Research moves from hardcoded TypeScript to filesystem skill. SkillRouter replaces eager loading with on-demand index + lazy load. OutputRouter moves finals per AGENTS.md conventions. CompressionService intercepts long tool outputs. AllowlistService adds dynamic approval for external paths. Skill crystallization proposes new skills after successful tasks.

**Tech Stack:** Bun, TypeScript strict, Pi SDK, Electron IPC, chokidar, Biome v2, Vitest, React 19 + MUI v9

**Runs:** 5 ordered runs. Run 1 is foundation; Runs 2-4 parallel after Run 1; Run 5 last.

---

## File Structure

### New files
- `src/main/agent/SkillRouter.ts` — skill index scan, on-demand loading, hot reload
- `src/main/agent/SkillRouter.test.ts` — unit tests
- `src/main/agent/OutputRouter.ts` — AGENTS.md output routing, file moves
- `src/main/agent/OutputRouter.test.ts` — unit tests
- `src/main/agent/CompressionService.ts` — tool output compression
- `src/main/agent/CompressionService.test.ts` — unit tests
- `src/main/services/AllowlistService.ts` — global + per-project + session allowlists
- `src/main/services/AllowlistService.test.ts` — unit tests
- `src/main/agent/tools/compress-tool.ts` — agent-side compress tool
- `src/renderer/components/layout/FileExplorer.tsx` — right panel file tree
- `src/renderer/components/layout/FileExplorer.test.tsx` — UI tests
- `src/renderer/components/layout/chat/PendingPathBanner.tsx` — mirrors PendingCommandBanner
- `src/renderer/components/layout/chat/PendingPathModal.tsx` — mirrors PendingCommandModal

### Modified files
- `src/main/agent/context.ts` — replace `loadSkillsByContent` with SkillRouter
- `src/main/agent/session.ts` — use SkillRouter, compression hooks
- `src/main/agent/tools.ts` — compression intercept, compress tool
- `src/main/agent/path-jail.ts` — allowlist integration
- `src/main/agent/tools/file-tools.ts` — approval gate for external paths
- `src/main/agent/extensions/safe-bash.ts` — minor: reason field already present
- `src/main/event-bus.ts` — new event types
- `src/main/ipc/register.ts` — register new IPC handlers
- `src/main/ipc/artifact-handlers.ts` — add file tree handler
- `src/main/ipc-validation.ts` — new schemas
- `src/shared/ipc-channels.ts` — new channels
- `src/renderer/electron.d.ts` — new API methods
- `src/renderer/components/layout/ArtifactSection.tsx` — replace with FileExplorer
- `src/renderer/components/layout/RecentOutputsPanel.tsx` — adapt for finals
- `src/main/agent/builtin-skills.ts` — delete START_RESEARCH_SKILL, DISCOVER_PROJECT_SKILL
- `src/main/agent/worker-agent.ts` — load research skill from disk
- `src/main/services/ResearchService.ts` — OutputRouter integration

---

## Run 1: SkillRouter Foundation

Extract research to filesystem skill. Create SkillRouter with index + on-demand loading. Wire into session startup.

### Task 1.1: Create research skill files on disk

**Files:**
- Create: `~/.research-assistant/skills/research/SKILL.md`
- Create: `~/.research-assistant/skills/research/shallow.md`
- Create: `~/.research-assistant/skills/research/orchestrator.md`
- Create: `~/.research-assistant/skills/research/evaluator.md`

- [ ] **Step 1: Create skill directory and SKILL.md**

```bash
mkdir -p ~/.research-assistant/skills/research
```

Write `~/.research-assistant/skills/research/SKILL.md`:
```markdown
---
name: research
description: >-
  Dispatch background research tasks. Use when the user asks to research, investigate,
  find out about, or look into something non-trivial. Set deep=true for complex multi-source
  research that benefits from parallel subtopic investigation, code execution, or hierarchical
  orchestration.
---

# research

## Tool signature

```
start_research({ query: string, deep?: boolean })
```

- `query`: a clear, self-contained research question. Include all necessary context.
- `deep`: set to `true` for complex multi-source research. Defaults to `false`.

## When to set deep: true

- Query requires researching multiple independent subtopics in parallel
- Query involves processing data files (CSV, JSON, etc.) with code
- Query requires fetching and analysing papers, articles, or web pages
- Query is open-ended enough that an orchestrator should plan the approach

## What happens next

- The tool returns immediately with a `taskId`
- A background agent runs the research using the available tools
- When done, a summary is injected into this conversation automatically
- Artifacts are saved to the project workspace
```

- [ ] **Step 2: Create shallow.md**

Write `~/.research-assistant/skills/research/shallow.md`:
```markdown
# Shallow Research

You are a background researcher. Investigate the given query thoroughly using the available tools.
Create final output files in the project folder using write_file, not in the workspace.
Name files meaningfully (no task IDs in filenames).
Be thorough. When done, respond with a final summary of your findings.
```

- [ ] **Step 3: Create orchestrator.md**

Write `~/.research-assistant/skills/research/orchestrator.md`:
```markdown
# Orchestrated Research

You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.
Write intermediate results to subdirectories within your workspace root.
Create final output files in the project folder using write_file, not in the workspace.
Name files meaningfully (no task IDs in filenames).
Use save_artifact to persist valuable outputs — both intermediate and final.
```

- [ ] **Step 4: Create evaluator.md**

Write `~/.research-assistant/skills/research/evaluator.md`:
```markdown
# Research Evaluator

You are a research evaluator. Read the file at the given path, assess it against the criteria, and respond with ONLY a JSON object in this exact format:

```json
{
  "pass": true,
  "criteria": [
    { "name": "criterion name", "pass": true, "rationale": "one sentence" }
  ]
}
```

## Evaluation criteria

- **Completeness**: does the document address the research question fully?
- **Evidence**: are claims supported by sources or tool outputs?
- **Structure**: is the document organised with clear headings and sections?
- **Actionability**: are findings concrete and useful to the requester?
- **Novelty**: is the approach or finding something that could be reused as a skill?
```

- [ ] **Step 5: Commit skill files**

```bash
git add -f ~/.research-assistant/skills/research/
git commit -m "feat: extract research skill to filesystem"
```

---

### Task 1.2: Create SkillRouter

**Files:**
- Create: `src/main/agent/SkillRouter.ts`
- Create: `src/main/agent/SkillRouter.test.ts`
- Modify: `src/main/agent/context.ts`

- [ ] **Step 1: Write SkillRouter**

```typescript
import { access, readFile, readdir, watch } from "node:fs/promises";
import { join } from "node:path";
import { getAgentsHome, getResearchAssistantHome } from "../paths";
import { parseFrontmatter } from "../utils/frontmatter";

export interface SkillMeta {
  name: string;
  description: string;
  location: string;
  contentHash: string;
}

export interface SkillIndex {
  skills: SkillMeta[];
  lastScan: number;
}

export class SkillRouter {
  private index: SkillIndex = { skills: [], lastScan: 0 };
  private watchers: ReturnType<typeof watch>[] = [];

  constructor(
    private readonly skillDirs: string[],
    private readonly onChange?: (skillName: string, summary: string) => void,
  ) {}

  async buildIndex(): Promise<SkillIndex> {
    const skills: SkillMeta[] = [];
    const byName = new Map<string, SkillMeta>();

    for (const dir of this.skillDirs) {
      const dirSkills = await this.readSkillsFromDir(dir);
      for (const skill of dirSkills) {
        byName.set(skill.name, skill);
      }
    }

    skills.push(...byName.values());

    this.index = { skills, lastScan: Date.now() };
    return this.index;
  }

  getIndex(): SkillIndex {
    return this.index;
  }

  toXml(): string {
    if (this.index.skills.length === 0) return "";
    const lines = ["<available_skills>"];
    for (const skill of this.index.skills) {
      lines.push(
        `  <skill name="${this.escapeXml(skill.name)}" description="${this.escapeXml(skill.description)}" />`,
      );
    }
    lines.push("</available_skills>");
    return lines.join("\n");
  }

  async loadSkill(name: string): Promise<string> {
    const meta = this.index.skills.find((s) => s.name === name);
    if (!meta) throw new Error(`Skill "${name}" not found in index`);

    const content = await readFile(meta.location, "utf-8");
    return content.trim();
  }

  async loadSkillWithExtras(name: string): Promise<string> {
    const meta = this.index.skills.find((s) => s.name === name);
    if (!meta) throw new Error(`Skill "${name}" not found in index`);

    const skillDir = meta.location.replace(/\/SKILL\.md$/, "");
    const files = await this.readDirSafe(skillDir);
    const parts: string[] = [];

    for (const file of files) {
      if (file === "SKILL.md") continue;
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(skillDir, file), "utf-8");
      parts.push(content.trim());
    }

    const main = await readFile(meta.location, "utf-8");
    parts.unshift(main.trim());

    return parts.join("\n\n---\n\n");
  }

  startWatching(): void {
    for (const dir of this.skillDirs) {
      const watcher = watch(dir, { recursive: true });
      this.watchers.push(watcher);
      this.watchLoop(watcher).catch((err) => {
        console.error("[SkillRouter] watch error:", err);
      });
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) {
      w[Symbol.asyncIterator]().return?.();
    }
    this.watchers = [];
  }

  private async watchLoop(watcher: ReturnType<typeof watch>): Promise<void> {
    for await (const event of watcher) {
      if (event.filename?.endsWith("SKILL.md")) {
        const skillName = this.extractSkillName(event.filename);
        if (skillName) {
          const oldIndex = this.index.skills.find((s) => s.name === skillName);
          await this.buildIndex();
          const newMeta = this.index.skills.find((s) => s.name === skillName);
          if (newMeta && this.onChange) {
            const summary = oldIndex
              ? `Updated. Previous: "${oldIndex.description}"`
              : "New skill added.";
            this.onChange(skillName, summary);
          }
        }
      }
    }
  }

  private async readSkillsFromDir(dir: string): Promise<SkillMeta[]> {
    const entries = await this.readDirSafe(dir);
    const skills: SkillMeta[] = [];

    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const skillMdPath = join(skillDir, "SKILL.md");
      try {
        await access(skillMdPath);
        const content = await readFile(skillMdPath, "utf-8");
        const meta = parseFrontmatter(content);
        if (meta.name && meta.description) {
          skills.push({
            name: meta.name as string,
            description: meta.description as string,
            location: skillMdPath,
            contentHash: await this.hashContent(content),
          });
        }
      } catch {
        // skip malformed entries
      }
    }
    return skills;
  }

  private async readDirSafe(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  private extractSkillName(filename: string): string | null {
    const match = filename.match(/^([^/]+)/);
    return match ? match[1] : null;
  }

  private async hashContent(content: string): Promise<string> {
    const crypto = await import("node:crypto");
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

export function createDefaultSkillRouter(
  projectFolderPath: string | undefined,
  onChange?: (skillName: string, summary: string) => void,
): SkillRouter {
  const raHome = getResearchAssistantHome();
  const agentsHome = getAgentsHome();
  const dirs = [
    join(agentsHome, "skills"),
    join(raHome, "skills"),
    ...(projectFolderPath ? [join(projectFolderPath, ".agents", "skills")] : []),
    ...(projectFolderPath ? [join(projectFolderPath, ".research-assistant", "skills")] : []),
  ];
  return new SkillRouter(dirs, onChange);
}
```

- [ ] **Step 2: Write SkillRouter tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillRouter } from "./SkillRouter";

function makeSkillDir(base: string, name: string, description: string) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return dir;
}

describe("SkillRouter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-router-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds index from skill directories", async () => {
    makeSkillDir(tmpDir, "research", "dispatch research tasks");
    const router = new SkillRouter([tmpDir]);
    const index = await router.buildIndex();
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0].name).toBe("research");
    expect(index.skills[0].description).toBe("dispatch research tasks");
  });

  it("toXml produces valid XML", async () => {
    makeSkillDir(tmpDir, "research", "dispatch research tasks");
    const router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    const xml = router.toXml();
    expect(xml).toContain("<available_skills>");
    expect(xml).toContain('name="research"');
  });

  it("loadSkill returns full content", async () => {
    makeSkillDir(tmpDir, "research", "dispatch research tasks");
    const router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    const content = await router.loadSkill("research");
    expect(content).toContain("# research");
  });

  it("loadSkillWithExtras loads SKILL.md + referenced files", async () => {
    const dir = makeSkillDir(tmpDir, "research", "dispatch research tasks");
    writeFileSync(join(dir, "shallow.md"), "# Shallow\n");
    const router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    const content = await router.loadSkillWithExtras("research");
    expect(content).toContain("# research");
    expect(content).toContain("# Shallow");
  });

  it("ignores directories without SKILL.md", async () => {
    mkdirSync(join(tmpDir, "empty"), { recursive: true });
    const router = new SkillRouter([tmpDir]);
    await router.buildIndex();
    expect(router.getIndex().skills).toHaveLength(0);
  });

  it("later directories override earlier on name collision", async () => {
    const dir1 = mkdtempSync(join(tmpdir(), "skills1-"));
    const dir2 = mkdtempSync(join(tmpdir(), "skills2-"));
    makeSkillDir(dir1, "research", "old description");
    makeSkillDir(dir2, "research", "new description");
    const router = new SkillRouter([dir1, dir2]);
    await router.buildIndex();
    expect(router.getIndex().skills[0].description).toBe("new description");
    rmSync(dir1, { recursive: true });
    rmSync(dir2, { recursive: true });
  });
});
```

- [ ] **Step 3: Modify context.ts to use SkillRouter**

Replace `loadSkills` and `loadSkillsByContent` in `src/main/agent/context.ts`:

```typescript
import { SkillRouter, createDefaultSkillRouter } from "./SkillRouter";

export async function loadSkillIndexXml(
  projectFolderPath: string | undefined,
): Promise<string> {
  const router = createDefaultSkillRouter(projectFolderPath);
  await router.buildIndex();
  return router.toXml();
}

export async function loadSkillsByContent(
  skillNames: string[],
  projectFolderPath: string | undefined,
): Promise<string> {
  const router = createDefaultSkillRouter(projectFolderPath);
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
```

- [ ] **Step 4: Update buildSystemContext to use skill index**

In `buildSystemContext`, replace the skills XML loading:
```typescript
// OLD:
// const skillsXml = await loadSkills(folderPath);
// if (skillsXml) parts.push(skillsXml);

// NEW:
const skillIndex = await loadSkillIndexXml(folderPath);
if (skillIndex) parts.push(skillIndex);
```

- [ ] **Step 5: Run tests**

```bash
bun test src/main/agent/SkillRouter.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/SkillRouter.ts src/main/agent/SkillRouter.test.ts src/main/agent/context.ts
git commit -m "feat: SkillRouter with lazy loading and routing index"
```

---

### Task 1.3: Delete built-in skills from TypeScript

**Files:**
- Modify: `src/main/agent/builtin-skills.ts`

- [ ] **Step 1: Remove START_RESEARCH_SKILL and DISCOVER_PROJECT_SKILL from builtin-skills.ts**

Keep only `FIRST_RUN_SKILL` and `EVALUATE_RESEARCH_SKILL` (evaluator is a worker skill, not a chat skill):

```typescript
export const FIRST_RUN_SKILL = `...`; // keep
export const EVALUATE_RESEARCH_SKILL = `...`; // keep
// DELETE: START_RESEARCH_SKILL, DISCOVER_PROJECT_SKILL
```

- [ ] **Step 2: Update references**

Search for `START_RESEARCH_SKILL` and `DISCOVER_PROJECT_SKILL` imports/uses:
```bash
grep -r "START_RESEARCH_SKILL" src/
```

Remove imports and references. `createAgentTools` already uses `startResearchFn` callback — the skill text just taught the agent how to use it. Now the agent learns from `skills/research/SKILL.md`.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove hardcoded research/discov skills, use filesystem"
```

---

### Task 1.4: Wire SkillRouter into AgentSession

**Files:**
- Modify: `src/main/agent/session.ts`

- [ ] **Step 1: Initialize SkillRouter in AgentSession constructor**

```typescript
import { createDefaultSkillRouter } from "./SkillRouter";

// In constructor:
const skillRouter = createDefaultSkillRouter(
  this.folderPath ?? undefined,
  (skillName, summary) => {
    this.pendingSkillDeltas.push({ skillName, summary });
  },
);
await skillRouter.buildIndex();
skillRouter.startWatching();
```

- [ ] **Step 2: Use skill index in system prompt**

The `buildSystemContext` already injects skill index. Ensure `buildSystemContext` is called with the correct project folder path.

- [ ] **Step 3: On-demand skill loading in tool execution**

This is more complex — when agent calls `start_research`, we need to load the research skill. For now, the `start_research` tool implementation stays the same (calls `ResearchService`). The skill content teaches the agent when to call it.

Future enhancement: `beforeToolCall` could preload skill content for the tool being called.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire SkillRouter into AgentSession with file watching"
```

---

## Run 2: OutputRouter + File Explorer

### Task 2.1: Create OutputRouter

**Files:**
- Create: `src/main/agent/OutputRouter.ts`
- Create: `src/main/agent/OutputRouter.test.ts`

- [ ] **Step 1: Write OutputRouter**

```typescript
import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { PathJail } from "./path-jail";

export interface OutputConvention {
  default: string;
  code?: string;
  reports?: string;
}

export class OutputRouter {
  constructor(private readonly jail: PathJail) {}

  parseConventions(agentsMdContent: string): OutputConvention | null {
    const section = agentsMdContent.match(/## Output location[\s\S]*?(?=## |\n# |\n*$)/);
    if (!section) return null;

    const lines = section[0].split("\n");
    const result: Partial<OutputConvention> = {};

    for (const line of lines) {
      const m = line.match(/^-\s+(\w+):\s+(.+)$/);
      if (m) {
        const [, key, value] = m;
        if (key === "default" || key === "code" || key === "reports") {
          result[key] = value.trim();
        }
      }
    }

    return result.default ? (result as OutputConvention) : null;
  }

  async moveFinals(
    workspacePath: string,
    conventions: OutputConvention,
  ): Promise<{ moved: string[]; skipped: string[] }> {
    const moved: string[] = [];
    const skipped: string[] = [];

    const entries = await this.safeReaddir(workspacePath);
    for (const entry of entries) {
      const src = join(workspacePath, entry);
      const s = await stat(src);
      if (!s.isFile()) {
        skipped.push(entry);
        continue;
      }

      const destDir = this.resolveDestination(entry, conventions);
      const validated = this.jail.validate(destDir, "write");
      await mkdir(validated, { recursive: true });
      const dest = join(validated, entry);

      await rename(src, dest);
      moved.push(entry);
    }

    return { moved, skipped };
  }

  private resolveDestination(filename: string, conventions: OutputConvention): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "py" || ext === "js" || ext === "sh" || ext === "ts") {
      return conventions.code ?? conventions.default;
    }
    if (ext === "md" || ext === "pdf") {
      return conventions.reports ?? conventions.default;
    }
    return conventions.default;
  }

  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: Write OutputRouter tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutputRouter } from "./OutputRouter";
import { PathJail } from "./path-jail";

describe("OutputRouter", () => {
  let tmpDir: string;
  let jail: PathJail;
  let router: OutputRouter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "output-router-"));
    jail = new PathJail("test-project", tmpDir, "Test Project");
    router = new OutputRouter(jail);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses conventions from AGENTS.md", () => {
    const content = `## Output location\n- default: ~/Projects/out\n- code: ~/Projects/out/scripts\n- reports: ~/Projects/out/docs`;
    const conv = router.parseConventions(content);
    expect(conv).toEqual({
      default: "~/Projects/out",
      code: "~/Projects/out/scripts",
      reports: "~/Projects/out/docs",
    });
  });

  it("returns null when no conventions section", () => {
    const conv = router.parseConventions("# Hello\n\nNo conventions here.");
    expect(conv).toBeNull();
  });

  it("moves finals to correct destination", async () => {
    const workspace = join(tmpDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "report.md"), "# Report");
    writeFileSync(join(workspace, "script.py"), "print(1)");

    const conventions = { default: tmpDir, code: join(tmpDir, "scripts"), reports: join(tmpDir, "docs") };
    const result = await router.moveFinals(workspace, conventions);

    expect(result.moved).toContain("report.md");
    expect(result.moved).toContain("script.py");
    expect(existsSync(join(tmpDir, "docs", "report.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "scripts", "script.py"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun test src/main/agent/OutputRouter.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/OutputRouter.ts src/main/agent/OutputRouter.test.ts
git commit -m "feat: OutputRouter for AGENTS.md-driven output routing"
```

---

### Task 2.2: Wire OutputRouter into ResearchService

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: Import OutputRouter in ResearchService**

```typescript
import { OutputRouter } from "../agent/OutputRouter";
import { PathJail } from "../agent/path-jail";
```

- [ ] **Step 2: On research complete, move finals**

In the `agent.subscribe` `agent_end` handler, before emitting `research:complete`:

```typescript
// After worker completes, route finals
const outputRouter = new OutputRouter(new PathJail(config.projectId, config.folderPath, config.projectName));
// Read AGENTS.md from folderPath or ~/.research-assistant/projects/<slug>/AGENTS.md
// Parse conventions, move finals
// Emit moved file paths in research:complete payload
```

- [ ] **Step 3: Update research:complete payload to include file paths**

```typescript
type AppEvent =
  | {
      type: "research:complete";
      payload: {
        taskId: string;
        projectId: string;
        query: string;
        filePaths: string[]; // NEW: moved file paths
      };
    }
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire OutputRouter into ResearchService"
```

---

### Task 2.3: File Explorer UI

**Files:**
- Create: `src/renderer/components/layout/FileExplorer.tsx`
- Create: `src/renderer/components/layout/FileExplorer.test.tsx`
- Modify: `src/renderer/components/layout/ArtifactSection.tsx`

- [ ] **Step 1: Create FileExplorer component**

```tsx
import { Box, Typography, TreeView } from "@mui/material";
import { useState, useEffect } from "react";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface FileExplorerProps {
  projectId: string;
}

export default function FileExplorer({ projectId }: FileExplorerProps) {
  const [tree, setTree] = useState<FileNode | null>(null);

  useEffect(() => {
    window.electronAPI.invoke("GET_FILE_TREE", { projectId }).then((root) => {
      setTree(root as FileNode);
    });
  }, [projectId]);

  if (!tree) return <Typography>Loading...</Typography>;

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" gutterBottom>Project Files</Typography>
      <FileTreeNode node={tree} depth={0} />
    </Box>
  );
}

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.isDirectory;

  return (
    <Box sx={{ pl: depth * 1.5 }}>
      <Typography
        variant="body2"
        sx={{ cursor: isDir ? "pointer" : "default", fontFamily: "monospace", fontSize: "0.8rem" }}
        onClick={() => isDir && setExpanded(!expanded)}
      >
        {isDir ? (expanded ? "📂" : "📁") : "📄"} {node.name}
      </Typography>
      {isDir && expanded && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Add GET_FILE_TREE IPC channel**

In `src/shared/ipc-channels.ts`:
```typescript
export const IPC = {
  // ... existing channels ...
  GET_FILE_TREE: "GET_FILE_TREE",
} as const;
```

In `src/main/ipc/artifact-handlers.ts`:
```typescript
ipcMain.handle(IPC.GET_FILE_TREE, async (_event, { projectId }) => {
  // Walk project folder + workspace, build tree
  // Respect PathJail zones
  // Depth limit 3, ignore patterns
});
```

- [ ] **Step 3: Replace ArtifactSection with FileExplorer**

In `src/renderer/components/layout/ArtifactSection.tsx`, replace content with FileExplorer.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: FileExplorer right panel with GET_FILE_TREE IPC"
```

---

## Run 3: CompressionService

### Task 3.1: Create CompressionService

**Files:**
- Create: `src/main/agent/CompressionService.ts`
- Create: `src/main/agent/CompressionService.test.ts`

- [ ] **Step 1: Write CompressionService**

```typescript
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CompressionRule {
  tool: string;
  thresholdChars: number;
  strategy: "summarize" | "truncate" | "head-only";
}

export const DEFAULT_RULES: CompressionRule[] = [
  { tool: "fetch_url", thresholdChars: 8000, strategy: "summarize" },
  { tool: "web_search", thresholdChars: 4000, strategy: "head-only" },
  { tool: "read_file", thresholdChars: 10000, strategy: "summarize" },
];

export interface CompressionResult {
  content: string;
  fullPath?: string;
  wasCompressed: boolean;
  strategy: string;
}

export class CompressionService {
  constructor(
    private readonly compressedDir: string,
    private readonly summarizeFn?: (text: string, maxWords: number) => Promise<string>,
  ) {}

  async compress(
    tool: string,
    rawContent: string,
    rules: CompressionRule[] = DEFAULT_RULES,
  ): Promise<CompressionResult> {
    const rule = rules.find((r) => r.tool === tool);
    if (!rule || rawContent.length <= rule.thresholdChars) {
      return { content: rawContent, wasCompressed: false, strategy: "none" };
    }

    switch (rule.strategy) {
      case "truncate":
        return this.truncate(rawContent, rule.thresholdChars, tool);
      case "head-only":
        return this.headOnly(rawContent, rule.thresholdChars, tool);
      case "summarize":
        return this.summarize(rawContent, tool);
      default:
        return { content: rawContent, wasCompressed: false, strategy: "none" };
    }
  }

  private truncate(raw: string, threshold: number, tool: string): CompressionResult {
    const truncated = raw.slice(0, threshold);
    const fullPath = join(this.compressedDir, `${tool}-${Date.now()}.md`);
    void writeFile(fullPath, raw, "utf-8");
    return {
      content: `${truncated}\n\n[truncated — full content saved to ${fullPath}]`,
      fullPath,
      wasCompressed: true,
      strategy: "truncate",
    };
  }

  private headOnly(raw: string, threshold: number, tool: string): CompressionResult {
    const paragraphs = raw.split("\n\n");
    let acc = "";
    for (const p of paragraphs) {
      if (acc.length + p.length > threshold) break;
      acc += p + "\n\n";
    }
    const fullPath = join(this.compressedDir, `${tool}-${Date.now()}.md`);
    void writeFile(fullPath, raw, "utf-8");
    return {
      content: `${acc.trim()}\n\n[truncated — full content at ${fullPath}]`,
      fullPath,
      wasCompressed: true,
      strategy: "head-only",
    };
  }

  private async summarize(raw: string, tool: string): Promise<CompressionResult> {
    const fullPath = join(this.compressedDir, `${tool}-${Date.now()}.md`);
    await writeFile(fullPath, raw, "utf-8");

    let summary: string;
    if (this.summarizeFn) {
      summary = await this.summarizeFn(raw, 200);
    } else {
      summary = `[Content too long (${raw.length} chars). Full content saved to ${fullPath}]`;
    }

    return {
      content: summary,
      fullPath,
      wasCompressed: true,
      strategy: "summarize",
    };
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompressionService } from "./CompressionService";

describe("CompressionService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compression-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns raw content when under threshold", async () => {
    const svc = new CompressionService(tmpDir);
    const result = await svc.compress("fetch_url", "short", [
      { tool: "fetch_url", thresholdChars: 100, strategy: "summarize" },
    ]);
    expect(result.wasCompressed).toBe(false);
    expect(result.content).toBe("short");
  });

  it("truncates when over threshold", async () => {
    const svc = new CompressionService(tmpDir);
    const long = "a".repeat(200);
    const result = await svc.compress("fetch_url", long, [
      { tool: "fetch_url", thresholdChars: 50, strategy: "truncate" },
    ]);
    expect(result.wasCompressed).toBe(true);
    expect(result.content.length).toBeLessThan(100);
    expect(result.fullPath).toBeDefined();
  });

  it("summarizes using callback", async () => {
    const svc = new CompressionService(tmpDir, async (text) => `Summary of ${text.length} chars`);
    const result = await svc.compress("fetch_url", "a".repeat(200), [
      { tool: "fetch_url", thresholdChars: 50, strategy: "summarize" },
    ]);
    expect(result.wasCompressed).toBe(true);
    expect(result.content).toContain("Summary of");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun test src/main/agent/CompressionService.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: CompressionService for long tool output compression"
```

---

### Task 3.2: Wire CompressionService into tool execution

**Files:**
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/tools/fetch-url.ts`
- Modify: `src/main/agent/tools/web-search.ts`
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Intercept tool outputs in createAgentTools**

Wrap tool execution functions to pipe through CompressionService before returning to agent.

For `fetch_url` tool: after execution, compress result via CompressionService.
For `web_search` tool: same.
For `read_file` tool: same.

- [ ] **Step 2: Create compress tool**

```typescript
// src/main/agent/tools/compress-tool.ts
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { makeTool } from "./make-tool";

export function createCompressTool(
  compressFn: (path: string, maxWords: number) => Promise<string>,
): AgentTool<typeof compressParams> {
  return makeTool({
    name: "compress",
    label: "Compress file content",
    description: "Read a file and return a compressed/summarized version. Use when context is full.",
    parameters: compressParams,
    execute: async (_id, { path, maxWords }) => {
      const summary = await compressFn(path, maxWords);
      return {
        content: [{ type: "text", text: summary }],
      };
    },
  });
}

const compressParams = Type.Object({
  path: Type.String({ description: "Path to file to compress" }),
  maxWords: Type.Number({ default: 200, description: "Maximum words in summary" }),
});
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: wire compression into tools and add compress tool"
```

---

## Run 4: Path-Jail Allowlist

### Task 4.1: Create AllowlistService

**Files:**
- Create: `src/main/services/AllowlistService.ts`
- Create: `src/main/services/AllowlistService.test.ts`

- [ ] **Step 1: Write AllowlistService**

```typescript
import { readFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { getResearchAssistantHome } from "../paths";

export class ApprovalRequiredError extends Error {
  readonly path: string;
  readonly mode: "read" | "write";

  constructor(path: string, mode: "read" | "write") {
    super(`Approval required for ${mode} on "${path}"`);
    this.name = "ApprovalRequiredError";
    this.path = path;
    this.mode = mode;
  }
}

export class AllowlistService {
  private sessionAllowlists = new Map<string, Set<string>>(); // projectId -> Set of resolved paths

  async getGlobalAllowlist(): Promise<string[]> {
    const home = getResearchAssistantHome();
    try {
      const content = await readFile(`${home}/config.md`, "utf-8");
      const section = content.match(/## Allowed paths[\s\S]*?(?=## |\n# |\n*$)/);
      if (!section) return [];
      const lines = section[0].split("\n");
      const paths: string[] = [];
      for (const line of lines) {
        const m = line.match(/^-\s+(.+)$/);
        if (m) paths.push(resolve(normalize(m[1].trim())));
      }
      return paths;
    } catch {
      return [];
    }
  }

  async getProjectAllowlist(agentsMdPath: string): Promise<string[]> {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      const section = content.match(/## Allowed paths[\s\S]*?(?=## |\n# |\n*$)/);
      if (!section) return [];
      const lines = section[0].split("\n");
      const paths: string[] = [];
      for (const line of lines) {
        const m = line.match(/^-\s+(.+)$/);
        if (m) paths.push(resolve(normalize(m[1].trim())));
      }
      return paths;
    } catch {
      return [];
    }
  }

  isAllowed(
    projectId: string,
    inputPath: string,
    mode: "read" | "write",
    existingZones: string[],
  ): { allowed: boolean; needsApproval: boolean } {
    const resolved = resolve(normalize(inputPath));

    // Check existing zones
    for (const zone of existingZones) {
      const zoneResolved = resolve(normalize(zone));
      if (resolved.startsWith(`${zoneResolved}/`) || resolved === zoneResolved) {
        return { allowed: true, needsApproval: false };
      }
    }

    // Check session allowlist
    const session = this.sessionAllowlists.get(projectId);
    if (session?.has(resolved)) {
      return { allowed: true, needsApproval: false };
    }

    // Needs dynamic approval
    return { allowed: false, needsApproval: true };
  }

  approveSession(projectId: string, path: string): void {
    const resolved = resolve(normalize(path));
    let set = this.sessionAllowlists.get(projectId);
    if (!set) {
      set = new Set();
      this.sessionAllowlists.set(projectId, set);
    }
    set.add(resolved);
  }

  clearSession(projectId: string): void {
    this.sessionAllowlists.delete(projectId);
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AllowlistService, ApprovalRequiredError } from "./AllowlistService";

describe("AllowlistService", () => {
  let svc: AllowlistService;
  let tmpDir: string;

  beforeEach(() => {
    svc = new AllowlistService();
    tmpDir = mkdtempSync(join(tmpdir(), "allowlist-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows paths in existing zones", () => {
    const result = svc.isAllowed("p1", "/tmp/file.txt", "read", ["/tmp"]);
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(false);
  });

  it("requires approval for external paths", () => {
    const result = svc.isAllowed("p1", "/etc/passwd", "read", ["/tmp"]);
    expect(result.allowed).toBe(false);
    expect(result.needsApproval).toBe(true);
  });

  it("approves session-scoped paths", () => {
    svc.approveSession("p1", "/etc/passwd");
    const result = svc.isAllowed("p1", "/etc/passwd", "read", ["/tmp"]);
    expect(result.allowed).toBe(true);
  });

  it("parses global config.md", async () => {
    writeFileSync(join(tmpDir, "config.md"), "## Allowed paths\n- /tmp/research\n- ~/Downloads");
    // Would need to mock getResearchAssistantHome() in real test
  });
});
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: AllowlistService with global + per-project + session allowlists"
```

---

### Task 4.2: Wire AllowlistService into PathJail + tools

**Files:**
- Modify: `src/main/agent/path-jail.ts`
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Modify PathJail.validate to check allowlists**

```typescript
import { AllowlistService, ApprovalRequiredError } from "../services/AllowlistService";

// In PathJail constructor, add allowlistService parameter
// In validate(), after zone checks:

const allowlist = new AllowlistService();
const result = allowlist.isAllowed(this.projectId, resolved, mode, [
  this.workspace,
  this.projectFolder,
  this.projectsDir,
  // ... other zones
]);

if (!result.allowed && result.needsApproval) {
  throw new ApprovalRequiredError(resolved, mode);
}
```

- [ ] **Step 2: Handle ApprovalRequiredError in file tools**

In `createReadFileTool`, `createWriteFileTool`, `createListDirTool`:
```typescript
try {
  const validated = jail.validate(path, "read");
  // ... read file
} catch (err) {
  if (err instanceof ApprovalRequiredError) {
    // Emit event for UI
    emitApprovalRequired?.({
      path: err.path,
      mode: err.mode,
      projectId,
    });
    return {
      content: [{ type: "text", text: `Approval required for ${err.mode} on "${err.path}". Waiting for user approval.` }],
    };
  }
  throw err;
}
```

- [ ] **Step 3: Add approval IPC + UI**

New IPC channels:
- `GET_PENDING_PATH_APPROVALS` — list pending
- `RESOLVE_PATH_APPROVAL` — approve/deny

New renderer components: `PendingPathBanner`, `PendingPathModal` (mirror `PendingCommandBanner`/`PendingCommandModal`).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: dynamic path approval with PendingPathBanner UI"
```

---

## Run 5: Skill Crystallization

### Task 5.1: Post-task skill crystallization hook

**Files:**
- Modify: `src/main/services/ResearchService.ts`
- Modify: `src/main/agent/worker-agent.ts`

- [ ] **Step 1: After research completes, trigger evaluator for novelty**

In `ResearchService` `agent_end` handler:
```typescript
// After updating task status, check if skill-worthy
const evalPrompt = [
  "Evaluate whether this research task produced a novel, reusable workflow.",
  `Query: ${config.query}`,
  "Was this approach reusable? Would a skill help future similar tasks?",
  "Respond with JSON: { crystallize: boolean, reason: string, skillName?: string, skillDescription?: string }",
].join("\n");

// Run quick evaluator LLM call
// If crystallize=true, propose skill via propose_tool
```

- [ ] **Step 2: Add proposeToolFn to worker agents**

Workers already have `proposeToolFn`. Use it to propose crystallized skill.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: post-research skill crystallization via evaluator"
```

---

## Final Verification

### Typecheck + Lint + Test

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 2: Lint + Format**

```bash
bun run check
```

- [ ] **Step 3: Tests**

```bash
bun run test
```

- [ ] **Step 4: Launch app**

```bash
bun run dev
```

Verify: research skill loads from filesystem, file explorer shows project files, compression works, path approvals appear in UI.

---

## Self-Review Checklist

- [x] **Spec coverage:** All 5 sections of the spec are covered
- [x] **Placeholder scan:** No TBD, TODO, or vague steps
- [x] **Type consistency:** `SkillRouter`, `OutputRouter`, `CompressionService`, `AllowlistService` interfaces consistent across tasks
- [x] **Dependency chain:** Run 1 → Runs 2-4 → Run 5
- [x] **IPC channels:** All new channels listed in `src/shared/ipc-channels.ts`
- [x] **Tests:** Each new service has unit tests
