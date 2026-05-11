# Security Model: File & Command Jail

This document describes how the agent is confined when reading files, writing files, and running shell commands.

## Philosophy

The agent runs inside the user's own OS, so the sandbox is **cooperative**, not hardware-isolated. Two independent mechanisms enforce boundaries:

1. **PathJail** — filesystem access is whitelisted to specific directories.
2. **Safe Bash** — shell commands are filtered through a blocklist + allowlist before execution.

Both mechanisms can escalate to a user-approval gate rather than failing silently.

---

## 1. Filesystem Jail (`PathJail`)

Every file operation (`read_file`, `write_file`, `list_dir`, `compress`) routes its path through `PathJail.validate(path, mode)`.

### 1.1 Allowed Zones

Each project gets a `PathJail` instance constructed with:

- `workspace` — `~/.scholar/workspace/<projectId>` (read + write)
- `projectsDir` — `~/.scholar/projects/<slug>` (read + write)
- `projectFolder` — the linked project folder, if any (read + write)
- `homeSkills` — `~/.scholar/skills` (read-only)
- `projectHomeSkills` — `<projectFolder>/.scholar/skills` (read-only)

### 1.2 Validation Pipeline

`validate(inputPath, mode)` runs in this order:

1. **Normalize & resolve** — `resolve(normalize(inputPath))`. This collapses `..` and `./` segments, so traversal strings like `workspace/../../etc/passwd` are resolved to absolute paths *before* zone checks.
2. **Zone membership** — `startsWith("${zone}/") || path === zone` against read-write zones, then read-only zones.
3. **Read-only enforcement** — if the path lands in a read-only zone and `mode === "write"`, it throws immediately.
4. **Symlink walk (`walkComponents`)** — starting from the matching zone root, each directory component is checked with `realpathSync`. If any intermediate symlink resolves outside the zone, it throws. This prevents symlink escapes.
5. **Fallback to allowlist** — if the path is not in any zone, `AllowlistService.isAllowed()` checks:
   - Per-project session allowlist (`sessionAllowlists` Map)
   - If still not allowed, returns `{ needsApproval: true }`

### 1.3 Approval Flow

When `validate` throws `ApprovalRequiredError`, the tool's `execute` function catches it and emits a `path:approval_required` event via the EventBus. The main process stores the pending approval in `pendingPathApprovals` and the renderer shows a UI prompt.

IPC handlers:
- `GET_PENDING_PATH_APPROVALS` — list awaiting approvals
- `RESOLVE_PATH_APPROVAL` — user chooses `approve_once` or `approve_session`; the path is added to `AllowlistService.sessionAllowlists`

After approval, the agent must retry the tool call.

### 1.4 Edit Safety (`write_file`)

`write_file` supports line-range edits. To prevent lost updates:

- `expected_hash` (SHA-256 of the file as the agent last saw it) is **required** when editing an existing file.
- If the current hash does not match, the tool returns an error telling the agent to re-read.
- New files cannot provide `expected_hash`.

### 1.5 Key Code References

- `src/main/agent/path-jail.ts` — zone logic + symlink walking
- `src/main/agent/tools/file-tools.ts` — tool wrappers that call the jail
- `src/main/services/AllowlistService.ts` — session + config allowlists
- `src/main/ipc/command-handlers.ts` — IPC resolution of pending approvals

---

## 2. Command Jail (`safe_bash`)

The agent cannot spawn arbitrary processes. The only command tool is `safe_bash`, which wraps a heavily filtered `bash -c` execution.

### 2.1 Tool Surface

```ts
{
  name: "safe_bash",
  parameters: {
    command: "The bash command to run",
    intent: "What you are trying to accomplish with this command"
  }
}
```

The `intent` field is mandatory and is logged to the audit trail.

### 2.2 Blocklist Logic (`checkCommand`)

Before any command runs, it passes through `checkCommand(command)` in `src/main/agent/extensions/safe-bash.ts`:

1. **Strip redirects** — `2>&1`, `> file`, `>> file`, etc. are removed so they do not interfere with binary extraction.
2. **Unsafe operators** — `;`, `|`, `&` outside single-quoted strings are blocked. This prevents command chaining.
3. **Dangerous patterns** — regex blocklist:
   - `\bsudo\b` — privilege escalation
   - `\bsu\b` — privilege escalation
   - `\bmkfs\b` — filesystem destruction
   - `\bdd\b` — raw disk I/O
   - `\bcurl\b` / `\bwget\b` — network outbound (agent must use `fetch_url` instead)
   - `\beval\b` — dynamic code execution
4. **Command substitution** — `$()` and backticks are blocked.
5. **Binary allowlist** — the first binary name is extracted (stripping variable assignments and path prefixes). It must exist in `ALLOWED_BINARIES` (e.g. `ls`, `git`, `node`, `python3`, `bun`) or `ALLOWED_BUILTINS` (e.g. `cd`, `export`, `sleep`). Unknown binaries are rejected.

If any check fails, a `BlockedResult` is produced with a `category`:
- `destructive`
- `privilege_escalation`
- `exfiltration`
- `persistence`
- `unsafe_operator`
- `unknown_binary`

### 2.3 Approval Gate

When a command is blocked, `runSafeBash` does not fail immediately. Instead it enters an **approval gate**:

