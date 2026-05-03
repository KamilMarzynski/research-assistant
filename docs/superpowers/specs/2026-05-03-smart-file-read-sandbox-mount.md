# Design: Smart File Reading + Sandbox File Mounting

**Date:** 2026-05-03
**Scope:** Replace `read_file` with line-aware, mime-typed, auto-truncating version. Extend `run_in_docker` to accept workspace file references.
**Files:** `src/main/agent/tools/file-tools.ts`, `docker-tool.ts`, `docker-sandbox.ts`, `path-jail.ts`

---

## 1. New `read_file` Tool

### Parameters

```ts
Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  startLine: Type.Optional(Type.Integer({ default: 1, description: "1-based line number to start from" })),
  maxLines: Type.Optional(Type.Integer({ default: 500, description: "Max lines to return" })),
})
```

### Behavior

1. **Path validation** via `PathJail.validate(path, "read")`
2. **Read file as Buffer** — handles both text and binary files
3. **Compute hash** — `SHA-256(buffer)` stored as `fileHash` (hex). This covers the full file, not just returned lines.
4. **Mime detection** — extension-based map (no new dependency):
   | Extension | Mime |
   |-----------|------|
   | `.csv` | `text/csv` |
   | `.md`, `.markdown` | `text/markdown` |
   | `.ts`, `.tsx`, `.js`, `.jsx` | `text/javascript` or `text/typescript` |
   | `.json` | `application/json` |
   | `.html`, `.htm` | `text/html` |
   | `.css` | `text/css` |
   | `.py` | `text/x-python` |
   | `.sh` | `text/x-sh` |
   | `.yaml`, `.yml` | `text/yaml` |
   | `.sql` | `text/x-sql` |
   | `.txt` | `text/plain` |
   | fallback | `application/octet-stream` |
4. **Binary detection** — if mime is `application/octet-stream` or contains `image/`, `video/`, `audio/`, `application/pdf`, skip string conversion. Return placeholder content.
5. **Line splitting** — for text files: `buffer.toString("utf-8").split("\n")`, then strip trailing `\r` from each line. Count total lines.
6. **Truncation** — return lines `[startLine-1, startLine-1 + maxLines)`. If total > maxLines, `truncated = true`.
7. **Safety cap** — even with line limit, if the returned text exceeds 500KB, hard-truncate to 500KB to protect LLM context. `truncated = true`.

### Return Value

```ts
interface ReadFileResult {
  content: string;
  mimeType: string;
  truncated: boolean;
  hint: string | null;
  totalLines: number;
  lineCount: number;
  fileHash: string;      // SHA-256 of full file content (hex)
}
```

- `content` field of tool result: human-readable summary (`"Read 500 lines of data.csv (text/csv). Total: 10,000 lines."`)
- `details` field: the `ReadFileResult` object above (structured, machine-readable)

**Hint examples:**
- Small file, full read: `null`
- Truncated by lines: `"Returned lines 1-500 of 10,000. Use startLine=501 to read more."`
- Truncated by byte cap: `"Returned lines 1-500 of 10,000 (content truncated to 500KB). Use startLine=501 to read more."`
- Binary file: `"Binary file (application/pdf). Cannot read as text."`
- `fileHash` included in every response for write validation

### Agent Reasoning

The tool description must guide the agent:

> "Read a file with optional line pagination. Returns structured metadata (mimeType, totalLines, truncated, hint, fileHash). For text files, use startLine/maxLines to paginate. For binary files, content will be a placeholder — use run_in_docker for processing. Use fileHash when writing back to detect concurrent changes."

---

## 2. `run_in_docker` Workspace File Mounting

### New Parameter

```ts
workspaceFiles: Type.Optional(
  Type.Array(Type.String(), {
    description: "Absolute paths to files in the workspace to copy into the container before execution. Files will be available at /workspace/<filename>.",
  })
)
```

### Behavior

