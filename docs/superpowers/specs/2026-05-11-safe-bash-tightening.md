# Spec: Safe Bash Inline Code Detection

## Problem

`safe_bash` allows `python3`, `node`, and `bun` in its binary allowlist. This is legitimate for running existing project scripts (`python3 data_processing.py`, `node build.js`, `bun test`), but it also permits inline code execution on the host OS (`python3 -c "import os; os.system('...')"`, `node -e "require('fs').rmSync('/')"`).

The agent has `run_in_docker` available for code execution, but its tool description does not clearly signal when to use it. Agents naturally reach for `safe_bash` because it is familiar and described as "run a bash command".

## Goal

Make it impossible for the agent to accidentally run inline code on the host. When it tries, `safe_bash` detects the pattern and returns a structured hint directing the agent to `run_in_docker` instead.

## Non-Goals

- Do not block legitimate CLI tools (`git`, `bun test`, `npm install`, `python3 -m pytest`).
- Do not change the approval gate or blocklist for non-code patterns.
- Do not auto-redirect / auto-migrate to `run_in_docker` (fragile bash parsing).
- Do not block reading files or writing files (that is `PathJail`'s job).

## Architecture

### Detection Point

Insert a new `detectInlineCode(command)` function into `src/main/agent/extensions/safe-bash.ts`, called **before** `checkCommand`. It operates on the redirect-stripped command string, after `stripRedirects` but before operator and binary checks.

### Detection Rules

```
Binary: "python3" | "python"
  Flags:  -c | --command → inline code
  No positional args after flags → interactive REPL (same risk)
  → Hint with language: "python"

Binary: "node" | "node.exe"
  Flags:  -e | --eval | -p | --print → inline code
  No positional args after flags → interactive REPL
  → Hint with language: "javascript"

Binary: "bun"
  Flags:  -e | --eval → inline code
  No positional args after flags → interactive REPL
  → Hint with language: "typescript"
```

"No positional args after flags" means: after stripping flags and options, there is no bare argument that could be a script file. This naturally catches heredocs too (`python3 <<EOF` strips to just `python3`).

### Return Value

When detected, `safe_bash` returns a normal `AgentToolResult` (exit code 1) with a text payload that looks like:

```
This command runs code directly on your machine. For safety, use run_in_docker instead.

Example:
{
  "language": "python",
  "code": "import os\nprint(os.listdir('/workspace'))",
  "workspaceFiles": ["/path/to/file.csv"]
}

Output files written to /workspace/output/ are returned automatically.
```

This is a normal tool return, not an error throw. The agent reads the text and (should) switch tools.

## File Changes

### 1. `src/main/agent/extensions/safe-bash.ts`

Add:
- `detectInlineCode(command: string): { detected: true; language: string; reason: string } | null`
- Call it at the top of `runSafeBash`, before `checkCommand`
- When detected, return a `SafeBashResult` with `exitCode: 1` and a `stdout` containing the hint text

### 2. `src/main/agent/tools/docker-tool.ts`

- Add `"javascript"` to the `language` union literal.
- Update `description` to include an example with `workspaceFiles`.

### 3. `src/main/agent/extensions/docker-sandbox.ts`

- Add `"javascript"` to `IMAGES` (`node:20-alpine`) and `ENTRY_FILES` (`main.js`).
- Update `COMMANDS` for `javascript` to run `node /workspace/main.js`.

### 4. `src/main/agent/tools/safe-bash-tool.ts`

- Update `description` to clarify scope: "For code execution, use run_in_docker."

## Data Flow

```
Agent calls safe_bash("python3 -c 'print(1)'")
  ├─> stripRedirects → "python3 -c 'print(1)'"
  ├─> detectInlineCode → { detected: true, language: "python" }
  ├─> Returns AgentToolResult with exitCode 1 + hint text
  └─> Agent reads hint, switches to run_in_docker
```

```
Agent calls safe_bash("python3 script.py")
  ├─> stripRedirects → "python3 script.py"
  ├─> detectInlineCode → null (has positional arg)
  ├─> checkCommand → null (allowed binary, no operators)
  └─> runSafeBashInternal → normal execution
```

## Edge Cases

| Case | Detection | Outcome |
|---|---|---|
| `python3 -c "..."` | `detectInlineCode` catches `-c` | Hint returned |
| `python3` (no args) | `detectInlineCode` catches no positional arg | Hint returned |
| `python3 script.py` | `detectInlineCode` sees positional arg | Passes through |
| `python3 <<EOF` | `stripRedirects` strips `<<EOF`, then no positional arg | Hint returned |
| `node -e "console.log(1)"` | `detectInlineCode` catches `-e` | Hint returned |
| `node build.js` | `detectInlineCode` sees positional arg | Passes through |
| `bun run dev` | `detectInlineCode` sees positional arg | Passes through |
| `bun -e "console.log(1)"` | `detectInlineCode` catches `-e` | Hint returned |

## Testing

1. `safe-bash.test.ts` (or existing equivalent):
   - `detectInlineCode` unit tests for all patterns above
   - Verify hint text contains `run_in_docker` and example JSON

2. `docker-tool.test.ts` (or equivalent):
   - Verify `"javascript"` language works end-to-end
   - Verify `workspaceFiles` are copied into container

3. **Typecheck + Biome** must pass.

## Risks

1. **False positives**: Could block legitimate patterns like `python3 -m pip install`. Mitigation: `-m` does not trigger `-c` detection, and `pip install` has positional args (`install`).
2. **Agent confusion**: Agent might not understand the hint. Mitigation: Make the hint extremely explicit with a copy-pasteable `run_in_docker` example. The tool description also reinforces this.
3. **Heredoc edge case**: `python3 -c 'import os; os.system("""a;b""")'` with nested quotes. Mitigation: We do not parse the code string. We only look for the flag. The agent is responsible for translating its intent into `run_in_docker` parameters.
