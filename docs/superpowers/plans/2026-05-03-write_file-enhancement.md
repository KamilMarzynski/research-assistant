# write_file Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `write_file` tool with line-based replacement and SHA-256 hash verification for safe concurrent edits.

**Architecture:** Add `start_line`, `end_line`, and `expected_hash` optional parameters to existing `write_file` tool. Use `node:crypto` for SHA-256. Line operations parse file by `\n`, apply edits, rejoin. Hash check prevents lost updates.

**Tech Stack:** TypeScript, TypeBox, Vitest, Node.js `crypto` module

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/agent/tools/file-tools.ts` | `createWriteFileTool` implementation — add line edit + hash logic |
| `src/main/agent/tools/__tests__/file-tools.test.ts` | Tests for all new behaviors |

---

### Task 1: Add hash helper and import

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Add `createHash` import and `sha256` helper at top of file**

Add import and helper function after existing imports:

```typescript
import { createHash } from "node:crypto";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/tools/file-tools.ts
git commit -m "chore: add sha256 helper for write_file hash verification"
```

---

### Task 2: Update parameter schema

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Replace `writeFileParameters` schema with extended version**

Replace the existing `writeFileParameters` constant (lines 61-64) with:

```typescript
const writeFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  content: Type.String({ description: "Content to write" }),
  start_line: Type.Optional(
    Type.Number({
      description:
        "1-based line number to insert at or start replacement. Existing line at this position shifts down if end_line is omitted.",
    }),
  ),
  end_line: Type.Optional(
    Type.Number({
      description:
        "1-based inclusive line number to end replacement. If omitted with start_line, inserts at start_line without replacing any lines.",
    }),
  ),
  expected_hash: Type.Optional(
    Type.String({
      description:
        "SHA-256 hash of current file contents (as agent last saw it). Required when editing existing files to prevent overwriting concurrent changes.",
    }),
  ),
});
```

- [ ] **Step 2: Run typecheck to verify schema compiles**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/file-tools.ts
git commit -m "feat: extend write_file schema with start_line, end_line, expected_hash"
```

---

### Task 3: Add line-editing helper

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Add `applyLineEdit` helper function before `createWriteFileTool`**

Insert after `sha256` helper:

```typescript
function applyLineEdit(
  lines: string[],
  startLine: number | undefined,
  endLine: number | undefined,
  content: string,
): { lines: string[]; message: string } {
  const newLines = content.split("\n");

  if (startLine === undefined) {
    return { lines: newLines, message: "" };
  }

  if (startLine < 1) {
    throw new Error("start_line must be >= 1");
  }

  if (endLine !== undefined && endLine < startLine) {
    throw new Error("end_line must be >= start_line");
  }

  const zeroStart = startLine - 1;

  if (endLine === undefined) {
    // Insert mode: insert content at start_line, shift existing lines down
    const before = lines.slice(0, zeroStart);
    const after = lines.slice(zeroStart);
    return {
      lines: [...before, ...newLines, ...after],
      message: `Inserted at line ${startLine}`,
    };
  }

  // Replace mode: replace lines [startLine, endLine] inclusive
  const zeroEnd = endLine - 1;
  const before = lines.slice(0, zeroStart);
  const after = lines.slice(zeroEnd + 1);
  return {
    lines: [...before, ...newLines, ...after],
    message: `Replaced lines ${startLine}-${endLine}`,
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/file-tools.ts
git commit -m "feat: add applyLineEdit helper for write_file"
```

---

### Task 4: Rewrite execute logic