1. Agent provides `workspaceFiles: ["/path/to/data.csv", "/path/to/config.json"]`
2. Each path validated via `PathJail` (must be in workspace or linked project folder)
3. Files copied from workspace to `tmpDir` (same as inline `files`)
4. Container sees them at `/workspace/data.csv`, `/workspace/config.json`
5. Container code reads from these paths, writes results to `/workspace/output/`
6. `outputFiles` returned to agent as before
7. Agent can then `write_file` to save output back to workspace

### Security

- PathJail validation prevents escaping workspace
- No additional approval gate for now (user deferred)
- Copying is safer than bind-mounting — container only gets explicitly requested files

### Example Agent Workflow

```
1. read_file(path: "/workspace/data.csv")
   → "Returned lines 1-500 of 50,000 (text/csv). Use startLine=501..."

2. read_file(path: "/workspace/data.csv", startLine: 1, maxLines: 500)
   → First 500 lines

3. run_in_docker(
     language: "python",
     code: "import pandas as pd; df = pd.read_csv('/workspace/data.csv'); df.describe().to_json('/workspace/output/stats.json')",
     workspaceFiles: ["/workspace/data.csv"]
   )
   → outputFiles: [{ name: "stats.json", content: "..." }]

4. write_file(path: "/workspace/stats.json", content: "...")
```

---

## 3. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| File does not exist | Throw standard error (PathJail or fs) |
| `startLine` > totalLines | Return empty content, `hint: "File has N lines. startLine exceeds total."` |
| `startLine` < 1 | Clamp to 1 |
| Binary file | `content: "[Binary file — not readable as text]"`, correct mimeType |
| 500-line file with 1MB per line | Line limit returns 500 lines, but byte cap truncates content to 500KB. Both flags set. |
| `workspaceFiles` contains invalid path | PathJail rejects before container creation |
| `workspaceFiles` file missing | Copy fails, error returned before container starts |
| Container exits before writing output | Same as current — `outputFiles` empty, error in result |

---

## 4. Testing Strategy

### `read_file` tests
- Small text file → full content, `truncated: false`, correct mimeType, `fileHash` is SHA-256 of full file
- Big text file (1000 lines) → `truncated: true`, returns 500 lines, correct hint, `fileHash` is SHA-256 of full file (not just returned lines)
- CSV file → `mimeType: "text/csv"`, line count matches row count
- Binary file (`.png`) → placeholder content, `application/octet-stream`, `fileHash` still present
- `startLine=501` on 1000-line file → returns lines 501-1000
- `startLine=2000` on 100-line file → empty content, appropriate hint
- 500 lines of 2KB each → byte cap triggers, content truncated to 500KB

### `run_in_docker` + workspaceFiles tests
- Valid workspace file copied and readable inside container
- Invalid path rejected by PathJail
- Missing file handled gracefully
- Output files returned correctly

---

## 5. Implementation Notes

### No new dependencies
- Mime map is a static object in `file-tools.ts`
- Line splitting uses `Buffer.toString().split("\n")`
- Byte cap uses `Buffer.byteLength()`
- Hash uses `node:crypto.createHash("sha256")`

### Performance
- File read is `O(total size)` due to full Buffer load for line counting
- For very large files (>100MB), this is acceptable since agent won't read them frequently
- Future optimization: streaming line counter for files > 100MB

### Backward compatibility
- Old `read_file` params: `{ path }` — still works, returns full file for small files (with new structured response)
- New optional params: `{ path, startLine, maxLines }` — additive only
- `AgentToolName` stays `"read_file"` — no new tool name

---

## 6. Deferred (Future Work)

- **Security gate for non-project files** — deferred per user request. PathJail handles basic validation.
- **write_file optimistic locking** — `fileHash` returned by `read_file` will be used in `write_file` later to detect concurrent changes.
- **Byte-based pagination** — user wants row-only for now. Byte cap is safety net, not primary interface.
