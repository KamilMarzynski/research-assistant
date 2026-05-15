# Agent Tool Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden agent tool security: block script file execution in `safe_bash`, rename `run_in_docker` → `execute_code`, make skills directories read-only for agents, add project-scoped skill proposals, and introduce a trusted `run_skill_script` tool.

**Architecture:** Five independent or lightly-sequenced tasks. Tasks 1–3 are standalone and can run in parallel. Task 4 (project-scoped proposals) must complete before Task 5 (run_skill_script) since Task 5 relies on the trust boundary established by Tasks 3+4. The existing `propose_skill` → `pending-tools/` → approval → `skills/` pipeline is extended, not replaced.

**Tech Stack:** Bun, TypeScript strict, Electron IPC, Vitest, Biome v2, TSyringe DI, React 19, `@sinclair/typebox` for tool params, `zod/v4` for IPC validation.

---

## File Map

**Task 1 — Block file execution in safe_bash:**
- Modify: `src/main/agent/extensions/safe-bash.ts`
- Modify: `src/main/agent/extensions/safe-bash.test.ts`

**Task 2 — Rename run_in_docker → execute_code:**
- Modify: `src/main/agent/extensions/docker-sandbox.ts`
- Create: `src/main/agent/tools/execute-code-tool.ts`
- Delete: `src/main/agent/tools/docker-tool.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/extensions/docker-sandbox.test.ts`
- Modify: `src/main/agent/extensions/safe-bash.ts` (hint message update)

**Task 3 — Block writes to skills directories:**
- Modify: `src/main/agent/path-jail.ts`
- Modify: `src/main/agent/path-jail.test.ts`

**Task 4 — Project-scoped skill proposals:**
- Modify: `src/main/services/ToolApprovalService.ts`
- Modify: `src/main/services/HomeService.ts`
- Modify: `src/main/agent/tools/propose-skill.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/MessagePipeline.ts`
- Modify: `src/main/agent/session.ts`
- Modify: `src/main/ipc/chat-handlers.ts`
- Modify: `src/main/event-bus.ts`
- Modify: `src/main/ipc/event-forwarders.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/shared/ipc-guards.ts`
- Modify: `src/main/ipc-validation.ts`
- Modify: `src/main/ipc/admin-handlers.ts`
- Modify: `src/renderer/components/layout/chat/PendingToolBanner.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`
- Modify: `src/main/services/__tests__/HomeService.test.ts`

**Task 5 — run_skill_script tool:**
- Create: `src/main/agent/tools/run-skill-script-tool.ts`
- Create: `src/main/agent/tools/__tests__/run-skill-script.test.ts`
- Modify: `src/main/agent/tools.ts`

---

