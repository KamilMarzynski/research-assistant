# `read_file` JSON Envelope — Make Tool Result Visible to Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Background

`read_file` currently returns:

```ts
{
  content: [{ type: "text", text: `Read N lines of foo.ts (text/typescript). Total: T lines.` }],
  details: { content, mimeType, truncated, hint, totalLines, lineCount, fileHash },
}
```

Pi-ai sends only `AgentToolResult.content` to the model (`anthropic.js:74-78` + `:689`). `details` is consumed locally by the UI/event bus and **dropped before serialization to the provider**. There is no `afterToolCall` hook in `MessagePipeline.ts:204` that injects `details` back into `content`.

**Consequence:** the model never sees the file body, the `sha256` hash, the truncation flag, or the pagination hint. Two failure modes follow:

1. Model falls back to `safe_bash` (`cat`, `head`, `shasum`) to read files and to compute `expected_hash` for `write_file` (made mandatory in `36f7a41`).
2. Even when `read_file` is used, the model has no way to confirm what range was returned and may assume a full read on a truncated chunk.

**Regression origin:** commit `1f4c706` ("merge: integrate smart read_file from main with write_file enhancements", 2026-05-03). Before that commit, `read_file` returned the raw body as `content[0].text` (no hash, but at least visible). The "smart" refactor moved everything to `details`.

## Goal

`read_file` returns a **JSON envelope** as a single text block. Same object serves as `details` (single source of truth). Model can read body, verify the requested range was actually returned, and reuse `sha256` directly for `write_file.expected_hash` — no fallback to `safe_bash` for reads or hashing.

## Tech Stack

TypeScript strict, Vitest, `@sinclair/typebox`, `node:fs/promises`, `node:crypto`, `node:path`.

---

## Response Shape

Single `text` content block whose payload is `JSON.stringify(payload, null, 2)`. `details` is the same `payload` object.

### Text file (success)

```json
{
  "path": "/abs/path/foo.ts",
  "mimeType": "text/typescript",
  "sha256": "abc123…",
  "totalLines": 523,
  "startLine": 1,
  "endLine": 500,
  "linesReturned": 500,
  "truncated": true,
  "hint": "Returned 500 of 523 lines. Use startLine=501 to read more.",
  "content": "<raw slice — no line-number prefix>"
}
```

### Binary file

```json
{
  "path": "/abs/path/photo.png",
  "mimeType": "image/png",
  "sha256": "…",
  "isBinary": true,
  "totalLines": 0,
  "startLine": null,
  "endLine": null,
  "linesReturned": 0,
  "truncated": false,
  "hint": "Binary file (image/png). Cannot read as text.",
  "content": null
}
```

### Empty file or `startLine > totalLines`

```json
{
  "path": "/abs/path/empty.txt",
  "mimeType": "text/plain",
  "sha256": "e3b0c44…",
  "totalLines": 0,
  "startLine": null,
  "endLine": null,
  "linesReturned": 0,
  "truncated": false,
  "hint": null,
  "content": ""
}
```

For `startLine > totalLines`: `startLine`/`endLine` = `null`, `linesReturned` = 0, `hint` = `"File has T lines. startLine S exceeds total."`.

### Approval denied

Keep current shape — plain text content, **no JSON envelope**. The toolResult is semantically an error; mixing into JSON would hide that signal from the model. The path-approval flow has its own UX contract.

```
{ content: [{ type: "text", text: "User did not approve access to "<path>". …" }], details: { … minimal … } }
```

`details` here retains current placeholder fields for UI compatibility; do not bother JSON-envelope-ing this branch.

### Field rationale

| Field | Why |
|---|---|
| `path` | Echo the resolved absolute path. Model confirms relative-vs-absolute and symlink-resolution surprises. |
| `mimeType` | Existing detection. Model branches on text vs. binary. |
| `sha256` | Hash of full file buffer (not the slice). Drop-in value for `write_file.expected_hash`. Named `sha256` over `fileHash` to match what `expected_hash` actually is. |
| `totalLines` | File-wide truth; lets model decide whether to paginate. |
| `startLine` / `endLine` | 1-based inclusive range actually returned. Removes guesswork when calling `write_file(start_line=…, end_line=…)`. `null` when no lines returned. |
| `linesReturned` | Explicit count. Avoids `endLine - startLine + 1` mental math and makes truncation obvious. |
| `truncated` | Bool. Prominent enough that the model treats partial reads carefully. |
| `hint` | Pagination instruction or null. Generated server-side so the model doesn't have to compute. |
| `content` | Raw slice. No `cat -n` prefix — `startLine` already carries the line-number context, and a clean body avoids the model having to strip prefixes when reasoning about exact bytes. |
| `isBinary` | Present only for binary branch. Avoids `mimeType` string-matching by the model. |

