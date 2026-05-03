# Smart File Read + Sandbox File Mounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `read_file` with a line-aware, mime-typed, auto-truncating version that returns `fileHash`. Extend `run_in_docker` to accept `workspaceFiles` for copying into the container.

**Architecture:** `read_file` reads the full file as Buffer, computes SHA-256, detects mime by extension, splits into lines, paginates by line with a 500KB byte cap, and returns structured metadata. `run_in_docker` accepts workspace file paths, validates them via PathJail, copies them into the container temp dir before execution.

**Tech Stack:** TypeScript strict, Vitest, `@sinclair/typebox`, `node:fs/promises`, `node:crypto`, `node:path`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/main/agent/tools/file-tools.ts` | Smart `read_file` with line pagination, mime detection, fileHash, binary handling. `write_file` and `list_dir` unchanged. |
| `src/main/agent/tools/file-tools.test.ts` | Tests for `read_file`: small file, big file, CSV, binary, pagination, byte cap, hint generation |
| `src/main/agent/tools/docker-tool.ts` | Add `workspaceFiles` parameter to `run_in_docker` tool |
| `src/main/agent/extensions/docker-sandbox.ts` | Accept `workspaceFiles`, validate paths via PathJail, copy files into temp dir |
| `src/main/agent/extensions/docker-sandbox.test.ts` | Update tests: workspaceFiles path validation, copying, error handling |
| `src/main/agent/tools.ts` | Update `createAgentTools` to pass PathJail to `createDockerTool` for validation |

---

## Task 1: Smart `read_file` — Core Logic

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts` (replace `createReadFileTool`)
- Create: `src/main/agent/tools/file-tools.test.ts`

- [ ] **Step 1: Write failing test for small file read**

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PathJail } from "../path-jail";
import { createReadFileTool } from "./file-tools";

describe("createReadFileTool", () => {
  const jail = new PathJail("p1", null);
  const tool = createReadFileTool(jail);

  it("reads a small text file fully with correct metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "filetools-"));
    const filePath = join(dir, "test.txt");
    await writeFile(filePath, "hello\nworld", "utf-8");

    const result = await tool.execute("call-1", { path: filePath });
    const details = result.details as Record<string, unknown>;

    expect(details.content).toBe("hello\nworld");
    expect(details.mimeType).toBe("text/plain");
    expect(details.truncated).toBe(false);
    expect(details.hint).toBeNull();
    expect(details.totalLines).toBe(2);
    expect(details.lineCount).toBe(2);

    const expectedHash = createHash("sha256").update("hello\nworld").digest("hex");
    expect(details.fileHash).toBe(expectedHash);

    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `bun test src/main/agent/tools/file-tools.test.ts`
Expected: FAIL — `createReadFileTool` still has old signature (no `details` return)

- [ ] **Step 3: Implement smart `read_file` in `file-tools.ts`**

Replace `createReadFileTool` with:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MAX_OUTPUT_BYTES = 500 * 1024;
const MAX_DEFAULT_LINES = 500;

const MIME_MAP: Record<string, string> = {
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".py": "text/x-python",
  ".sh": "text/x-sh",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".sql": "text/x-sql",
  ".txt": "text/plain",
};

const BINARY_MIME_PATTERNS = ["image/", "video/", "audio/", "application/pdf", "application/octet-stream"];

function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function isBinaryMime(mime: string): boolean {
  return BINARY_MIME_PATTERNS.some((p) => mime.startsWith(p));
}

interface ReadFileResult {
  content: string;
  mimeType: string;
  truncated: boolean;
  hint: string | null;
  totalLines: number;
  lineCount: number;
  fileHash: string;
}

function buildHint(result: ReadFileResult, startLine: number): string | null {
  if (!result.truncated && result.totalLines === result.lineCount) return null;
  if (isBinaryMime(result.mimeType)) return `Binary file (${result.mimeType}). Cannot read as text.`;
  const endLine = Math.min(startLine + result.lineCount - 1, result.totalLines);
  const base = `Returned lines ${startLine}-${endLine} of ${result.totalLines}.`;
  const nextHint = startLine + result.lineCount <= result.totalLines
    ? ` Use startLine=${startLine + result.lineCount} to read more.`
    : "";
  return base + nextHint;
}

export function createReadFileTool(jail: PathJail): AgentTool<typeof readFileParameters, ReadFileResult> {
  return makeTool({
    name: "read_file",
    label: "Read file",
    description:
      "Read the contents of a file with optional line pagination. Returns structured metadata (mimeType, totalLines, truncated, hint, fileHash). For text files, use startLine/maxLines to paginate. For binary files, content will be a placeholder — use run_in_docker for processing. Use fileHash when writing back to detect concurrent changes.",
    parameters: readFileParameters,
    execute: async (_id, { path, startLine = 1, maxLines = MAX_DEFAULT_LINES }): Promise<AgentToolResult<ReadFileResult>> => {
      const resolved = jail.validate(path, "read");
      const buffer = await readFile(resolved);
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      const mimeType = detectMimeType(resolved);

      if (isBinaryMime(mimeType)) {
        const result: ReadFileResult = {
          content: "[Binary file — not readable as text]",
          mimeType,
          truncated: true,
          hint: `Binary file (${mimeType}). Cannot read as text.`,
          totalLines: 0,
          lineCount: 0,
          fileHash,
        };
        return {
          content: [{ type: "text" as const, text: result.content }],
          details: result,
        };
      }

      const text = buffer.toString("utf-8");
      const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
      const totalLines = lines.length;
      const clampedStart = Math.max(1, startLine);
      const startIndex = clampedStart - 1;
      const endIndex = Math.min(startIndex + maxLines, totalLines);
      const selectedLines = lines.slice(startIndex, endIndex);
      let content = selectedLines.join("\n");

      const truncatedByLines = endIndex < totalLines;
      let truncated = truncatedByLines;

      // Byte cap
      if (Buffer.byteLength(content) > MAX_OUTPUT_BYTES) {
        const buf = Buffer.from(content, "utf-8");
        content = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8");
        truncated = true;
      }

      const lineCount = selectedLines.length;
      const result: ReadFileResult = {
        content,
        mimeType,
        truncated,
        hint: null,
        totalLines,
        lineCount,
        fileHash,
      };
      result.hint = buildHint(result, clampedStart);

      return {
        content: [{ type: "text" as const, text: content }],
        details: result,
      };
    },
  });
}

const readFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  startLine: Type.Optional(Type.Integer({ default: 1, description: "1-based line number to start from" })),
  maxLines: Type.Optional(Type.Integer({ default: 500, description: "Max lines to return" })),
});
```

- [ ] **Step 4: Run test, expect pass**

Run: `bun test src/main/agent/tools/file-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/file-tools.ts src/main/agent/tools/file-tools.test.ts
git commit -m "feat: smart read_file with line pagination, mime detection, fileHash"
```

---

## Task 2: `read_file` Edge Case Tests

**Files:**
- Modify: `src/main/agent/tools/file-tools.test.ts`

- [ ] **Step 1: Add tests for truncation, binary, pagination, byte cap**

```ts
it("truncates big text file and sets truncated + hint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "big.txt");
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
  await writeFile(filePath, lines.join("\n"), "utf-8");

  const result = await tool.execute("call-1", { path: filePath });
  const details = result.details as Record<string, unknown>;

  expect(details.truncated).toBe(true);
  expect(details.totalLines).toBe(1000);
  expect(details.lineCount).toBe(500);
  expect(details.hint).toContain("Returned lines 1-500 of 1000");
  expect(details.hint).toContain("startLine=501");

  await rm(dir, { recursive: true, force: true });
});