## Task 1: Block file execution in safe_bash

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts`
- Modify: `src/main/agent/extensions/safe-bash.test.ts`

**Context:** `safe_bash` currently blocks inline code (`python3 -c "..."`) via `detectInlineCode`, but allows `python3 script.py` which gives the agent access to host environment variables including API keys. We need a companion `detectFileExecution` function that catches when an interpreter binary is called with a positional file argument.

- [ ] **Step 1: Write failing tests for `detectFileExecution`**

Add a new `describe("detectFileExecution")` block at the end of `src/main/agent/extensions/safe-bash.test.ts`. Export `detectFileExecution` will not exist yet — tests should fail with import error.

```typescript
// Add at the top of the imports in safe-bash.test.ts:
import {
  BlockedCommandError,
  checkBlocklist,
  clearAllowlists,
  detectFileExecution,   // add this
  detectInlineCode,
  resolveBlockedCommand,
  runSafeBash,
} from "./safe-bash";
```

Add at the end of the test file:

```typescript
describe("detectFileExecution", () => {
  describe("detection cases — returns hint", () => {
    it("detects python3 script.py", () => {
      const result = detectFileExecution("python3 script.py");
      expect(result).not.toBeNull();
      expect(result?.interpreter).toBe("python3");
    });

    it("detects python3 with absolute path", () => {
      expect(detectFileExecution("python3 /home/user/analysis.py")).not.toBeNull();
    });

    it("detects python3 with relative path", () => {
      expect(detectFileExecution("python3 ./run.py")).not.toBeNull();
    });

    it("detects python script.py", () => {
      expect(detectFileExecution("python script.py")).not.toBeNull();
    });

    it("detects node server.js", () => {
      const result = detectFileExecution("node server.js");
      expect(result).not.toBeNull();
      expect(result?.interpreter).toBe("node");
    });

    it("detects node with absolute path", () => {
      expect(detectFileExecution("node /workspace/index.js")).not.toBeNull();
    });

    it("detects bun script.ts", () => {
      const result = detectFileExecution("bun script.ts");
      expect(result).not.toBeNull();
      expect(result?.interpreter).toBe("bun");
    });

    it("detects bun ./runner.ts", () => {
      expect(detectFileExecution("bun ./runner.ts")).not.toBeNull();
    });

    it("detects python3.11 script.py", () => {
      expect(detectFileExecution("python3.11 script.py")).not.toBeNull();
    });
  });

  describe("non-detection cases — returns null", () => {
    it("returns null for python3 -m pytest", () => {
      expect(detectFileExecution("python3 -m pytest")).toBeNull();
    });

    it("returns null for python3 -m pytest with extra args", () => {
      expect(detectFileExecution("python3 -m pytest tests/")).toBeNull();
    });

    it("returns null for python -m module", () => {
      expect(detectFileExecution("python -m http.server")).toBeNull();
    });

    it("returns null for bun install", () => {
      expect(detectFileExecution("bun install")).toBeNull();
    });

    it("returns null for bun run dev", () => {
      expect(detectFileExecution("bun run dev")).toBeNull();
    });

    it("returns null for bun test", () => {
      expect(detectFileExecution("bun test")).toBeNull();
    });

    it("returns null for bun build", () => {
      expect(detectFileExecution("bun build")).toBeNull();
    });

    it("returns null for bun add package", () => {
      expect(detectFileExecution("bun add typescript")).toBeNull();
    });

    it("returns null for node with only flags", () => {
      expect(detectFileExecution("node --version")).toBeNull();
    });

    it("returns null for node -v", () => {
      expect(detectFileExecution("node -v")).toBeNull();
    });

    it("returns null for bare python3 (no args)", () => {
      expect(detectFileExecution("python3")).toBeNull();
    });

    it("returns null for non-interpreter commands", () => {
      expect(detectFileExecution("ls -la")).toBeNull();
      expect(detectFileExecution("git status")).toBeNull();
      expect(detectFileExecution("grep -r foo .")).toBeNull();
    });
  });

  describe("integration: runSafeBash blocks file execution", () => {
    it("returns exitCode 1 and hint when running python3 file.py", async () => {
      const result = await runSafeBash({
        command: "python3 analysis.py",
        intent: "run analysis",
        projectId: "p1",
        workspacePath: "/tmp",
        auditLogPath: "/tmp/audit.log",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("execute_code");
    });

    it("returns exitCode 1 and hint when running node server.js", async () => {
      const result = await runSafeBash({
        command: "node server.js",
        intent: "start server",
        projectId: "p1",
        workspacePath: "/tmp",
        auditLogPath: "/tmp/audit.log",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("execute_code");
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts 2>&1 | tail -20
```

Expected: import error on `detectFileExecution`.

- [ ] **Step 3: Implement `detectFileExecution` in safe-bash.ts**

After the existing `INTERPRETER_META` constant, add:

```typescript
const SCRIPT_INTERPRETERS = new Set(["python3", "python", "node", "bun"]);

const BUN_SUBCOMMANDS = new Set([
  "install", "run", "add", "remove", "update", "link", "unlink",
  "test", "build", "init", "create", "x", "pm",
]);

export interface FileExecutionHint {
  detected: true;
  interpreter: string;
  reason: string;
}

export function detectFileExecution(command: string): FileExecutionHint | null {
  const stripped = stripRedirects(command).trim();
  if (!stripped) return null;

  const tokens = tokenize(stripped);
  if (tokens.length < 2) return null;

  const rawBinary = tokens[0].split("/").pop() ?? tokens[0];
  // Normalize python3.11, python3.12 → "python3"
  const binary = /^python3(\.\d+)?$/.test(rawBinary)
    ? "python3"
    : rawBinary;

  if (!SCRIPT_INTERPRETERS.has(binary)) return null;

  let i = 1;
  let hasModuleFlag = false;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith("-")) {
      if (token === "-m" || token === "--module") hasModuleFlag = true;
      // VALUE_FLAGS consume the next token as their value — skip both
      const flagKey = token.includes("=") ? token.split("=")[0] : token;
      if (VALUE_FLAGS.has(flagKey) && !token.includes("=")) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // First positional argument reached

    // python3 -m <module>: not file execution
    if (hasModuleFlag && (binary === "python3" || binary === "python")) {
      return null;
    }

    // bun subcommands (bun install, bun test, bun run, etc.): not file execution
    if (binary === "bun" && i === 1 && BUN_SUBCOMMANDS.has(token)) {
      return null;
    }

    // Positional arg to any other interpreter = file execution
    return {
      detected: true,
      interpreter: rawBinary,
      reason: `${rawBinary} file argument: "${token}"`,
    };
  }

  return null;
}
```

- [ ] **Step 4: Add `buildFileExecutionHint` and wire into `runSafeBash`**

After `buildInlineCodeHint`, add:

```typescript
function buildFileExecutionHint(interpreter: string): string {
  const normalizedBin = /^python3/.test(interpreter) ? "python3" : interpreter;
  const langMap: Record<string, string> = {
    python3: "python",
    python: "python",
    node: "javascript",
    bun: "typescript",
  };
  const language = langMap[normalizedBin] ?? "python";
  const example = { tool: "execute_code", language, code: "<paste file contents here>" };
  return [
    `Script file execution detected (${interpreter} <file>).`,
    "For security, running script files is not allowed in safe_bash.",
    "Use execute_code with the script contents instead.",
    "",
    "Example:",
    JSON.stringify(example, null, 2),
  ].join("\n");
}
```

In `runSafeBash`, add the file-execution check immediately after the inline-code check:

```typescript
export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const inlineHint = detectInlineCode(opts.command);
  if (inlineHint) {
    return { exitCode: 1, stderr: "", truncated: false, stdout: buildInlineCodeHint(inlineHint) };
  }

  const fileHint = detectFileExecution(opts.command);   // ← add this block
  if (fileHint) {
    return { exitCode: 1, stderr: "", truncated: false, stdout: buildFileExecutionHint(fileHint.interpreter) };
  }

  const entry = checkCommand(opts.command);
  // ... rest unchanged
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
bun run test src/main/agent/extensions/safe-bash.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat(safe-bash): block script file execution, redirect to execute_code"
```

---

## Task 2: Rename run_in_docker → execute_code

**Files:**
- Modify: `src/main/agent/extensions/docker-sandbox.ts`
- Create: `src/main/agent/tools/execute-code-tool.ts`
- Delete: `src/main/agent/tools/docker-tool.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/worker-agent.ts`
- Modify: `src/main/agent/extensions/docker-sandbox.test.ts`
- Modify: `src/main/agent/extensions/safe-bash.ts` (hint message update)

**Context:** The tool is named `run_in_docker` in the tool registry, `AgentToolName`, and all descriptions. It needs to be renamed to `execute_code` throughout. The Docker sandbox itself doesn't change — only the export name and tool wrapper change.

- [ ] **Step 1: Rename the export in docker-sandbox.ts**

In `src/main/agent/extensions/docker-sandbox.ts`, rename:
```typescript
// Before:
export async function runInDocker(input: DockerSandboxInput): Promise<DockerSandboxOutput> {

// After:
export async function runExecuteCode(input: DockerSandboxInput): Promise<DockerSandboxOutput> {
```

No other changes to this file.

- [ ] **Step 2: Update docker-sandbox.test.ts**

In `src/main/agent/extensions/docker-sandbox.test.ts`, line 24:
```typescript
// Before:
const { runInDocker } = await import("./docker-sandbox");
// After:
const { runExecuteCode } = await import("./docker-sandbox");

// Before (line 26):
describe("runInDocker", () => {
// After:
describe("runExecuteCode", () => {
```

Also update any call sites from `runInDocker(` to `runExecuteCode(` inside the test body.

- [ ] **Step 3: Create execute-code-tool.ts**

Create `src/main/agent/tools/execute-code-tool.ts` as a renamed version of `docker-tool.ts`:

```typescript
import { basename } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { runExecuteCode } from "../extensions/docker-sandbox";
import type { PathJail } from "../path-jail";

export function createExecuteCodeTool(
  jail: PathJail,
): AgentTool<typeof executeCodeParameters, Awaited<ReturnType<typeof runExecuteCode>>> {
  return {
    name: "execute_code",
    label: "Execute code in sandbox",
    description:
      "Execute code in an isolated Docker container with no access to host environment variables. " +
      "Use for running Python, JavaScript, TypeScript, or Bash code safely. " +
      "Pass input files via workspaceFiles (absolute paths validated by jail) or inline via files. " +
      "Write output files to /workspace/output/ to receive them back as outputFiles.",
    parameters: executeCodeParameters,
    execute: async (_id, { code, language, files, workspaceFiles, networkEnabled }) => {
      const resolvedWorkspaceFiles =
        workspaceFiles?.map((p) => {
          const validated = jail.validate(p, "read");
          return { name: basename(validated), sourcePath: validated };
        }) ?? [];
      const result = await runExecuteCode({
        code,
        language,
        files,
        workspaceFiles: resolvedWorkspaceFiles,
        networkEnabled,
      });
      const text = [
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.error ? `error: ${result.error}` : "",
        result.outputFiles.length > 0
          ? `output files: ${result.outputFiles.map((f) => f.name).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text" as const, text: text || "(no output)" }],
        details: result,
      };
    },
  };
}

const executeCodeParameters = Type.Object({
  code: Type.String({ description: "Code to execute" }),
  language: Type.Union(
    [
      Type.Literal("python"),
      Type.Literal("bash"),
      Type.Literal("typescript"),
      Type.Literal("javascript"),
    ],
    { description: "Programming language" },
  ),
  files: Type.Optional(
    Type.Array(Type.Object({ name: Type.String(), content: Type.String() }), {
      description: "Additional files to write into /workspace before execution",
    }),
  ),
  workspaceFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Absolute paths of workspace files to copy into /workspace before execution",
    }),
  ),
  networkEnabled: Type.Optional(
    Type.Boolean({ description: "Allow network access inside the container" }),
  ),
});
```

- [ ] **Step 4: Update tools.ts**

In `src/main/agent/tools.ts`:

```typescript
// Replace import:
// import { createDockerTool } from "./tools/docker-tool";
import { createExecuteCodeTool } from "./tools/execute-code-tool";

// Update AgentToolName union — replace "run_in_docker" with "execute_code":
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "safe_bash"
  | "fetch_url"
  | "web_search"
  | "request_evaluation"
  | "start_research"
  | "execute_code"            // ← was "run_in_docker"
  | "spawn_agent"
  | "spawn_agents_parallel"
  | "propose_skill"
  | "save_memory"
  | "read_memory";

// In capabilitiesToToolNames, update base set:
const names: AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "execute_code",             // ← was "run_in_docker"
];

// In buildTools, replace:
// tools.push(createDockerTool(jail));
tools.push(createExecuteCodeTool(jail));
```

- [ ] **Step 5: Update worker-agent.ts**

In `src/main/agent/worker-agent.ts`, update `ORCHESTRATOR_TOOL_NAMES`:

```typescript
export const ORCHESTRATOR_TOOL_NAMES: readonly AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "execute_code",             // ← was "run_in_docker"
  "spawn_agent",
  "spawn_agents_parallel",
] as const;
```

- [ ] **Step 6: Update buildInlineCodeHint in safe-bash.ts**

In `src/main/agent/extensions/safe-bash.ts`, find `buildInlineCodeHint` and change the `tool` field:

```typescript
function buildInlineCodeHint(hint: InlineCodeHint): string {
  const example = {
    tool: "execute_code",     // ← was "run_in_docker"
    language: hint.language,
    code: "<your code here>",
  };
  // ... rest unchanged
```

- [ ] **Step 7: Delete docker-tool.ts**

```bash
rm src/main/agent/tools/docker-tool.ts
```

- [ ] **Step 8: Run all tests**

```bash
bun run test 2>&1 | tail -20
```

Expected: all tests PASS (no references to `runInDocker` or `run_in_docker` remain).

- [ ] **Step 9: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/main/agent/extensions/docker-sandbox.ts \
        src/main/agent/extensions/docker-sandbox.test.ts \
        src/main/agent/tools/execute-code-tool.ts \
        src/main/agent/tools.ts \
        src/main/agent/worker-agent.ts \
        src/main/agent/extensions/safe-bash.ts
git rm src/main/agent/tools/docker-tool.ts
git commit -m "feat(tools): rename run_in_docker to execute_code"
```

---

## Task 3: Block writes to project skills directory

**Files:**
- Modify: `src/main/agent/path-jail.ts`
- Modify: `src/main/agent/path-jail.test.ts`

**Context:** `projectSkills` (`~/.scholar/projects/<slug>/skills/`) is currently in `readWriteZones` because it is under `projectsDir`. This means the agent can write skills files directly, bypassing the `propose_skill` → approval flow. We need an explicit write block with a clear error message. `homeSkills` (`~/.scholar/skills/`) already results in `ApprovalRequiredError` on write, but we should replace that with a clearer dedicated message.

- [ ] **Step 1: Update the failing test first**

In `src/main/agent/path-jail.test.ts`, find the two tests about skills writes and update their expectations:

```typescript
// Find and replace:
it("requires approval for write inside ~/.scholar/skills", () => {
  const p = join(HOME, "skills", "start_research", "SKILL.md");
  expect(() => jail.validate(p, "write")).toThrow(ApprovalRequiredError);
});
```
Change to:
```typescript
it("blocks write inside ~/.scholar/skills with clear message", () => {
  const p = join(HOME, "skills", "start_research", "SKILL.md");
  expect(() => jail.validate(p, "write")).toThrow("Cannot write to skills directory");
});
```

```typescript
// Find and replace:
it("allows write inside ~/.scholar/projects/<slug>/skills", () => {
  const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
  expect(() => jail.validate(p, "write")).not.toThrow();
});
```
Change to:
```typescript
it("blocks write inside ~/.scholar/projects/<slug>/skills", () => {
  const p = join(HOME, "projects", "test-project", "skills", "my-skill", "SKILL.md");
  expect(() => jail.validate(p, "write")).toThrow("Cannot write to skills directory");
});
```

- [ ] **Step 2: Run the updated tests — verify they fail**

```bash
bun run test src/main/agent/path-jail.test.ts 2>&1 | tail -20
```

Expected: the two modified tests FAIL.

- [ ] **Step 3: Add the write block to path-jail.ts**

In `src/main/agent/path-jail.ts`, in the `validate` method, add the skills block immediately after the existing `memoriesDir` block:

```typescript
validate(inputPath: string, mode: "read" | "write"): string {
  const resolved = resolve(normalize(inputPath));

  // Memories dir is always blocked
  if (this.isInZone(resolved, [this.memoriesDir])) {
    throw new Error(
      `Direct access to "${resolved}" is not permitted. Use the read_memory and save_memory tools to access memories.`,
    );
  }

  // Skills dirs are read-only — agents must use propose_skill to add new skills
  if (
    mode === "write" &&
    (this.isInZone(resolved, [this.projectSkills]) ||
      this.isInZone(resolved, [this.homeSkills]))
  ) {
    throw new Error(
      `Cannot write to skills directory "${resolved}". Use propose_skill to suggest new skills for user review.`,
    );
  }

  // ... rest of validate unchanged
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
bun run test src/main/agent/path-jail.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/path-jail.ts src/main/agent/path-jail.test.ts
git commit -m "feat(path-jail): block agent writes to skills directories"
```

---

## Task 4: Project-scoped skill proposals

**Files:** See file map above (16 files).

**Context:** Currently `propose_skill` always saves to the global `~/.scholar/pending-tools/`. After approval, skills land in `~/.scholar/skills/`. There is no concept of project-scoped skills being proposed through the approval gate. We add a `scope` parameter to `propose_skill` (default `"global"`), route project-scoped proposals to `~/.scholar/projects/<slug>/pending-tools/`, and add IPC channels + UI for project-scoped approval.

### 4a: Extend ToolApprovalService

- [ ] **Step 1: Write failing tests for project-scoped methods**

In `src/main/services/__tests__/HomeService.test.ts`, after the existing `ToolApprovalService` tests, add a new describe block:

```typescript
describe("ToolApprovalService — project-scoped", () => {
  const PROJECT_SLUG = "my-project";

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "home-test-"));
  });

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("saveProjectPendingTool writes SKILL.md under projects/<slug>/pending-tools", async () => {
    const toolApproval = makeToolApproval();
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "my-skill", "# my-skill");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "pending-tools", "my-skill", "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("# my-skill");
  });

  it("saveProjectPendingTool writes script.sh for bash script", async () => {
    const toolApproval = makeToolApproval();
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "run-bash", "# run-bash", "#!/bin/bash\necho hello");
    const { readFile } = await import("node:fs/promises");
    const script = await readFile(
      join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "pending-tools", "run-bash", "script.sh"),
      "utf-8",
    );
    expect(script).toContain("echo hello");
  });

  it("getProjectPendingTools returns empty when no tools", async () => {
    const toolApproval = makeToolApproval();
    expect(await toolApproval.getProjectPendingTools(PROJECT_SLUG)).toEqual([]);
  });

  it("getProjectPendingTools returns saved tools", async () => {
    const toolApproval = makeToolApproval();
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "tool-a", "# tool-a");
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "tool-b", "# tool-b");
    const tools = await toolApproval.getProjectPendingTools(PROJECT_SLUG);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("approveProjectPendingTool moves to projects/<slug>/skills", async () => {
    const toolApproval = makeToolApproval();
    await mkdir(join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "skills"), { recursive: true });
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "my-tool", "# my-tool");
    await toolApproval.approveProjectPendingTool(PROJECT_SLUG, "my-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "skills", "my-tool", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "pending-tools", "my-tool")),
    ).rejects.toThrow();
  });

  it("rejectProjectPendingTool deletes the dir", async () => {
    const toolApproval = makeToolApproval();
    await toolApproval.saveProjectPendingTool(PROJECT_SLUG, "bad-tool", "# bad-tool");
    await toolApproval.rejectProjectPendingTool(PROJECT_SLUG, "bad-tool");
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(tmpHome, ".scholar", "projects", PROJECT_SLUG, "pending-tools", "bad-tool")),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts 2>&1 | tail -20
```

Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement project-scoped methods in ToolApprovalService.ts**

Add to `src/main/services/ToolApprovalService.ts`:

```typescript
// After the existing skillsDir getter, add:
private projectPendingToolsDir(slug: string): string {
  return join(this.homePath, "projects", slug, "pending-tools");
}

private projectSkillsDir(slug: string): string {
  return join(this.homePath, "projects", slug, "skills");
}

async saveProjectPendingTool(slug: string, name: string, skillContent: string, script?: string): Promise<void> {
  const dir = join(this.projectPendingToolsDir(slug), name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillContent, "utf-8");
  if (script) {
    const ext = script.trimStart().startsWith("#!/bin/bash") ? ".sh" : ".py";
    await writeFile(join(dir, `script${ext}`), script, "utf-8");
  }
}

async getProjectPendingTools(slug: string): Promise<Array<{ name: string; skillContent: string }>> {
  const dir = this.projectPendingToolsDir(slug);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const tools: Array<{ name: string; skillContent: string }> = [];
  for (const name of entries) {
    try {
      const skillContent = await readFile(join(dir, name, "SKILL.md"), "utf-8");
      tools.push({ name, skillContent });
    } catch (err) {
      console.error(
        `[ToolApprovalService] getProjectPendingTools: skipping malformed entry ${name}:`,
        err,
      );
    }
  }
  return tools;
}

async approveProjectPendingTool(slug: string, name: string): Promise<void> {
  const src = join(this.projectPendingToolsDir(slug), name);
  const dst = join(this.projectSkillsDir(slug), name);
  await rename(src, dst);
}

async rejectProjectPendingTool(slug: string, name: string): Promise<void> {
  await rm(join(this.projectPendingToolsDir(slug), name), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test src/main/services/__tests__/HomeService.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

### 4b: Ensure project pending-tools dir is created

- [ ] **Step 5: Update HomeService.ensureWorkspaceForProject**

In `src/main/services/HomeService.ts`, update the method:

```typescript
async ensureWorkspaceForProject(slug: string): Promise<string> {
  const home = this.getHomePath();
  const workspaceDir = join(home, "projects", slug, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(home, "projects", slug, "pending-tools"), { recursive: true });
  return workspaceDir;
}
```

### 4c: Add scope parameter to propose_skill tool

- [ ] **Step 6: Update propose-skill.ts parameters and proposeFn signature**

In `src/main/agent/tools/propose-skill.ts`:

```typescript
// Update function signature:
export function createProposeSkillTool(
  proposeFn: (
    name: string,
    skillContent: string,
    script: string | undefined,
    scope: "global" | "project",
  ) => Promise<void>,
): AgentTool<typeof proposeSkillParameters, null> {
  return {
    name: "propose_skill",
    label: "Propose new skill",
    description:
      "Propose a new skill for the user to review and approve. " +
      "Use scope='global' for skills useful across all projects, or scope='project' for project-specific helpers. " +
      "The skill becomes available in future sessions once approved.",
    parameters: proposeSkillParameters,
    execute: async (
      _id,
      { name, description: _desc, skillContent, script, scope },
    ): Promise<AgentToolResult<null>> => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Invalid skill name "${name}": only lowercase letters, digits, and hyphens allowed`,
        );
      }
      await proposeFn(name, skillContent, script, scope ?? "global");
      return {
        content: [
          { type: "text" as const, text: `Skill "${name}" proposed (scope: ${scope ?? "global"}) and pending user approval.` },
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
});
```

### 4d: Propagate the new proposeSkillFn signature

The `proposeFn` type appears in 4 files. Update them all to:
```typescript
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
) => Promise<void>;
```

- [ ] **Step 7: Update tools.ts**

```typescript
// In ToolContext interface:
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
) => Promise<void>;
```

- [ ] **Step 8: Update worker-agent.ts**

```typescript
// In WorkerAgentConfig interface (line ~51):
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
) => Promise<void>;
```

- [ ] **Step 9: Update MessagePipeline.ts**

```typescript
// In the options interface (line ~42):
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
) => Promise<void>;
```

- [ ] **Step 10: Update session.ts**

```typescript
// In the options interface (line ~33):
proposeSkillFn?: (
  name: string,
  skillContent: string,
  script: string | undefined,
  scope: "global" | "project",
) => Promise<void>;
```

### 4e: Update event-bus.ts and event-forwarders.ts

- [ ] **Step 11: Update the tool:pending event payload in event-bus.ts**

```typescript
// Line 18 — update payload to include scope:
| {
    type: "tool:pending";
    payload: {
      name: string;
      skillContent: string;
      scope: "global" | "project";
      projectSlug?: string;
    };
  }
```

- [ ] **Step 12: Update event-forwarders.ts to forward scope and projectSlug**

```typescript
// Line 85-87:
eventBus.on("tool:pending", (payload) => {
  emitPush(win, {
    type: "TOOL_PENDING",
    name: payload.name,
    skillContent: payload.skillContent,
    scope: payload.scope,
    projectSlug: payload.projectSlug,
  });
});
```

### 4f: Update shared IPC types

- [ ] **Step 13: Update ipc-types.ts**

Update the `PendingTool` interface:

```typescript
export interface PendingTool {
  name: string;
  skillContent: string;
  scope: "global" | "project";
  projectSlug?: string;
}
```

Add to `IpcRequestMap`:
```typescript
GET_PROJECT_PENDING_TOOLS: { projectSlug: string };
APPROVE_PROJECT_TOOL: { projectSlug: string; name: string };
REJECT_PROJECT_TOOL: { projectSlug: string; name: string };
```

Add to `IpcResponseMap`:
```typescript
GET_PROJECT_PENDING_TOOLS: PendingTool[];
APPROVE_PROJECT_TOOL: undefined;
REJECT_PROJECT_TOOL: undefined;
```

- [ ] **Step 14: Update ipc-channels.ts**

Add three new channels to the `IPC` object:

```typescript
GET_PROJECT_PENDING_TOOLS: "GET_PROJECT_PENDING_TOOLS",
APPROVE_PROJECT_TOOL: "APPROVE_PROJECT_TOOL",
REJECT_PROJECT_TOOL: "REJECT_PROJECT_TOOL",
```

- [ ] **Step 15: Update ipc-guards.ts**

```typescript
const PendingToolSchema = z.object({
  name: z.string(),
  skillContent: z.string(),
  scope: z.enum(["global", "project"]),
  projectSlug: z.string().optional(),
});
```

### 4g: Add IPC validation schemas and handlers

- [ ] **Step 16: Add schemas to ipc-validation.ts**

```typescript
export const GetProjectPendingToolsSchema = z.object({
  projectSlug: z.string(),
});

export const ApproveRejectProjectToolSchema = z.object({
  projectSlug: z.string(),
  name: z.string(),
});
```

- [ ] **Step 17: Register new handlers in admin-handlers.ts**

Import the new schemas at the top:
```typescript
import {
  ApproveRejectToolSchema,
  ApproveRejectProjectToolSchema,
  DeleteSkillSchema,
  GetProjectPendingToolsSchema,
  ToggleSkillSchema,
} from "../ipc-validation";
```

Add three new handlers inside `registerAdminHandlers` (after `REJECT_TOOL` handler):

```typescript
ipcMain.handle(IPC.GET_PROJECT_PENDING_TOOLS, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { projectSlug } = parseOrThrow(GetProjectPendingToolsSchema, payload, "GET_PROJECT_PENDING_TOOLS");
    return toolApprovalService.getProjectPendingTools(projectSlug);
  }),
);

ipcMain.handle(IPC.APPROVE_PROJECT_TOOL, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { projectSlug, name } = parseOrThrow(
      ApproveRejectProjectToolSchema,
      payload,
      "APPROVE_PROJECT_TOOL",
    );
    await toolApprovalService.approveProjectPendingTool(projectSlug, name);
  }),
);

ipcMain.handle(IPC.REJECT_PROJECT_TOOL, (_event, payload: unknown) =>
  wrapIpc(async () => {
    const { projectSlug, name } = parseOrThrow(
      ApproveRejectProjectToolSchema,
      payload,
      "REJECT_PROJECT_TOOL",
    );
    await toolApprovalService.rejectProjectPendingTool(projectSlug, name);
  }),
);
```

### 4h: Update chat-handlers.ts proposeSkillFn

- [ ] **Step 18: Update the proposeSkillFn closure in chat-handlers.ts**

Find the `proposeSkillFn` closure (around line 129) and update it:

```typescript
proposeSkillFn: async (name, skillContent, script, scope) => {
  if (scope === "project") {
    const slug = project.slug ?? project.id;
    await toolApprovalService.saveProjectPendingTool(slug, name, skillContent, script);
    eventBus.emit({
      type: "tool:pending",
      payload: { name, skillContent, scope: "project", projectSlug: slug },
    });
  } else {
    await toolApprovalService.savePendingTool(name, skillContent, script);
    eventBus.emit({
      type: "tool:pending",
      payload: { name, skillContent, scope: "global" },
    });
  }
},
```

Note: `project` is available in the closure above this line (it comes from `projectService.getProject(projectId)`).

### 4i: Update the renderer

- [ ] **Step 19: Update PendingToolBanner.tsx**

Replace the entire file:

```tsx
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePendingTool } from "../../../../shared/ipc-guards";
import type { PendingTool } from "../../../../shared/ipc-types";
import { IconBolt } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { ipc } from "../../../lib/ipc-client";
import PendingToolModal from "./PendingToolModal";

interface Props {
  projectSlug?: string;
}

export default function PendingToolBanner({ projectSlug }: Props) {
  const { items, add, remove } = usePendingItems<PendingTool>({
    channel: IPC.TOOL_PENDING,
    decode: decodePendingTool,
    getKey: (t) => `${t.scope}:${t.projectSlug ?? "global"}:${t.name}`,
  });
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    // Load global pending tools
    void ipc.invoke(IPC.GET_PENDING_TOOLS).then((tools) => {
      for (const tool of tools) add({ ...tool, scope: "global" });
    });
    // Load project-scoped pending tools for the current project
    if (projectSlug) {
      void ipc.invoke(IPC.GET_PROJECT_PENDING_TOOLS, { projectSlug }).then((tools) => {
        for (const tool of tools) add(tool);
      });
    }
  }, [add, projectSlug]);

  const handleApprove = async (tool: PendingTool) => {
    try {
      if (tool.scope === "project" && tool.projectSlug) {
        await ipc.invoke(IPC.APPROVE_PROJECT_TOOL, {
          projectSlug: tool.projectSlug,
          name: tool.name,
        });
      } else {
        await ipc.invoke(IPC.APPROVE_TOOL, { name: tool.name });
      }
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    remove(tool);
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    if (tool.scope === "project" && tool.projectSlug) {
      await ipc.invoke(IPC.REJECT_PROJECT_TOOL, {
        projectSlug: tool.projectSlug,
        name: tool.name,
      });
    } else {
      await ipc.invoke(IPC.REJECT_TOOL, { name: tool.name });
    }
    remove(tool);
    setSelectedTool(null);
  };

  // Only show tools relevant to this view:
  // - global tools always shown
  // - project tools only shown if projectSlug matches
  const visibleItems = items.filter(
    (t) =>
      t.scope === "global" ||
      (t.scope === "project" && t.projectSlug === projectSlug),
  );

  if (visibleItems.length === 0) return null;

  return (
    <>
      {visibleItems.map((tool) => (
        <div
          key={`${tool.scope}:${tool.projectSlug ?? "global"}:${tool.name}`}
          data-testid={`pending-tool-banner-${tool.name}`}
          style={{
            borderRadius: "var(--r-md)",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
          }}
        >
          <IconBolt size={14} strokeColor="var(--accent)" />
          <span className="chip chip--accent">{tool.scope === "project" ? "project tool" : "tool"}</span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`review-tool-btn-${tool.name}`}
            onClick={() => setSelectedTool(tool)}
          >
            Review
          </button>
        </div>
      ))}
      {selectedTool && (
        <PendingToolModal
          tool={selectedTool}
          onApprove={() => handleApprove(selectedTool)}
          onReject={() => handleReject(selectedTool)}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 20: Update ChatPanel.tsx to pass projectSlug**

In `src/renderer/components/layout/chat/ChatPanel.tsx`, find the `<PendingToolBanner />` render and update it:

```tsx
// Add this derived value near the other derived state (after projects state):
const activeProject = projects.find((p) => p.id === activeProjectId);
const activeProjectSlug = activeProject?.slug ?? undefined;

// Update the render:
<PendingToolBanner projectSlug={activeProjectSlug} />
```

- [ ] **Step 21: Run all tests**

```bash
bun run test 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 22: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 23: Commit**

```bash
git add \
  src/main/services/ToolApprovalService.ts \
  src/main/services/HomeService.ts \
  src/main/agent/tools/propose-skill.ts \
  src/main/agent/tools.ts \
  src/main/agent/worker-agent.ts \
  src/main/agent/MessagePipeline.ts \
  src/main/agent/session.ts \
  src/main/ipc/chat-handlers.ts \
  src/main/event-bus.ts \
  src/main/ipc/event-forwarders.ts \
  src/shared/ipc-channels.ts \
  src/shared/ipc-types.ts \
  src/shared/ipc-guards.ts \
  src/main/ipc-validation.ts \
  src/main/ipc/admin-handlers.ts \
  src/renderer/components/layout/chat/PendingToolBanner.tsx \
  src/renderer/components/layout/chat/ChatPanel.tsx \
  src/main/services/__tests__/HomeService.test.ts
git commit -m "feat(skills): add project-scoped skill proposals and approval flow"
```

---

## Task 5: run_skill_script tool

**Files:**
- Create: `src/main/agent/tools/run-skill-script-tool.ts`
- Create: `src/main/agent/tools/__tests__/run-skill-script.test.ts`
- Modify: `src/main/agent/tools.ts`

**Context:** With skills directories protected (Task 3) and project-scoped skills available (Task 4), we can now trust that any file in a skills directory was placed there by a user-approved proposal. `run_skill_script` leverages that trust by running `script.sh` or `script.py` from an approved skill with full host environment access.

- [ ] **Step 1: Write failing tests**

Create `src/main/agent/tools/__tests__/run-skill-script.test.ts`:

```typescript
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunSkillScriptTool } from "../run-skill-script-tool";

let tmpHome: string;
let auditLog: string;

beforeEach(async () => {
  tmpHome = join(tmpdir(), `rss-test-${Date.now()}`);
  await mkdir(tmpHome, { recursive: true });
  auditLog = join(tmpHome, "audit.log");
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

async function makeGlobalSkillScript(skillName: string, content: string): Promise<void> {
  const dir = join(tmpHome, "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "script.sh"), content, "utf-8");
}

async function makeProjectSkillScript(
  slug: string,
  skillName: string,
  content: string,
): Promise<void> {
  const dir = join(tmpHome, "projects", slug, "skills", skillName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "script.sh"), content, "utf-8");
}

describe("run_skill_script tool", () => {
  it("runs a global skill script and returns stdout", async () => {
    await makeGlobalSkillScript("say-hello", "#!/bin/bash\necho 'hello from skill'");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-1", {
      skillName: "say-hello",
      scope: "global",
      intent: "test",
    });
    expect(result.content[0].text).toContain("hello from skill");
  });

  it("runs a project-scoped skill script", async () => {
    await makeProjectSkillScript("my-slug", "proj-skill", "#!/bin/bash\necho 'project skill'");
    const tool = createRunSkillScriptTool("my-slug", tmpHome, auditLog);
    const result = await tool.execute("call-2", {
      skillName: "proj-skill",
      scope: "project",
      intent: "test",
    });
    expect(result.content[0].text).toContain("project skill");
  });

  it("returns error message when script does not exist", async () => {
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-3", {
      skillName: "nonexistent",
      scope: "global",
      intent: "test",
    });
    expect(result.content[0].text).toContain("No script found");
    expect(result.details.exitCode).toBe(1);
  });

  it("reports non-zero exit code", async () => {
    await makeGlobalSkillScript("fail-skill", "#!/bin/bash\nexit 42");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-4", {
      skillName: "fail-skill",
      scope: "global",
      intent: "test",
    });
    expect(result.details.exitCode).toBe(42);
  });

  it("passes args to the script", async () => {
    await makeGlobalSkillScript("echo-args", "#!/bin/bash\necho \"arg: $1\"");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    const result = await tool.execute("call-5", {
      skillName: "echo-args",
      scope: "global",
      intent: "test",
      args: ["hello"],
    });
    expect(result.content[0].text).toContain("arg: hello");
  });

  it("writes an audit log entry", async () => {
    await makeGlobalSkillScript("audit-skill", "#!/bin/bash\necho done");
    const tool = createRunSkillScriptTool("test-project", tmpHome, auditLog);
    await tool.execute("call-6", { skillName: "audit-skill", scope: "global", intent: "audit test" });
    const { readFile } = await import("node:fs/promises");
    const log = await readFile(auditLog, "utf-8");
    const entry = JSON.parse(log.trim());
    expect(entry.type).toBe("skill_script");
    expect(entry.intent).toBe("audit test");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
bun run test src/main/agent/tools/__tests__/run-skill-script.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement run-skill-script-tool.ts**

Create `src/main/agent/tools/run-skill-script-tool.ts`:

```typescript
import { access, appendFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

interface RunSkillScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

const MAX_OUTPUT_CHARS = 65536;
const TIMEOUT_MS = 60_000;

async function runScript(
  scriptPath: string,
  args: string[],
  intent: string,
  projectId: string,
  auditLogPath: string,
): Promise<RunSkillScriptResult> {
  return new Promise((resolve) => {
    const interpreter = scriptPath.endsWith(".py") ? "python3" : "bash";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const proc = spawn(interpreter, [scriptPath, ...args], {
      env: process.env,
      signal: controller.signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) < MAX_OUTPUT_CHARS) stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_CHARS) stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr, error: err.message });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        projectId,
        type: "skill_script",
        script: basename(scriptPath),
        intent,
        exitCode: code ?? 1,
      });
      void appendFile(auditLogPath, `${entry}\n`, "utf-8").catch(() => {});
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

const runSkillScriptParameters = Type.Object({
  skillName: Type.String({
    description: "Name of the approved skill whose script to run (must exist in skills directory)",
  }),
  scope: Type.Union([Type.Literal("global"), Type.Literal("project")], {
    description:
      "Look in global skills directory ('global') or project-specific skills ('project')",
  }),
  intent: Type.String({ description: "What you are trying to accomplish with this script" }),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description: "Command-line arguments to pass to the script",
    }),
  ),
});

export function createRunSkillScriptTool(
  projectSlug: string,
  homePath: string,
  auditLogPath: string,
): AgentTool<typeof runSkillScriptParameters, RunSkillScriptResult> {
  return {
    name: "run_skill_script",
    label: "Run approved skill script",
    description:
      "Execute a shell script bundled with an approved skill. " +
      "Scripts run with host environment variables — only use for trusted, user-approved skills. " +
      "Scripts must be located in an approved skills directory; use propose_skill to add new ones.",
    parameters: runSkillScriptParameters,
    execute: async (
      _id,
      { skillName, scope, args, intent },
    ): Promise<AgentToolResult<RunSkillScriptResult>> => {
      const skillsDir =
        scope === "project"
          ? join(homePath, "projects", projectSlug, "skills")
          : join(homePath, "skills");

      const skillDir = join(skillsDir, skillName);
      let scriptPath: string | null = null;

      for (const ext of [".sh", ".py"]) {
        const candidate = join(skillDir, `script${ext}`);
        try {
          await access(candidate);
          scriptPath = candidate;
          break;
        } catch {
          // try next extension
        }
      }

      if (!scriptPath) {
        const notFound: RunSkillScriptResult = {
          exitCode: 1,
          stdout: "",
          stderr: "",
          error: "script not found",
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `No script found for skill "${skillName}" in ${scope} skills directory.`,
            },
          ],
          details: notFound,
        };
      }

      const result = await runScript(scriptPath, args ?? [], intent, projectSlug, auditLogPath);
      const summary = [
        `Exit code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.error ? `error: ${result.error}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        details: result,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
bun run test src/main/agent/tools/__tests__/run-skill-script.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Register the tool in tools.ts**

In `src/main/agent/tools.ts`:

```typescript
// Add import:
import { createRunSkillScriptTool } from "./tools/run-skill-script-tool";

// Add to AgentToolName union:
| "run_skill_script"

// Add to capabilitiesToToolNames base set:
const names: AgentToolName[] = [
  "read_file",
  "write_file",
  "list_dir",
  "safe_bash",
  "execute_code",
  "run_skill_script",   // ← add
];

// In buildTools, after createSafeBashTool:
tools.push(
  createRunSkillScriptTool(slug, homePath, auditLogPath),
);
```

- [ ] **Step 6: Run all tests**

```bash
bun run test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Typecheck and lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add \
  src/main/agent/tools/run-skill-script-tool.ts \
  src/main/agent/tools/__tests__/run-skill-script.test.ts \
  src/main/agent/tools.ts
git commit -m "feat(tools): add run_skill_script tool for trusted skill script execution"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Block `safe_bash` file execution (`python3 script.py`, etc.) | Task 1 |
| Rename `run_in_docker` → `execute_code` | Task 2 |
| Block agent writes to skills directories | Task 3 |
| Project-scoped pending skills | Task 4 |
| Trusted `run_skill_script` with host env access | Task 5 |
| Global skills already read-only (pre-existing) | Verified in Task 3 tests |
| `propose_skill` must be used for new skills | Tasks 3+4 together enforce this |

**Gaps checked:**
- `bun run build` (runs package.json script) is allowed by `detectFileExecution` — intentional, discussed with user
- `ORCHESTRATOR_TOOL_NAMES` in `worker-agent.ts` also has `run_in_docker` → covered in Task 2 Step 5
- `buildInlineCodeHint` references `run_in_docker` in hint text → covered in Task 2 Step 6
- `docker-sandbox.test.ts` imports `runInDocker` → covered in Task 2 Step 2
- `ipc-guards.ts` `PendingToolSchema` doesn't have `scope` → covered in Task 4 Step 15
- `usePendingItems` key must be unique across scope+project — covered by updating `getKey` in Task 4 Step 19

**Placeholder scan:** No TBDs, no "add validation", no "similar to Task N" references. All code complete.

**Type consistency:**
- `proposeSkillFn` signature updated in `tools.ts`, `worker-agent.ts`, `MessagePipeline.ts`, `session.ts`, `propose-skill.ts`, `chat-handlers.ts` — all four consumer sites
- `PendingTool` interface updated in `ipc-types.ts` and `ipc-guards.ts` consistently
- `AgentToolName` union updated in `tools.ts`; `ORCHESTRATOR_TOOL_NAMES` in `worker-agent.ts` updated to match
