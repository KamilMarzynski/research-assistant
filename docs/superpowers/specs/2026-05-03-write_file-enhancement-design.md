# write_file Enhancement Design

## Overview
Extend `write_file` tool with line-based replacement and file hash verification for safe concurrent edits.

## API Changes

### Parameters (TypeBox schema)
```typescript
const writeFileParameters = Type.Object({
  path: Type.String({ description: "Absolute path to the file" }),
  content: Type.String({ description: "Content to write" }),
  start_line: Type.Optional(Type.Number({ description: "1-based line number to insert at or start replacement. Existing line at this position shifts down." })),
  end_line: Type.Optional(Type.Number({ description: "1-based inclusive line number to end replacement. If omitted with start_line, inserts at start_line without replacing any lines." })),
  expected_hash: Type.Optional(Type.String({ description: "SHA-256 hash of current file contents (as agent last saw it). Required when editing existing files to prevent overwriting concurrent changes." })),
});
```

## Behavior

### Case 1: New file (does not exist)
- `expected_hash` must NOT be provided → error: "Cannot provide expected_hash for new file"
- `start_line`/`end_line` must NOT be provided → error: "Line ranges not valid for new files"
- Create file with `content`

### Case 2: Existing file
1. Compute current SHA-256 hash
2. If `expected_hash` provided:
   - Compare with current hash
   - Mismatch → return error with hint: "File changed since last read. Current hash: <hash>. Re-read file and retry."
   - Match → proceed
3. If `expected_hash` omitted → proceed without check (backward compat)

### Case 3: Line operations on existing file
- **Both `start_line` + `end_line`**: Replace lines [start_line, end_line] inclusive with `content`
- **`start_line` only**: Insert `content` at `start_line`, shifting existing line at that position and all below down
- **Neither**: Overwrite entire file

### Edge cases
- `start_line` > file line count → append at end
- `end_line` > file line count → treat as last line
- `start_line` < 1 → error
- `end_line` < `start_line` → error

### Race condition
If file created between hash check and write, hash mismatch will be caught by step 2 (hash of empty file vs expected). If expected_hash omitted, proceed (same as current behavior).

## Return Value
Same structure, text messages updated:
- Success: `"Written: <path>"` or `"Edited: <path> (lines X-Y)"` or `"Inserted: <path> at line X"`
- Hash mismatch: `"Hash mismatch: file changed. Current: <hash>. Re-read and retry."`

## Testing
- Hash match → edit succeeds
- Hash mismatch → edit blocked with current hash in message
- New file with hash → error
- Line insertion at start/middle/end
- Line replacement single and range
- Out of bounds start_line (append)
- Invalid line ranges (errors)

## Files Modified
- `src/main/agent/tools/file-tools.ts` — tool implementation
- `src/main/agent/tools/__tests__/file-tools.test.ts` — tests

## Files NOT Modified
- `src/main/agent/tools.ts` — no new tool names needed
- `read_file` — parallel agent handles hash returns
