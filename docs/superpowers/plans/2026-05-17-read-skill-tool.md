# Read Skill Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `read_skill` tool and make the system prompt list only skill names and descriptions.

**Architecture:** `SkillRouter` continues to discover skills and provide the prompt index, but no longer emits filesystem paths. A new focused `read-skill-tool.ts` resolves project skills before global skills, strips `SKILL.md` frontmatter, and returns recursive extra-file metadata. `createAgentTools` registers the tool so each session carries its project context implicitly.

**Tech Stack:** TypeScript, Electron main process, `@mariozechner/pi-agent-core` tools, TypeBox schemas, Vitest, Bun.

---

### Task 1: Prompt Skill Index Without Paths

**Files:**
- Modify: `src/main/agent/SkillRouter.ts`
- Modify: `src/main/agent/context.ts`
- Modify: `src/main/agent/prompts.ts`
- Test: `src/main/agent/SkillRouter.test.ts`
- Test: `src/main/agent/context.test.ts`

- [ ] **Step 1: Update `SkillRouter.toXml()` tests first**

In `src/main/agent/SkillRouter.test.ts`, extend the existing `toXml` valid XML test with:

```ts
expect(xml).toContain("To use a skill, call the read_skill tool with the skill name.");
expect(xml).not.toContain("path=");
expect(xml).not.toContain(join(trickyDir, "SKILL.md"));
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
bun test src/main/agent/SkillRouter.test.ts --runInBand
```

Expected: the updated assertion fails because XML still includes `path=`.

- [ ] **Step 3: Remove path emission from `SkillRouter.toXml()`**

Change `src/main/agent/SkillRouter.ts` so the XML intro says:

```ts
"  To use a skill, call the read_skill tool with the skill name.",
```

and each skill line is:

```ts
`  <skill name="${escapeXml(skill.name)}" description="${escapeXml(skill.description)}" />`,
```

- [ ] **Step 4: Update prompt guidance text**

In `src/main/agent/context.ts`, replace the available-skills comment with:

```ts
"<!-- Available Skills — When a task matches a description, use read_skill with the skill name before applying it -->",
```

In `src/main/agent/prompts.ts`, replace the skills instruction with:

```ts
When a task matches a skill description, use read_skill with the skill name before applying it.
```

- [ ] **Step 5: Update context tests**

In `src/main/agent/context.test.ts`, update the skills XML test to assert:

```ts
expect(result).toContain("<available_skills>");
expect(result).toContain('name="my-skill"');
expect(result).toContain('description="Does something."');
expect(result).not.toContain("path=");
```

- [ ] **Step 6: Run focused prompt tests**

Run:

```bash
bun test src/main/agent/SkillRouter.test.ts src/main/agent/context.test.ts --runInBand
```

Expected: all tests pass.

### Task 2: Add `read_skill` Tool

**Files:**
- Create: `src/main/agent/tools/read-skill-tool.ts`
- Test: `src/main/agent/tools/__tests__/read-skill-tool.test.ts`

- [ ] **Step 1: Write tests for the tool contract**

Create `src/main/agent/tools/__tests__/read-skill-tool.test.ts` with tests that:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadSkillTool } from "../read-skill-tool";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = join(tmpdir(), `read-skill-test-${Date.now()}`);
  await mkdir(tmpHome, { recursive: true });
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