### Removed / renamed

- **`fileHash` → `sha256`.** Matches `write_file.expected_hash` semantics.
- **`lineCount` dropped.** Was post-compression line count of `content`; redundant with `linesReturned` and confusing when compression rewrites the body.

---

## Implementation

### File Structure

| File | Responsibility |
|------|---------------|
| `src/main/agent/tools/file-tools.ts` | New `SmartReadResult` shape, single-source-of-truth envelope, updated tool description |
| `src/main/agent/tools/__tests__/file-tools.test.ts` | Add envelope-shape tests; update existing tests reading `details.fileHash`/`details.lineCount` |
| `src/main/agent/tools/file-tools.ts` (write_file) | Update `expected_hash` error message: `"… retry with the sha256 returned by read_file."` |
| `src/main/agent/prompts.ts` | One-line note: `read_file` returns JSON; reuse `sha256` for `write_file.expected_hash` |

No changes to pi-agent-core / pi-ai. No `afterToolCall` hook needed.

### Type

```ts
// src/main/agent/tools/file-tools.ts

export type SmartReadResult = {
  path: string;
  mimeType: string;
  sha256: string;
  totalLines: number;
  startLine: number | null;
  endLine: number | null;
  linesReturned: number;
  truncated: boolean;
  hint: string | null;
  content: string | null;
  isBinary?: true;
};
```

### Envelope construction

```ts
const payload: SmartReadResult = { /* … built once … */ };
return {
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  details: payload,
};
```

`details === payload` (reference-equal). One object, two consumers.

### Tool description

Replace current:

> "Read the contents of a file. Read before answering any question about file contents — do not guess. Supports smart pagination (startLine/maxLines) and returns a SHA-256 hash for write conflict detection. Use userProjectDir when exploring the user's project."

With:

> "Read a file. Returns a JSON object with `path`, `mimeType`, `sha256`, `totalLines`, `startLine`, `endLine`, `linesReturned`, `truncated`, `hint`, `content`. Use `sha256` directly as `expected_hash` when calling `write_file`. Paginate with `startLine`/`maxLines`; check `truncated` and follow `hint` to read more. Use `userProjectDir` when exploring the user's project. Always read before editing — never compute hashes via `safe_bash`."

The explicit "never `safe_bash` for hashing" line is the strongest signal we can give the model without runtime enforcement.

### Compression ordering

`sha256` is computed on the full `buffer` (line 169) **before** compression (line 219). Keep that ordering — the hash must reflect the on-disk file, not the compressed view shown to the model. Verify in tests.

---

## Tasks

### Task 1: Type + envelope

