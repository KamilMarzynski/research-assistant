# Phase B — Memory & Skills Design Spec

> **Date**: 2026-05-03
> **Scope**: `save_memory`/`read_memory` tools, app + project `.md` memory, Observer `.md` writing, skill refresh with file watcher + delta injection.
> **Status**: Approved

---

## 1. Architecture Overview

### Memory Model: Complement (not replace)

| System | Purpose | Auto-compressed? | User-editable? |
|---|---|---|---|
| **Mastra OM** | Conversational history, implicit preferences | Yes (Observer at 30k tokens) | No |
| **`.md` memory** | Explicit structured facts, decisions, conventions | Yes (MEMORY.md at 1.5k words) | Yes |

- Mastra stays as-is. No changes to `MemoryManager.ts` compression pipeline.
- `.md` memory is agent-authored via `save_memory` tool. User can read/edit files directly.
- Clear boundary: Mastra = "what did we talk about?", `.md` = "what did the agent formally record?"

### Skill Refresh: File Watcher + Delta Injection

- `chokidar` watches `~/.research-assistant/skills/` and `~/.agents/skills/` in main process.
- On skill file change: re-scan frontmatter, compute hash. If changed, emit `skill:changed` EventBus event.
- `AgentSession` listens for `skill:changed`. Stores pending delta.
- On next agent turn, injects delta as a `user` role message (not system prompt mutation). Avoids prompt cache invalidation cost.
- If chokidar fails: log warning. No manual fallback UI.

---

## 2. New Agent Tools

### 2.1 `save_memory`

Writes a structured memory as a `.md` file with YAML frontmatter.

**Parameters:**
```yaml
category: philosophy | decision | finding | tool_reference | project_convention
title: string
content: string
scope: app | project
```

**Behavior:**
- `scope=app` → writes to `~/.research-assistant/app-memory/{category}/{slugified-title}.md`
- `scope=project` → writes to `<folderPath>/.agents/memory/{category}/{slugified-title}.md`
  - If project has no `folderPath`, falls back to `~/.research-assistant/projects/<slug>/memory/{category}/{slugified-title}.md`
- Frontmatter: `title`, `category`, `scope`, `created_at` (ISO 8601)
- Body: freeform markdown content
- Tool result: `Saved memory to: {path}`

**Error handling:**
- If target directory is not writable (read-only project folder), fall back to app dir equivalent. Report actual path used.

### 2.2 `read_memory`

Reads memories by filter or text search.

**Parameters:**
```yaml
category: philosophy | decision | finding | tool_reference | project_convention | null
query: string | null          # text search across title and body
scope: app | project | both
```

**Behavior:**
- Scans relevant memory directories (app + project depending on scope)
- Reads YAML frontmatter of each `.md` file (fast scan, <100ms for <100 files)
- Matches against `category` (exact) and `query` (fuzzy substring match on title + body)
- Returns structured text listing matches with title, category, created_at, and excerpt

**Error handling:**
- If memory dir doesn't exist, return `"No memories found in this scope."` — not an error.

---

## 3. MEMORY.md Auto-Summarization

### 3.1 Structure

**App-level:** `~/.research-assistant/app-memory/MEMORY.md`
**Project-level:** `<folderPath>/MEMORY.md` (or `~/.research-assistant/projects/<slug>/MEMORY.md`)

Content: rolling summary of key facts, conventions, recurring patterns.
Max length: ~1.5k words.

### 3.2 Trigger

When MEMORY.md exceeds 1.5k words:
1. Read current content
2. Call LLM (haiku or equivalent) to compress into ~500 words preserving key facts
3. Write compressed version back to MEMORY.md
4. Archive original full version to `memory/archive/YYYY-MM-DD.md`

### 3.3 Session Flush

Before agent session ends (or periodically every ~10 turns), agent appends any newly learned key facts to MEMORY.md. If this pushes it over threshold, summarization triggers.

---

## 4. Observer Writes to `.md` Memory

### 4.1 Current Behavior

`MemoryManager.Observer` compresses conversations when >30k tokens. Writes summary to Mastra DB metadata (`${projectId}-summary` thread).

### 4.2 New Behavior

After compression, also write to filesystem:
- Path: `~/.research-assistant/projects/<slug>/memory/YYYY-MM-DD.md`
- Frontmatter: `type: observation`, `date`, `thread_id`, `project_id`
- Body: compressed conversation summary + key facts extracted by Observer