async function writeSkill(scopePath: string, dirName: string, content: string): Promise<string> {
  const skillDir = join(scopePath, dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
  return skillDir;
}

describe("read_skill tool", () => {
  it("returns SKILL.md body without frontmatter", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "summarize",
      "---\nname: summarize\ndescription: Summarize documents\n---\n# Summarize\nDo it.",
    );
    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "summarize" });
    expect(result.details.scope).toBe("global");
    expect(result.details.body).toBe("# Summarize\nDo it.");
    expect(result.details.body).not.toContain("description:");
  });

  it("prefers project skill over global skill", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "shared",
      "---\nname: shared\ndescription: Global\n---\n# Global",
    );
    await writeSkill(
      join(tmpHome, "projects", "proj", "skills"),
      "shared",
      "---\nname: shared\ndescription: Project\n---\n# Project",
    );
    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "shared" });
    expect(result.details.scope).toBe("project");
    expect(result.details.body).toBe("# Project");
  });

  it("falls back to directory name when frontmatter name is missing or different", async () => {
    await writeSkill(
      join(tmpHome, "skills"),
      "directory-name",
      "---\nname: frontmatter-name\ndescription: Different\n---\n# Body",
    );
    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "directory-name" });
    expect(result.details.name).toBe("directory-name");
    expect(result.details.body).toBe("# Body");
  });

  it("lists nested non-dot files except SKILL.md", async () => {
    const skillDir = await writeSkill(
      join(tmpHome, "skills"),
      "with-files",
      "---\nname: with-files\ndescription: Has files\n---\n# Body",
    );
    await mkdir(join(skillDir, "references"), { recursive: true });
    await writeFile(join(skillDir, "references", "guide.md"), "# Guide", "utf-8");
    await writeFile(join(skillDir, "script.sh"), "echo ok", "utf-8");
    await writeFile(join(skillDir, ".secret"), "hidden", "utf-8");
    const tool = createReadSkillTool("proj", tmpHome);
    const result = await tool.execute("call-1", { skillName: "with-files" });
    expect(result.details.files).toEqual([
      { name: "references/guide.md", path: join(skillDir, "references", "guide.md") },
      { name: "script.sh", path: join(skillDir, "script.sh") },
    ]);
  });

  it("rejects invalid skill names", async () => {
    const tool = createReadSkillTool("proj", tmpHome);
    await expect(tool.execute("call-1", { skillName: "../bad" })).rejects.toThrow(
      "Invalid skillName",
    );
  });

  it("throws clearly when skill is missing", async () => {
    const tool = createReadSkillTool("proj", tmpHome);
    await expect(tool.execute("call-1", { skillName: "missing" })).rejects.toThrow(
      'Skill "missing" not found',
    );
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
bun test src/main/agent/tools/__tests__/read-skill-tool.test.ts --runInBand
```

Expected: fails because `read-skill-tool.ts` does not exist.

- [ ] **Step 3: Implement the tool**

Create `src/main/agent/tools/read-skill-tool.ts` with:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { parseFrontmatter } from "../../utils/frontmatter";

export interface SkillFileInfo {
  name: string;
  path: string;
}

export interface ReadSkillResult {
  name: string;
  scope: "project" | "global";
  body: string;
  files: SkillFileInfo[];
}

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;

const readSkillParameters = Type.Object({
  skillName: Type.String({
    description: "Name of the skill to read. Project skills override global skills.",
  }),
});

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]+?\r?\n---\r?\n?/, "").trim();
}

async function readEntries(dir: string): Promise<Awaited<ReturnType<typeof readdir>>> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findSkillDir(
  skillsDir: string,
  skillName: string,
): Promise<{ dir: string; skillMdPath: string } | null> {
  const entries = await readEntries(skillsDir);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (entry.name === skillName) {
      try {
        await readFile(skillMdPath, "utf-8");
        return { dir: skillDir, skillMdPath };
      } catch {
        continue;
      }
    }

    try {
      const content = await readFile(skillMdPath, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name === skillName) {
        return { dir: skillDir, skillMdPath };
      }
    } catch {
      // Ignore unreadable entries.
    }
  }
  return null;
}

async function listSkillFiles(skillDir: string): Promise<SkillFileInfo[]> {
  const files: SkillFileInfo[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readEntries(dir);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name !== "SKILL.md") {
        files.push({ name: relative(skillDir, path), path });
      }
    }
  }

  await walk(skillDir);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function createReadSkillTool(
  projectSlug: string,
  homePath: string,
): AgentTool<typeof readSkillParameters, ReadSkillResult> {
  return {
    name: "read_skill",
    label: "Read skill",
    description:
      "Read a skill by name. Project-scoped skills take precedence over global skills. " +
      "Returns the main SKILL.md body without frontmatter and lists other files in the skill directory.",
    parameters: readSkillParameters,
    execute: async (_id, { skillName }): Promise<AgentToolResult<ReadSkillResult>> => {
      if (!skillNamePattern.test(skillName)) {
        throw new Error(
          `Invalid skillName "${skillName}": only lowercase letters, digits, and hyphens allowed`,
        );
      }

      const candidates = [
        { scope: "project" as const, dir: join(homePath, "projects", projectSlug, "skills") },
        { scope: "global" as const, dir: join(homePath, "skills") },
      ];

      for (const candidate of candidates) {
        const match = await findSkillDir(candidate.dir, skillName);
        if (!match) continue;

        const content = await readFile(match.skillMdPath, "utf-8");
        const details: ReadSkillResult = {
          name: skillName,
          scope: candidate.scope,
          body: stripFrontmatter(content),
          files: await listSkillFiles(match.dir),
        };
        const fileList =
          details.files.length === 0
            ? "No additional files."
            : details.files.map((file) => `- ${file.name}: ${file.path}`).join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Skill: ${skillName}`,
                `Scope: ${candidate.scope}`,
                "",
                details.body,
                "",
                "Additional files:",
                fileList,
              ].join("\n"),
            },
          ],
          details,
        };
      }

      throw new Error(`Skill "${skillName}" not found`);
    },
  };
}
```

- [ ] **Step 4: Run focused tool tests**

Run:

```bash
bun test src/main/agent/tools/__tests__/read-skill-tool.test.ts --runInBand
```

Expected: all tests pass.

### Task 3: Register `read_skill`

**Files:**
- Modify: `src/main/agent/tools.ts`
- Test: `src/main/agent/tools.test.ts`

- [ ] **Step 1: Add registration tests**

In `src/main/agent/tools.test.ts`, add:

```ts
describe("createAgentTools – read_skill", () => {
  it("includes read_skill by default", () => {
    const tools = createAgentTools(BASE);
    expect(tools.map((t) => t.name)).toContain("read_skill");
  });

  it("includes read_skill when requested by toolNames", () => {
    const tools = createAgentTools({ ...BASE, toolNames: ["read_skill"] });
    expect(tools.map((t) => t.name)).toEqual(["read_skill"]);
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
bun test src/main/agent/tools.test.ts --runInBand
```

Expected: `read_skill` tests fail because the tool is not registered.

- [ ] **Step 3: Register the tool**

In `src/main/agent/tools.ts`:

Add import:

```ts
import { createReadSkillTool } from "./tools/read-skill-tool";
```

Add `"read_skill"` to `AgentToolName`.

Add `"read_skill"` to the default `capabilitiesToToolNames()` list.

Add the tool to the initial `tools` array:

```ts
createReadSkillTool(slug, homePath),
```

- [ ] **Step 4: Run focused registration tests**

Run:

```bash
bun test src/main/agent/tools.test.ts --runInBand
```

Expected: all tests pass.

### Task 4: Full Verification

**Files:**
- Verify all modified code and tests.

- [ ] **Step 1: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 2: Run Biome check**

Run:

```bash
bun run check
```

Expected: zero lint or formatting issues. If Biome writes formatting changes, inspect them and rerun the command.

- [ ] **Step 3: Run test suite**

Run:

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 4: Run coverage**

Run:

```bash
bun run test:coverage
```

Expected: all tests pass and coverage thresholds remain at or above 90%.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff -- src/main/agent src/main/agent/tools docs/superpowers/plans/2026-05-17-read-skill-tool.md
```

Expected: diff only includes the prompt index change, `read_skill` tool, registration, and tests.