- A UUID (`commandId`) is generated.
- A 5-minute timer starts.
- The `blocked` event is emitted to the renderer via `emitBlocked`.
- The renderer shows the command, reason, and category, and offers:
  - **Approve once** — runs this single invocation
  - **Approve session** — hashes the normalized command (SHA-256, lowercased, collapsed whitespace) and adds it to a per-project session allowlist
  - **Deny** — rejects with `BlockedCommandError`

IPC handler:
- `RESOLVE_BLOCKED_COMMAND` — resolves the promise and either runs the command or rejects.

Session allowlists are stored in-memory only (`Map<projectId, Set<hashedCommand>>`) and are cleared when the app restarts.

### 2.4 Execution Environment

Once cleared (either by passing filters or by user approval), `runSafeBashInternal` spawns:

```ts
spawn("bash", ["-c", command], {
  cwd: workspacePath,
  signal: controller.signal,
});
```

Constraints:
- **CWD locked** to the project workspace.
- **Timeout** — 30 seconds default (`AbortController` kills the process).
- **Output cap** — stdout and stderr are truncated at 65,536 bytes each.
- **Audit log** — every execution is appended as JSON to `~/.scholar/audit.log` with timestamp, projectId, intent, command, and exit code.

### 2.5 Key Code References

- `src/main/agent/extensions/safe-bash.ts` — blocklist, approval gate, execution engine
- `src/main/agent/tools/safe-bash-tool.ts` — thin tool wrapper
- `src/main/ipc/command-handlers.ts` — IPC resolution of blocked commands

---

## 3. Integration with the Agent Harness

### 3.1 Tool Registration

`AgentSession` constructs the tool set in `src/main/agent/session.ts`:

```ts
const tools = createAgentTools({
  projectId, projectName, folderPath, homePath,
  emitBlocked: (payload) => eventBus.emit({ type: "bash:blocked", payload }),
  emitApprovalRequired: (payload) => {
    addPendingPathApproval(payload);
    eventBus.emit({ type: "path:approval_required", payload });
  },
  // ... other deps
});
```

The `Agent` from `@mariozechner/pi-agent-core` receives these tools. Its `beforeToolCall` hook currently only verifies that the tool name exists in the registered list. It does **not** perform additional filtering; all enforcement lives inside the tool implementations.

### 3.2 Event Flow (Blocked Bash)

```
Agent calls safe_bash
  └─> checkCommand blocks it
       └─> enterApprovalGate
            ├─> emitBlocked → EventBus → renderer UI shows prompt
            └─> waits for RESOLVE_BLOCKED_COMMAND IPC
                 └─> user approves → runSafeBashInternal → spawn
```

### 3.3 Event Flow (Blocked Path)

```
Agent calls read_file with /etc/passwd
  └─> jail.validate throws ApprovalRequiredError
       └─> tool catches it
            └─> emitApprovalRequired → EventBus + pendingPathApprovals
                 └─> renderer UI shows prompt
                      └─> user sends RESOLVE_PATH_APPROVAL
                           └─> AllowlistService.approveSession(path)
```

### 3.4 Research Sub-agents

Research workers (spawned by `start_research`, `spawn_agent`, etc.) receive the same tool factory (`createAgentTools`) but may be constructed with a restricted `toolNames` list. Regardless, they share the same `PathJail` and `safe_bash` extension logic.

---

## 4. Threat Model & Limits

| Attack vector | Mitigation | Limit |
|---|---|---|
| Path traversal (`../../etc/passwd`) | `resolve(normalize(...))` before zone checks | None significant |
| Symlink escape | `realpathSync` per component in `walkComponents` | Race window between validation and `fs` call is small but non-zero |
| Command chaining (`; rm -rf /`) | Block `;`, `|`, `&` outside single quotes | Sophisticated quoting tricks could evade naive regex (ongoing risk) |
| Dynamic execution (`eval`, `$()`) | Regex blocklist | Agent may encode commands in base64 and pipe to `bash` if allowed binaries are too permissive |
| Network exfiltration | Block `curl`/`wget` in `safe_bash` | Agent can still write files to allowed zones and encode data; `fetch_url` is outbound-only by design |
| Privilege escalation | Block `sudo`, `su` | Assumes agent does not find setuid binaries in allowed paths |
| Denial of service | 30s timeout + 65k output cap | Fork bombs inside `bash -c` are not specifically rate-limited |

### Known gaps

- **No sandboxing** — commands run as the user. There is no seccomp, chroot, or container isolation yet. Tier 3 (`run_in_sandbox` via E2B) is planned but not implemented.
- **Binary allowlist is broad** — `node`, `python3`, and `bun` can execute arbitrary code. The current model relies on the agent not being adversarial, plus the command-structuring blocklist.
- **No filesystem syscall interception** — the `PathJail` validates the *argument* path, but a command like `python3 -c "import os; os.remove('/etc/passwd')"` bypasses it entirely. This is accepted for Tier 2; Tier 3 will use a real sandbox.

---

## 5. Adding New Restrictions

### To block a new binary

Edit `ALLOWED_BINARIES` in `src/main/agent/extensions/safe-bash.ts`.

### To block a new dangerous pattern

Add an entry to `DANGEROUS_COMMANDS` in the same file.

### To add a new filesystem zone

Edit `PathJail` constructor in `src/main/agent/path-jail.ts` and push the path into `readWriteZones` or `readOnlyZones`.

### To change command timeout or output size

Modify `timeoutMs` and `MAX_OUTPUT_CHARS` in `src/main/agent/extensions/safe-bash.ts`.