This makes Mastra memory observable and editable by the user.

---

## 5. Skill Refresh

### 5.1 File Watcher Setup (main process)

- `chokidar` watches:
  - `~/.research-assistant/skills/`
  - `~/.agents/skills/`
  - `<folderPath>/.agents/skills/` (if folderPath exists)
  - `<folderPath>/.research-assistant/skills/` (if folderPath exists)
- On change: re-read skill frontmatter, compute SHA-256 hash of `name + description + first 200 chars of body`
- If hash differs from stored manifest: emit `skill:changed` EventBus event with `{ skillName, summary }`
- Store updated hash in `~/.research-assistant/skills_manifest.json`

### 5.2 Delta Injection (AgentSession)

- `AgentSession` subscribes to `skill:changed` via EventBus.
- On event: store pending delta in session state.
- Next time agent sends a message: prepend delta as `user` role message:
  ```
  Skill "web_search" was updated. Summary of changes: description now mentions DuckDuckGo fallback.
  ```
- Agent sees this as conversation content, not system prompt change. No cache invalidation.
- Clear pending delta after injection.

---

## 6. Directory Layout

```
~/.research-assistant/
  app-memory/
    MEMORY.md                      ← rolling app-level summary
    philosophy/
      prefer-functional-programming.md
    decisions/
      use-drizzle-over-prisma.md
    tools-reference/
      web-search-usage.md
    findings/
      rust-ownership-model.md
    archive/                         ← archived MEMORY.md versions
      2026-05-01.md

  projects/<slug>/
    AGENTS.md                        ← existing
    MEMORY.md                        ← rolling project summary
    memory/
      2026-05-01.md                  ← Observer daily observations
      2026-05-02.md
    decisions/
      use-duckdb-for-analytics.md
    findings/
      market-research-q2.md
    .agents/skills/                  ← existing
    .agents/memory/                  ← project-level memory (mirror of app-memory/)

  skills_manifest.json               ← skill name → content hash map
```

---

## 7. Data Flow

1. **Agent session starts** → `buildSystemContext` loads `AGENTS.md`, `MEMORY.md`, skills, `config.md` into system prompt.
2. **User sends message** → Agent reasons, may call `save_memory` or `read_memory`.
3. **`save_memory`** → Tool writes `.md` to filesystem, returns path.
4. **`read_memory`** → Tool scans memory dirs, reads frontmatter, returns matches.
5. **Conversation exceeds 30k tokens** → Observer compresses, writes to Mastra DB + `memory/YYYY-MM-DD.md`.
6. **MEMORY.md exceeds 1.5k words** → Background summarization: rewrite compact version, archive old.
7. **Skill file changes** → chokidar emits event → delta injected into next agent turn.

---

## 8. Error Handling

- `save_memory`: if directory not writable, fall back to app dir. Report path used.
- `read_memory`: if memory dir doesn't exist, return "No memories found in this scope."
- `chokidar` failure: log warning. No manual fallback UI.
- MEMORY.md summarization failure: keep original, log error, retry on next threshold crossing.
- Observer `.md` write failure: log error. Mastra DB write still succeeds (primary source).

---

## 9. Testing

- `save_memory` tool: correct frontmatter, respects scope, fallback on permission error
- `read_memory` tool: category filter, text search, scope selection, empty dir handling
- Observer `.md` writing: daily observation file created with correct frontmatter
- Skill refresh: mock file change event, verify delta message format, verify no system prompt mutation
- MEMORY.md summarization: compression preserves key facts under threshold
- chokidar: verify watches correct paths, emits on change, ignores non-skill files

---

## 10. Out of Scope (for this phase)

- Skill routing index / progressive disclosure (deferred to Phase C)
- Skill crystallization (post-task extraction → propose tool)
- Integration research → skill pipeline
- Session archive / long-horizon recall
- Langfuse / Promptfoo integration (Phase D)

---

## 11. Dependencies

- `chokidar` (new dev/prod dependency for file watching)
- No changes to Mastra, Pi Agent SDK, or existing DB schema

---

*Self-review: No placeholders. All file paths, function signatures, and behaviors are specified. Type consistency checked. Scope is focused on 4 items. Ready for implementation plan.*
