# Phase A — Foundation Design Document

> **Scope**: Per-project AGENTS.md injection + agent-driven output routing + recent outputs notification panel.
> **Direction**: Shift from app-internal storage (workspace + DB artifacts) to filesystem-native workflow in user's linked project folder.
> **Date**: 2026-05-03
> **Status**: Approved

---

## 1. Project Creation Flow

### 1.1. Native Directory Dialog

- `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })`
- User picks or creates a folder. No "skip" button.
- `folderPath` stored in DB (required field from now on).

### 1.2. Onboarding Message

- System detects: new project + `folderPath` set + no AGENTS.md exists.
- Injects into agent prompt:

  > "This project has no AGENTS.md yet. Ask the user to describe: project goal, folder structure, where research outputs go, naming conventions."

- Agent asks user onboarding questions in chat.

### 1.3. AGENTS.md Creation

- Agent writes `~/.research-assistant/projects/<slug>/AGENTS.md` via `write_file` tool.
- Freeform markdown. Agent decides structure and content based on user description.
- May include:
  - Project purpose and scope
  - Folder structure and where things belong
  - Output conventions (where research goes, naming patterns)
  - Key files to know about
  - User preferences for this project

### 1.4. System Prompt Injection

- `buildSystemContext()` always reads AGENTS.md and injects it as an immutable natural-language block.
- Never compacted by Mastra memory.
- Agent can rewrite AGENTS.md anytime via `write_file` if it learns new conventions.

### 1.5. User Describes Structure or Inherits

- User may say: "same structure as [other-project-name]"
- Agent resolves other project by name from DB, reads its AGENTS.md, adapts for new project.

---

## 2. Research Output Routing

### 2.1. Core Principle

Orchestrator/main agent reads AGENTS.md, decides where outputs go, and includes this in the research prompt. `ResearchService` is a task runner, not a decision maker.

### 2.2. Temporary Workspace

- `ResearchService` still creates `~/.research-assistant/workspace/<projectId>/<taskId>/` as a scratchpad for intermediate files, code execution, Docker mounts.
- Agent decides what to keep from scratchpad.
- Old files cleaned by existing 7-day rule.

### 2.3. Agent Decides Output Location

- Research prompt includes output instruction derived from AGENTS.md:

  > "Save final outputs to `docs/research/2026-05-03-topic-name.md` per AGENTS.md conventions."

- No hardcoded artifact path. `ResearchService` does not enforce `output.md`.
- Sub-agent uses `write_file` tool to create whatever files make sense: `.md`, `.csv`, `.py`, `.png`, etc.
- Multiple files allowed.

### 2.4. User-Facing Paths

- No `taskId` in user-facing file names.
- Agent names files meaningfully: `competitor-analysis.md`, `sales-2026-q1.csv`, `architecture-diagram.png`.

### 2.5. Not All Research Produces Files

- Some research returns info directly to chat.
- Agent decides based on prompt whether to create files.

---

## 3. Recent Outputs Notification

### 3.1. Notification Panel

- Right panel shows recent agent-created files in linked folder (last N unacknowledged, max 50).
- Replaces old artifact viewer component.

### 3.2. Auto-Populated

- When sub-agent calls `write_file` in project folder, main process records:
  - `relativePath` (relative to `folderPath`)
  - `timestamp`
  - `type` (from file extension)

### 3.3. Per-Session Grouping

- Files grouped by research turn or agent invocation.

### 3.4. Acknowledge

- Individual or batch dismiss.
- Acknowledged files removed from panel but stay in DB.

### 3.5. Click Action

- `shell.showItemInFolder(fullPath)` opens OS file manager at location.

### 3.6. No File Content Preview

- Deferred to later phase.

---

## 4. Error Handling & Edge Cases

### 4.1. Missing folderPath at Project Creation

- Dialog requires folder selection. If user cancels dialog, project not created.

### 4.2. folderPath Deleted or Moved Externally

- Agent detects on `write_file`: path does not exist. Error surfaces in chat.
- User can relink via project context menu (existing `LINK_FOLDER` flow).

### 4.3. AGENTS.md Corruption or Missing

- If `~/.research-assistant/projects/<slug>/AGENTS.md` missing or unreadable, system injects onboarding prompt (Section 1.2).
- Agent asks user and rewrites AGENTS.md.
- No crash.

### 4.4. Research Writes Outside Project Folder

- `PathJail` blocks writes outside `projectFolder` + workspace. Error returned to agent in chat.

### 4.5. Old Workspace Artifacts Orphaned

- Existing `~/.research-assistant/workspace/<projectId>/` files cleaned by 7-day `cleanupOldWorkspaces`.
- After 7 days, gone.

### 4.6. DB Artifacts Table Migration

- New columns: `acknowledged`, `relativePath`.
- Old `content` column ignored (nullable, never read).
- Migration handled by Drizzle.

---

## 5. Architecture Notes

### 5.1. PathJail Coverage

- `PathJail` already allows reads/writes to `projectFolder`.
- No new security surface for output routing.

### 5.2. IPC Changes

- Remove `READ_ARTIFACT_FILE` handler (or repurpose for file explorer later).
- Add `GET_RECENT_OUTPUTS` for notification panel.
- Keep `ACKNOWLEDGE_OUTPUTS`.

### 5.3. Renderer Changes

- Remove `ArtifactViewer` component.
- Add `RecentOutputsPanel` component.
- No file explorer in this phase.

---

## 6. Deferred (Future Phases)

- File explorer tree view (right panel)
- File content preview on click
- File system watcher (chokidar) for auto-refresh
- Light mode / Ollama UI / cross-platform packaging

---

## 7. Key Principles (Add to CLAUDE.md)

> **LLM-first decision making**: Agents decide file locations, naming, and whether to create outputs. `ResearchService` is a runner, not a router. Hardcode only scratchpad workspace path and safety boundaries.

> **AGENTS.md is the contract**: Freeform markdown written by agent. Guides behavior, output conventions, and project structure. Immutable in system prompt.

> **Filesystem-native over DB-native**: User-facing files live in their project folder. DB stores only notification index, not content.