it("reads binary file as placeholder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "data.png");
  await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), "utf-8");

  const result = await tool.execute("call-1", { path: filePath });
  const details = result.details as Record<string, unknown>;

  expect(details.content).toBe("[Binary file — not readable as text]");
  expect(details.mimeType).toBe("application/octet-stream");
  expect(details.hint).toContain("Binary file");
  expect(details.fileHash).toBeDefined();

  await rm(dir, { recursive: true, force: true });
});

it("paginates with startLine=501", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "big.txt");
  const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
  await writeFile(filePath, lines.join("\n"), "utf-8");

  const result = await tool.execute("call-1", { path: filePath, startLine: 501 });
  const details = result.details as Record<string, unknown>;

  expect(details.content).toBe(lines.slice(500, 1000).join("\n"));
  expect(details.totalLines).toBe(1000);
  expect(details.lineCount).toBe(500);
  expect(details.truncated).toBe(false);
  expect(details.hint).toBeNull();

  await rm(dir, { recursive: true, force: true });
});

it("applies byte cap when lines are huge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "huge.txt");
  const lines = Array.from({ length: 10 }, () => "x".repeat(100_000));
  await writeFile(filePath, lines.join("\n"), "utf-8");

  const result = await tool.execute("call-1", { path: filePath });
  const details = result.details as Record<string, unknown>;

  expect(details.truncated).toBe(true);
  expect(Buffer.byteLength(details.content as string)).toBeLessThanOrEqual(500 * 1024);

  await rm(dir, { recursive: true, force: true });
});

it("clamps startLine < 1 to 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "test.txt");
  await writeFile(filePath, "a\nb\nc", "utf-8");

  const result = await tool.execute("call-1", { path: filePath, startLine: -5 });
  const details = result.details as Record<string, unknown>;

  expect(details.content).toBe("a\nb\nc");

  await rm(dir, { recursive: true, force: true });
});