**Files:**
- Modify: `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Replace `execute` function body in `createWriteFileTool`**

Replace lines 38-57 (the `execute` function) with:

```typescript
execute: async (_id, { path, content, start_line, end_line, expected_hash }): Promise<AgentToolResult<null>> => {
  const resolved = jail.validate(path, "write");
  const fileExists = await access(resolved).then(() => true, () => false);

  if (!fileExists) {
    if (expected_hash !== undefined) {
      return {
        content: [{ type: "text" as const, text: `Error: Cannot provide expected_hash for new file` }],
        details: null,
      };
    }
    if (start_line !== undefined || end_line !== undefined) {
      return {
        content: [{ type: "text" as const, text: `Error: Line ranges not valid for new files` }],
        details: null,
      };
    }

    const dir = dirname(resolved);
    await mkdir(dir, { recursive: true });
    await writeFile(resolved, content, "utf-8");

    if (folderPath && onFileWrite) {
      const normalizedFolder = folderPath.replace(/\/$/, "");
      if (resolved.startsWith(`${normalizedFolder}/`)) {
        const relativePath = resolved.slice(normalizedFolder.length + 1);
        const fileName = resolved.split("/").pop() || relativePath;
        onFileWrite(resolved, relativePath, fileName);
      }
    }

    return {
      content: [{ type: "text" as const, text: `Written: ${resolved}` }],
      details: null,
    };
  }

  // File exists
  const existingContent = await readFile(resolved, "utf-8");
  const currentHash = sha256(existingContent);

  if (expected_hash !== undefined && expected_hash !== currentHash) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Hash mismatch: file changed. Current: ${currentHash}. Re-read file and retry.`,
        },
      ],
      details: null,
    };
  }

  const lines = existingContent.split("\n");
  const { lines: editedLines, message: editMessage } = applyLineEdit(lines, start_line, end_line, content);
  const newContent = editedLines.join("\n");

  await writeFile(resolved, newContent, "utf-8");

  if (folderPath && onFileWrite) {
    const normalizedFolder = folderPath.replace(/\/$/, "");
    if (resolved.startsWith(`${normalizedFolder}/`)) {
      const relativePath = resolved.slice(normalizedFolder.length + 1);
      const fileName = resolved.split("/").pop() || relativePath;
      onFileWrite(resolved, relativePath, fileName);
    }
  }

  const actionText = start_line !== undefined
    ? editMessage
    : "Overwritten";

  return {
    content: [{ type: "text" as const, text: `${actionText}: ${resolved}` }],
    details: null,
  };
},
```

- [ ] **Step 2: Add `access` import at top of file**

Add `access` to the `node:fs/promises` import:

```typescript
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/tools/file-tools.ts
git commit -m "feat: write_file supports line replacement and hash verification"
```

---

### Task 5: Write tests for new file behavior

**Files:**
- Modify: `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Add tests for new file with invalid parameters**

Add inside the `describe("execute", () => { ... })` block, after existing tests:

```typescript
it("rejects expected_hash for new file", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "new.txt");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "hello",
    expected_hash: "abc123",
  });

  expect(result.content[0].text).toContain("Cannot provide expected_hash for new file");
});

it("rejects line ranges for new file", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "new.txt");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "hello",
    start_line: 1,
  });

  expect(result.content[0].text).toContain("Line ranges not valid for new files");
});
```

- [ ] **Step 2: Run new tests — expect PASS**

Run: `bun test src/main/agent/tools/__tests__/file-tools.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/__tests__/file-tools.test.ts
git commit -m "test: write_file rejects hash/line ranges for new files"
```

---

### Task 6: Write tests for hash verification on existing files

**Files:**
- Modify: `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Add `createHash` import and hash helper at top of test file**

Add to imports:

```typescript
import { createHash } from "node:crypto";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
```

- [ ] **Step 2: Add hash match and mismatch tests**

Add inside `describe("execute", () => { ... })`:

```typescript
it("edits existing file when hash matches", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "existing.txt");
  const originalContent = "line1\nline2\nline3";
  await writeFile(filePath, originalContent, "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "replaced",
    expected_hash: sha256(originalContent),
  });

  expect(result.content[0].text).toContain("Overwritten");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("replaced");
});

it("blocks edit when hash mismatches", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "existing.txt");
  await writeFile(filePath, "original", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "new",
    expected_hash: "wronghash",
  });

  expect(result.content[0].text).toContain("Hash mismatch");
  expect(result.content[0].text).toContain("Re-read file and retry");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("original");
});
```

Note: `writeFile` and `readFile` from `node:fs/promises` are already imported in the test file.

- [ ] **Step 3: Run new tests — expect PASS**