**Files:** `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Update `SmartReadResult` type** — add `path`, `sha256`, `startLine`, `endLine`, `linesReturned`, `isBinary`; drop `lineCount`; rename `fileHash` → `sha256`.
- [ ] **Step 2: Build envelope once, return as text + details** — single `payload` object; `JSON.stringify(payload, null, 2)` in `content`; `details: payload`.
- [ ] **Step 3: Update binary branch** — `isBinary: true`, `content: null`, `startLine: null`, `endLine: null`, `linesReturned: 0`.
- [ ] **Step 4: Update startLine-exceeds-total branch** — `startLine: null`, `endLine: null`, `linesReturned: 0`, hint with absolute totals.
- [ ] **Step 5: Update denied branch** — leave plain-text content; minimal `details` (path, sha256: "", isBinary or not, all-nulls/zeros) sufficient for UI.

### Task 2: Tool description + write_file message

**Files:** `src/main/agent/tools/file-tools.ts`

- [ ] **Step 1: Replace `read_file` description** — see "Tool description" above.
- [ ] **Step 2: Update `write_file` `expected_hash` error messages** — `"… retry with the sha256 returned by read_file."` (two occurrences: missing hash, mismatched hash).

### Task 3: Prompts

**Files:** `src/main/agent/prompts.ts`

- [ ] **Step 1: Add one sentence** to the file-tool section of the worker prompt:
  > `read_file` returns JSON with `sha256`. Reuse that exact value as `write_file.expected_hash` — do not compute hashes via `safe_bash`.

### Task 4: Tests (TDD — red first)

**Files:** `src/main/agent/tools/__tests__/file-tools.test.ts`

- [ ] **Step 1: Failing test — text envelope shape**
  ```ts
  it("returns JSON envelope as content text", async () => {
    /* write "a\nb\nc" */
    const result = await tool.execute("id", { path });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      path,
      mimeType: "text/plain",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      totalLines: 3,
      startLine: 1,
      endLine: 3,
      linesReturned: 3,
      truncated: false,
      hint: null,
      content: "a\nb\nc",
    });
    expect(result.details).toBe(parsed); // same shape; reference equality if same object
  });
  ```
- [ ] **Step 2: Failing test — truncated pagination** — 600-line file, `maxLines: 100`: `truncated: true`, `startLine: 1`, `endLine: 100`, `linesReturned: 100`, `hint` mentions `startLine=101`.
- [ ] **Step 3: Failing test — startLine past EOF** — 5-line file, `startLine: 99`: `startLine: null`, `endLine: null`, `linesReturned: 0`, hint with `5 lines` and `startLine 99`.
- [ ] **Step 4: Failing test — binary** — write PNG magic bytes: `isBinary: true`, `content: null`, `mimeType: "image/png"` (or `application/octet-stream` for unknown ext), `sha256` non-empty.
- [ ] **Step 5: Failing test — empty file** — `totalLines: 0`, `startLine: null`, `endLine: null`, `linesReturned: 0`, `content: ""`, `sha256` matches sha256 of empty buffer.
- [ ] **Step 6: Failing test — sha256 reflects full file, not slice** — 1000-line file read with `maxLines: 10`; computed `sha256` matches hashing the full on-disk buffer.
- [ ] **Step 7: Failing test — sha256 round-trips into write_file** — call `read_file`, take `sha256`, pass to `write_file` with `start_line/end_line`; write succeeds. Then mutate file out-of-band, repeat with stale `sha256`; write returns hash-mismatch error.
- [ ] **Step 8: Update existing tests** — anywhere `details.fileHash` is asserted → `details.sha256`; anywhere `details.lineCount` is asserted → delete or replace with `details.linesReturned`.
- [ ] **Step 9: Make all tests pass** — implement Tasks 1–3, run `bun run test`.

### Task 5: Verification

- [ ] `bun run typecheck` — zero errors
- [ ] `bun run check` — zero lint/format issues
- [ ] `bun run test` — all tests pass
- [ ] `bun run test:coverage` — ≥90% thresholds maintained on `file-tools.ts`
- [ ] Launch app, exercise `read_file` against a real file in a research run, confirm via Langfuse trace that `tool_result.content` to Anthropic contains the JSON envelope (not the old summary string)
- [ ] Same trace: confirm agent reuses `sha256` from `read_file` in subsequent `write_file` call — **no `safe_bash` `shasum`/`sha256sum` invocation** between them

---

## Out of Scope

- **`write_file` envelope.** Stays as-is — text confirmation is fine; no metadata the model needs back.
- **`list_dir` envelope.** Not affected.
- **Adding `afterToolCall` hook in pi-agent-core.** Not needed; envelope-in-content is sufficient and keeps the fix local.
- **`cat -n` line-number prefixing in `content`.** Considered, rejected: `startLine` already carries the context, and a raw body lets the model reason about exact bytes for diffs.
- **Reducing JSON-escape noise** (e.g. XML envelope with fenced body). JSON is parsed reliably by current providers; escape noise is acceptable. Revisit only if observed model behavior degrades.

## Risks

1. **Breaking change for any internal consumer parsing `read_file` text output.** Audit: only the model "parses" this; UI uses `details`. Renderer reads `details.content` (unchanged field path). Low risk.
2. **`details` shape change breaks UI.** `fileHash` → `sha256` rename, `lineCount` drop, added `path` / `startLine` / `endLine` / `linesReturned` / `isBinary`. Update any renderer that reads `details.fileHash` or `details.lineCount`. Grep before landing.
3. **Token cost.** JSON envelope adds ~10 wrapping tokens per read — negligible vs. the content itself.
4. **Tool description length.** New description is longer; trims acceptable if cache-warming costs matter.