it("returns empty content when startLine > totalLines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filetools-"));
  const filePath = join(dir, "test.txt");
  await writeFile(filePath, "a\nb", "utf-8");

  const result = await tool.execute("call-1", { path: filePath, startLine: 200 });
  const details = result.details as Record<string, unknown>;

  expect(details.content).toBe("");
  expect(details.lineCount).toBe(0);
  expect(details.hint).toContain("startLine exceeds total");

  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run all file-tools tests**

Run: `bun test src/main/agent/tools/file-tools.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/file-tools.test.ts
git commit -m "test: read_file edge cases — truncation, binary, pagination, byte cap"
```

---

## Task 3: `run_in_docker` Workspace File Copying

**Files:**
- Modify: `src/main/agent/extensions/docker-sandbox.ts`
- Modify: `src/main/agent/tools/docker-tool.ts`
- Modify: `src/main/agent/tools.ts`
- Modify: `src/main/agent/extensions/docker-sandbox.test.ts`

- [ ] **Step 1: Add `workspaceFiles` parameter to docker types**

In `src/main/agent/extensions/docker-sandbox.ts`, update interface:

```ts
export interface DockerSandboxInput {
  code: string;
  language: "python" | "bash" | "typescript";
  files?: Array<{ name: string; content: string }>;
  workspaceFiles?: Array<{ name: string; sourcePath: string }>;
  networkEnabled?: boolean;
}
```

- [ ] **Step 2: Add workspace file copying to `runInDocker`**

After the inline `files` are written, add workspace file copying:

```ts
for (const wf of input.workspaceFiles ?? []) {
  await copyFile(wf.sourcePath, join(tmpDir, wf.name));
}
```

Import `copyFile` from `node:fs/promises` at top of file.

- [ ] **Step 3: Add `workspaceFiles` parameter to `docker-tool.ts`**

```ts
workspaceFiles: Type.Optional(
  Type.Array(Type.String(), {
    description: "Absolute paths to files in the workspace to copy into the container before execution. Files will be available at /workspace/<filename>.",
  })
),
```

Update execute to accept `workspaceFiles` and pass validated paths to `runInDocker`:

```ts
execute: async (_id, { code, language, files, networkEnabled, workspaceFiles }):
  const validatedWorkspaceFiles = workspaceFiles?.map((p) => {
    const resolved = jail.validate(p, "read");
    const name = basename(resolved);
    return { name, sourcePath: resolved };
  });
  const result = await runInDocker({ code, language, files, workspaceFiles: validatedWorkspaceFiles, networkEnabled });
```

- [ ] **Step 4: Pass PathJail to `createDockerTool`**

In `src/main/agent/tools.ts`, update `createDockerTool(jail)` call to pass the PathJail instance.

- [ ] **Step 5: Update `createDockerTool` signature**

```ts
export function createDockerTool(jail: PathJail): AgentTool<typeof dockerParameters, Awaited<ReturnType<typeof runInDocker>>> {
```

- [ ] **Step 6: Add docker-sandbox test for workspaceFiles**

In `src/main/agent/extensions/docker-sandbox.test.ts`, add:

```ts
it("copies workspaceFiles into temp dir before running", async () => {
  await runInDocker({
    code: 'print("hi")',
    language: "python",
    workspaceFiles: [{ name: "data.csv", sourcePath: join(workDir, "data.csv") }],
  });
  expect(mockCreateContainer).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run docker-sandbox tests**

Run: `bun test src/main/agent/extensions/docker-sandbox.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/agent/extensions/docker-sandbox.ts src/main/agent/tools/docker-tool.ts src/main/agent/tools.ts src/main/agent/extensions/docker-sandbox.test.ts
git commit -m "feat: run_in_docker workspaceFiles parameter with PathJail validation"
```

---

## Task 4: Integration Validation

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 3: Run lint**

Run: `bun run check`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: validate file-tools + sandbox changes pass all checks"
```

---

## Self-Review

**Spec coverage:**
- ✅ Line pagination (`startLine`, `maxLines`) — Task 1
- ✅ Mime detection — Task 1
- ✅ Binary file handling — Task 2
- ✅ `fileHash` on every read — Task 1
- ✅ Auto-truncation with hint — Task 1
- ✅ `run_in_docker` workspaceFiles — Task 3
- ✅ PathJail validation on workspace files — Task 3
- ✅ Byte safety cap (500KB) — Task 2
- ✅ Edge cases (startLine > total, startLine < 1) — Task 2

**Placeholder scan:** None found.

**Type consistency:** `ReadFileResult` interface matches spec exactly. `DockerSandboxInput` adds `workspaceFiles` array. All good.

**No `write_file` changes** — spec deferred optimistic locking. Only `read_file` returns `fileHash`.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-03-smart-file-read-sandbox-mount.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks
**2. Inline Execution** — execute tasks in this session using executing-plans

Which approach?
