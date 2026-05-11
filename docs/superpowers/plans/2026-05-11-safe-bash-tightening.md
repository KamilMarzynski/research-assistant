# Safe Bash Inline Code Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect inline code execution patterns in `safe_bash` and return a structured hint directing the agent to `run_in_docker` instead.

**Architecture:** A `detectInlineCode` function is inserted before `checkCommand` in `safe-bash.ts`. It scans for `-c`/`-e` flags on `python3`/`node`/`bun` and for bare invocations (interactive REPL). When detected, it returns a `SafeBashResult` with `exitCode: 1` and a hint payload. `docker-sandbox.ts` gains a `"javascript"` language variant using `node:20-alpine`. Tool descriptions are updated to steer the agent toward the right tool.

**Tech Stack:** TypeScript, Bun, Vitest, Dockerode, Biome

---

## File Map

| File | Role |
|---|---|
| `src/main/agent/extensions/safe-bash.ts` | Add `detectInlineCode`, wire into `runSafeBash` |
| `src/main/agent/extensions/safe-bash.test.ts` | Tests for `detectInlineCode` and hint return |
| `src/main/agent/extensions/docker-sandbox.ts` | Add `"javascript"` language variant |
| `src/main/agent/extensions/docker-sandbox.test.ts` | Tests for `"javascript"` language support |
| `src/main/agent/tools/docker-tool.ts` | Add `"javascript"` to union, update description |
| `src/main/agent/tools/safe-bash-tool.ts` | Update description to mention `run_in_docker` |

---

## Task 1: Add `detectInlineCode` to `safe-bash.ts`