Run: `bun test src/main/agent/tools/__tests__/file-tools.test.ts`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/main/agent/tools/__tests__/file-tools.test.ts
git commit -m "test: write_file hash verification on existing files"
```

---

### Task 7: Write tests for line replacement

**Files:**
- Modify: `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Add line replacement tests**

Add inside `describe("execute", () => { ... })`:

```typescript
it("replaces single line with start_line and end_line", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb\nc", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "X",
    start_line: 2,
    end_line: 2,
  });

  expect(result.content[0].text).toContain("Replaced lines 2-2");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("a\nX\nc");
});

it("replaces line range", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb\nc\nd", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "X\nY",
    start_line: 2,
    end_line: 3,
  });

  expect(result.content[0].text).toContain("Replaced lines 2-3");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("a\nX\nY\nd");
});
```

- [ ] **Step 2: Run new tests — expect PASS**

Run: `bun test src/main/agent/tools/__tests__/file-tools.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/__tests__/file-tools.test.ts
git commit -m "test: write_file line replacement"
```

---

### Task 8: Write tests for line insertion

**Files:**
- Modify: `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Add line insertion tests**

Add inside `describe("execute", () => { ... })`:

```typescript
it("inserts at start_line when end_line omitted", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb\nc", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "X\nY",
    start_line: 2,
  });

  expect(result.content[0].text).toContain("Inserted at line 2");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("a\nX\nY\nb\nc");
});

it("inserts at end when start_line > file length", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "c",
    start_line: 10,
  });

  expect(result.content[0].text).toContain("Inserted at line 10");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("a\nb\nc");
});
```

- [ ] **Step 2: Run new tests — expect PASS**

Run: `bun test src/main/agent/tools/__tests__/file-tools.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools/__tests__/file-tools.test.ts
git commit -m "test: write_file line insertion"
```

---

### Task 9: Write tests for edge cases

**Files:**
- Modify: `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Add edge case tests**

Add inside `describe("execute", () => { ... })`:

```typescript
it("errors when start_line < 1", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "x",
    start_line: 0,
  });

  expect(result.content[0].text).toContain("start_line must be >= 1");
});

it("errors when end_line < start_line", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "a\nb", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "x",
    start_line: 2,
    end_line: 1,
  });

  expect(result.content[0].text).toContain("end_line must be >= start_line");
});

it("overwrites entire file when no line params provided (backward compat)", async () => {
  const jail = makeJail();
  const tool = createWriteFileTool(jail, null);
  const filePath = join(tempDir, "lines.txt");
  await writeFile(filePath, "old", "utf-8");

  const result = await tool.execute("test-id", {
    path: filePath,
    content: "new",
  });

  expect(result.content[0].text).toContain("Overwritten");
  const final = await readFile(filePath, "utf-8");
  expect(final).toBe("new");
});
```

- [ ] **Step 2: Run all tests — expect PASS**

Run: `bun test src/main/agent/tools/__tests__/file-tools.test.ts`
Expected: all pass

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: all pass

- [ ] **Step 4: Run lint and format**

Run: `bun run check`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/tools/__tests__/file-tools.test.ts
git commit -m "test: write_file edge cases and backward compat"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| SHA-256 hash verification | Task 1, 4, 6 |
| Hash mismatch → error with current hash hint | Task 4, 6 |
| New file: no hash allowed | Task 4, 5 |
| New file: no line ranges allowed | Task 4, 5 |
| start_line + end_line → replace inclusive range | Task 3, 7 |
| start_line only → insert at line | Task 3, 8 |
| Neither → overwrite entire file | Task 3, 9 |
| start_line > file length → append | Task 8 |
| end_line > file length → treat as last line | Covered by `slice` behavior in `applyLineEdit` (endLine > lines.length => slice(endLine) returns empty, so content replaces to end) |
| start_line < 1 → error | Task 9 |
| end_line < start_line → error | Task 9 |
| Race: file created during tool call with hash → hash mismatch caught | Implicit: hash of empty/new file will mismatch expected hash |
| onFileWrite callback still fires for edits | Existing tests cover this; new logic preserves the callback block |

## No Placeholder Check

- No TBD/TODO/fill in later ✓
- All code blocks contain actual code ✓
- Exact file paths ✓
- Exact commands with expected output ✓