**Files:**
- Modify: `src/main/agent/extensions/safe-bash.ts`
- Test: `src/main/agent/extensions/safe-bash.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the bottom of `safe-bash.test.ts`:

```typescript
describe("detectInlineCode", () => {
  it("detects python3 -c", () => {
    const result = detectInlineCode("python3 -c 'print(1)'");
    expect(result).toEqual({ detected: true, language: "python", reason: "python3 -c flag" });
  });

  it("detects node -e", () => {
    const result = detectInlineCode("node -e 'console.log(1)'");
    expect(result).toEqual({ detected: true, language: "javascript", reason: "node -e flag" });
  });

  it("detects bun -e", () => {
    const result = detectInlineCode("bun -e 'console.log(1)'");
    expect(result).toEqual({ detected: true, language: "typescript", reason: "bun -e flag" });
  });

  it("detects interactive python3", () => {
    const result = detectInlineCode("python3");
    expect(result).toEqual({ detected: true, language: "python", reason: "interactive REPL" });
  });

  it("does NOT detect python3 script.py", () => {
    const result = detectInlineCode("python3 script.py");
    expect(result).toBeNull();
  });

  it("does NOT detect node build.js", () => {
    const result = detectInlineCode("node build.js");
    expect(result).toBeNull();
  });

  it("does NOT detect bun run dev", () => {
    const result = detectInlineCode("bun run dev");
    expect(result).toBeNull();
  });

  it("does NOT detect python3 -m pytest", () => {
    const result = detectInlineCode("python3 -m pytest tests/");
    expect(result).toBeNull();
  });

  it("detects python3 heredoc (stripped to bare)", () => {
    const result = detectInlineCode("python3 <<EOF\nprint(1)\nEOF");
    expect(result?.detected).toBe(true);
    expect(result?.language).toBe("python");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/main/agent/extensions/safe-bash.test.ts
```

Expected: FAIL with "detectInlineCode is not defined"

- [ ] **Step 3: Export and implement `detectInlineCode`**

Add this function to `src/main/agent/extensions/safe-bash.ts`, just before `checkCommand`:

```typescript
export interface InlineCodeHint {
  detected: true;
  language: "python" | "javascript" | "typescript";
  reason: string;
}

export function detectInlineCode(command: string): InlineCodeHint | null {
  const cleaned = stripRedirects(command).trim();
  if (!cleaned) return null;

  const withoutVars = cleaned.replace(/^\s*\w+=\S+\s+/, "").trim();
  if (!withoutVars) return null;

  const tokens = withoutVars.split(/\s+/);
  const binary = tokens[0]?.split("/").pop();

  if (binary === "python3" || binary === "python") {
    const hasCodeFlag = tokens.includes("-c") || tokens.includes("--command");
    if (hasCodeFlag) {
      return { detected: true, language: "python", reason: `${binary} -c flag` };
    }
    // Interactive: no positional args after flags
    const hasScript = tokens.some((t, i) => i > 0 && !t.startsWith("-"));
    if (!hasScript) {
      return { detected: true, language: "python", reason: "interactive REPL" };
    }
  }

  if (binary === "node" || binary === "node.exe") {
    const hasCodeFlag =
      tokens.includes("-e") ||
      tokens.includes("--eval") ||
      tokens.includes("-p") ||
      tokens.includes("--print");
    if (hasCodeFlag) {
      return { detected: true, language: "javascript", reason: `${binary} -e flag` };
    }
    const hasScript = tokens.some((t, i) => i > 0 && !t.startsWith("-"));
    if (!hasScript) {
      return { detected: true, language: "javascript", reason: "interactive REPL" };
    }
  }

  if (binary === "bun") {
    const hasCodeFlag = tokens.includes("-e") || tokens.includes("--eval");
    if (hasCodeFlag) {
      return { detected: true, language: "typescript", reason: `${binary} -e flag` };
    }
    const hasScript = tokens.some((t, i) => i > 0 && !t.startsWith("-"));
    if (!hasScript) {
      return { detected: true, language: "typescript", reason: "interactive REPL" };
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/main/agent/extensions/safe-bash.test.ts
```

Expected: PASS

- [ ] **Step 5: Wire `detectInlineCode` into `runSafeBash`**

Modify the `runSafeBash` function. Find:

```typescript
export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const entry = checkCommand(opts.command);
```

Replace with:

```typescript
export async function runSafeBash(opts: SafeBashOptions): Promise<SafeBashResult> {
  const inline = detectInlineCode(opts.command);
  if (inline) {
    return {
      stdout: `This command runs code directly on your machine. For safety, use run_in_docker instead.

Example:
{
  "language": "${inline.language}",
  "code": "// your code here",
  "workspaceFiles": ["/path/to/file.csv"]
}

Output files written to /workspace/output/ are returned automatically.`,
      stderr: "",
      exitCode: 1,
      truncated: false,
    };
  }

  const entry = checkCommand(opts.command);
```

- [ ] **Step 6: Run tests**

```bash
bun test src/main/agent/extensions/safe-bash.test.ts
```

Expected: ALL PASS (existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/extensions/safe-bash.ts src/main/agent/extensions/safe-bash.test.ts
git commit -m "feat: detect inline code in safe_bash and hint run_in_docker"
```

---

## Task 2: Add `"javascript"` Language to Docker Sandbox

**Files:**
- Modify: `src/main/agent/extensions/docker-sandbox.ts`
- Test: `src/main/agent/extensions/docker-sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/main/agent/extensions/docker-sandbox.test.ts` and add:

```typescript
it("supports javascript language", async () => {
  const result = await runInDocker({
    code: "console.log('hello from js')",
    language: "javascript",
  });
  expect(result.stdout).toContain("hello from js");
  expect(result.error).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/main/agent/extensions/docker-sandbox.test.ts
```

Expected: FAIL with type error or "javascript" not assignable to `DockerSandboxInput["language"]`

- [ ] **Step 3: Add `"javascript"` variant**

In `src/main/agent/extensions/docker-sandbox.ts`, modify:

```typescript
const IMAGES: Record<DockerSandboxInput["language"], string> = {
  python: "python:3.11-slim",
  bash: "bash:5",
  typescript: "node:20-alpine",
  javascript: "node:20-alpine",
};

const ENTRY_FILES: Record<DockerSandboxInput["language"], string> = {
  python: "main.py",
  bash: "main.sh",
  typescript: "main.ts",
  javascript: "main.js",
};

const COMMANDS: Record<DockerSandboxInput["language"], string[]> = {
  python: ["sh", "-c", "python /workspace/main.py > /workspace/.stdout 2>&1"],
  bash: ["sh", "-c", "bash /workspace/main.sh > /workspace/.stdout 2>&1"],
  typescript: ["sh", "-c", "npx --yes tsx /workspace/main.ts > /workspace/.stdout 2>&1"],
  javascript: ["sh", "-c", "node /workspace/main.js > /workspace/.stdout 2>&1"],
};
```

- [ ] **Step 4: Run test**

```bash
bun test src/main/agent/extensions/docker-sandbox.test.ts
```

Expected: PASS (all tests including new one)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/extensions/docker-sandbox.ts src/main/agent/extensions/docker-sandbox.test.ts
git commit -m "feat: add javascript language to docker sandbox"
```

---

## Task 3: Update Docker Tool Parameters and Description

**Files:**
- Modify: `src/main/agent/tools/docker-tool.ts`
- Test: `src/main/agent/tools.test.ts` (if it references the language union)

- [ ] **Step 1: Update the language union**

In `src/main/agent/tools/docker-tool.ts`, change:

```typescript
const dockerParameters = Type.Object({
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
  // ... rest unchanged
```

- [ ] **Step 2: Update the tool description**

Change the `description` field in the `createDockerTool` return object to:

```typescript
description:
  "Execute code in an isolated Docker container. Use for running Python, JavaScript, TypeScript, or Bash code safely. " +
  "Pass input files via workspaceFiles (absolute paths validated by jail) or inline via files. " +
  "Write output files to /workspace/output/ to receive them back as outputFiles.",
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: zero errors

- [ ] **Step 4: Run related tests**

```bash
bun test src/main/agent/tools.test.ts
```

Expected: PASS (or skip if docker tests are integration tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/docker-tool.ts
git commit -m "feat: add javascript language to docker tool and clarify description"
```

---

## Task 4: Update Safe Bash Tool Description

**Files:**
- Modify: `src/main/agent/tools/safe-bash-tool.ts`

- [ ] **Step 1: Update description**

In `src/main/agent/tools/safe-bash-tool.ts`, change:

```typescript
description:
  "Execute a bash command in the project workspace. " +
  "Use for CLI operations, package managers, git, and running existing project scripts. " +
  "For executing Python, JavaScript, TypeScript, or Bash code, use run_in_docker instead. " +
  "Always state your intent. Dangerous commands are blocked automatically.",
```

- [ ] **Step 2: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/safe-bash-tool.ts
git commit -m "docs: clarify safe_bash scope and point to run_in_docker"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

Expected: zero errors

- [ ] **Step 2: Lint and format check**

```bash
bun run check
```

Expected: clean (no errors, no warnings)

- [ ] **Step 3: Run all tests**

```bash
bun test src/main/agent/extensions/safe-bash.test.ts src/main/agent/extensions/docker-sandbox.test.ts
```

Expected: ALL PASS

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git diff --cached --quiet || git commit -m "chore: final verification fixes"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task | Step |
|---|---|---|
| Detect `python3 -c` | Task 1 | Step 3 |
| Detect `node -e` | Task 1 | Step 3 |
| Detect `bun -e` | Task 1 | Step 3 |
| Detect interactive REPL (bare binary) | Task 1 | Step 3 |
| Detect heredoc (bare after stripRedirects) | Task 1 | Step 3 |
| Do NOT block `python3 script.py` | Task 1 | Step 3 |
| Do NOT block `node build.js` | Task 1 | Step 3 |
| Do NOT block `bun run dev` | Task 1 | Step 3 |
| Return structured hint with `run_in_docker` example | Task 1 | Step 5 |
| Add `"javascript"` to docker language enum | Task 2 | Step 3 |
| Update `safe_bash` description | Task 4 | Step 1 |
| Update `run_in_docker` description | Task 3 | Step 2 |

## Placeholder Scan

- No "TBD", "TODO", or vague steps found.
- All code blocks contain actual implementation code.
- All test blocks contain actual test code.
- Type names consistent: `InlineCodeHint`, `detectInlineCode`, `runSafeBash`.

## Type Consistency

- `detectInlineCode` returns `InlineCodeHint | null` (Task 1)
- `runSafeBash` calls `detectInlineCode` and returns early with `SafeBashResult` (Task 1)
- `DockerSandboxInput["language"]` gains `"javascript"` (Task 2)
- `dockerParameters` union gains `Type.Literal("javascript")` (Task 3)

All signatures align across tasks.
