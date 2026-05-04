# Phase C — Genericness & Self-Evolution Design

> Date: 2026-05-04
> Scope: Phase C (all items) + Path-Jail Allowlist
> Depends on: Phase B (Memory & Skills) — completed 2026-05-03

---

## 1. Executive Summary

Phase C transforms the app from "research assistant with built-in research" to "generic agent platform with research as a pre-installed skill". Four new architectural layers are introduced:

| Component | What It Does |
|---|---|
| **SkillRouter** | Replaces eager skill loading with on-demand routing index (L1 from GenericAgent) |
| **OutputRouter** | Reads AGENTS.md output conventions, routes final research files to project folder |
| **CompressionService** | Intercepts long tool outputs, produces summaries before they enter context |
| **AllowlistService** | Global + per-project + dynamic approval for paths outside PathJail zones |

Research logic moves from hardcoded TypeScript (`builtin-skills.ts`) to filesystem skill (`~/.research-assistant/skills/research/`). The agent can now crystallize successful workflows into reusable skills via `propose_tool` + evaluator gate.

---

## 2. Architecture

### 2.1. Before vs After

```
BEFORE:
  AgentSession → builtin-skills.ts (START_RESEARCH_SKILL string constant)
             → ResearchService.startResearch() [hardcoded]

AFTER:
  AgentSession → SkillRouter.loadIndex() [frontmatter scan, ~100ms]
             → SkillRouter.loadSkill("research") [on demand]
             → start_research tool → ResearchService.startResearch() [dispatcher only]
             → OutputRouter.moveFinals() [AGENTS.md-driven]
```

### 2.2. New Components

```
src/main/agent/
  SkillRouter.ts          ← skill index scan, on-demand loading, hot reload
  OutputRouter.ts         ← AGENTS.md output convention parser, file moves
  CompressionService.ts   ← tool output compression/summarization

src/main/services/
  AllowlistService.ts     ← global + per-project + session allowlists

src/renderer/components/layout/chat/
  PendingPathBanner.tsx   ← mirrors PendingCommandBanner
  PendingPathModal.tsx    ← mirrors PendingCommandModal
```

### 2.3. Data Flow

```
User: "Research LLM memory approaches"
  │
  ▼
AgentSession.send()
  │
  ├─► SkillRouter.loadIndex() ──► reads all SKILL.md frontmatter
  │   returns: <available_skills> index XML
  │
  ├─► Mastra memory ──► compressed summary
  │
  ├─► buildSystemContext() ──► config.md + AGENTS.md + MEMORY.md
  │
  ▼
Agent receives prompt → calls `start_research` tool
  │
  ▼
start_research → ResearchService.startResearch()
  │
  ├─► WorkerAgent loads "research" skill content on demand
  │   (shallow.md or orchestrator.md based on `deep` flag)
  │
  ▼
Research runs in workspace, writes scratch files
  │
  ▼
Research completes → OutputRouter.moveFinals()
  │
  ├─► Reads AGENTS.md "Output location" section
  ├─► Identifies final files (by extension/pattern)
  ├─► Moves finals to output location
  └─► Emits `file:written` events for notifications
  │
  ▼
Evaluator agent assesses novelty → if novel:
  ├─► Proposes skill via `propose_tool`
  ├─► User approves in PendingToolModal
  └─► Skill moves to skills/<name>/, added to index
```

---

## 3. Skill System Redesign

### 3.1. Extract Research to Built-in Skill

Move from `builtin-skills.ts` string constants to filesystem:

```
~/.research-assistant/skills/research/
  SKILL.md              ← trigger description
  shallow.md            ← single-researcher prompt
  orchestrator.md       ← deep research orchestrator prompt
  evaluator.md          ← evaluation criteria + JSON schema
```

`START_RESEARCH_SKILL` in `builtin-skills.ts` → **deleted**.
`ResearchService` stays as **dispatcher only** (creates workers, manages task state). The **prompts** live in skill files.

`start_research` tool implementation stays in TypeScript — it calls `ResearchService` — but the agent's understanding of what research is comes from `SKILL.md`.

### 3.2. Skill Routing Index

Replace eager loading (`loadSkillsByContent`) with lazy loading:

1. **Scan phase (session start):** Read only YAML frontmatter of all `SKILL.md` files. Build `SkillIndex`: `{ name, description, location }[]`. Fast (<100ms, disk only).
2. **Inject phase:** Put only the index into system prompt as `<available_skills>` XML.
3. **Load phase:** When agent calls a tool whose name matches a skill, OR when LLM reasoning references a skill, load full `SKILL.md` + referenced files from disk and inject into that turn's context.

**System prompt size reduction:** From full skill content (can be 5K+ tokens) to ~500 bytes of index.

### 3.3. Hot Reload

File watcher on `~/.research-assistant/skills/` (already partially implemented):
- `chokidar` watches skill directories
- On change → compute content hash diff against manifest
- Inject delta as user-visible message before next turn (already in `AgentSession`)
- Update `SkillIndex` for next session

### 3.4. Skill Crystallization

**Trigger conditions (evaluator decides):**
- Research task completes successfully
- Evaluator assesses: "Was this approach novel, reusable, and >3 tool calls?"
- If yes → agent proposes skill via `propose_tool`

**Proposed skill structure:**
```
pending-tools/gdrive-sync/
  SKILL.md           ← name, description, when-to-use, workflow steps
```

Only `SKILL.md` mandatory. Optional: helper scripts if workflow genuinely needs them.

**User approval:** Existing `PendingToolBanner` + `PendingToolModal` flow. Approve → moves to `skills/gdrive-sync/`. Immediately available via `SkillIndex`.

**Manual trigger:** User says "always do it this way" or `/crystallize` → agent skips evaluator, goes straight to `propose_tool`.

**Skill `SKILL.md` template for crystallized skills:**
```markdown
---
name: gdrive-sync
description: >-
  Use when user wants to save research outputs to Google Drive.
  Requires gdrive API key already configured in environment.
---

# gdrive-sync

## When to use
- User says "save to gdrive" or "upload to drive"
- Research completes and user wants output in Google Drive

## Steps
1. Collect final output files from workspace
2. Use `safe_bash` to run `gdrive upload <file>` (assumes gdrive CLI installed)
3. Confirm upload success to user

## Output
- Files uploaded to user's Google Drive root
- Return shareable links if available
```

---

## 4. File Explorer + Output Router

### 4.1. File Explorer (Right Panel)

Replace `ArtifactSection` + `ArtifactViewer` with filesystem tree view:

```
Project Files
├── 📁 Linked: ~/Projects/my-app/
│   ├── src/
│   ├── docs/
│   └── README.md
└── 📁 Workspace: ~/.research-assistant/workspace/<projectId>/
    └── <taskId>/
        ├── intermediate-data.csv
        └── final-report.md
```

**IPC:**
- `LIST_DIR` (exists) — list directory entries
- `READ_FILE` (exists) — read file content
- New: `GET_FILE_TREE` — recursive walk with:
  - Depth limit: 3
  - Ignore patterns: `.git`, `node_modules`, `.DS_Store`, `__pycache__`
  - Max entries: 1000 per directory
  - All reads through `PathJail`

**Renderer:**
- Tree view component in right panel
- Double-click → opens in Markdown/code viewer (reuse `MarkdownRenderer`)
- `RecentOutputsPanel` stays as "unacknowledged final outputs"

### 4.2. Output Router

**Behavior:**
1. Agent starts research → workspace created at usual location
2. Agent reads AGENTS.md `Output location` on session start (already in `buildSystemContext`)
3. Research completes → `OutputRouter.moveFinals(workspacePath, outputLocation)`:
   - Identifies final files by pattern: `.md`, `.csv`, `.png`, `.py`, `.js`, `.sh`
   - Moves finals to output location
   - Non-final files stay in workspace (intermediates)
4. Emits `file:written` events for notifications

**AGENTS.md output convention format:**
```markdown
## Output location
- Default: ~/Projects/my-app/research/
- Code outputs: ~/Projects/my-app/scripts/
- Reports: ~/Projects/my-app/docs/
```

OutputRouter parses this section and routes files accordingly.

---

## 5. Context Compression

### 5.1. CompressionService

```typescript
interface CompressionRule {
  tool: string;
  thresholdChars: number;
  strategy: "summarize" | "truncate" | "head-only";
}

const DEFAULT_RULES: CompressionRule[] = [
  { tool: "fetch_url", thresholdChars: 8000, strategy: "summarize" },
  { tool: "web_search", thresholdChars: 4000, strategy: "head-only" },
  { tool: "read_file", thresholdChars: 10000, strategy: "summarize" },
];
```

### 5.2. How It Works

1. Tool executes, returns raw output
2. `CompressionService` checks tool name against rules
3. If output > threshold:
   - **summarize** — fast LLM call (`forceCloud: true`, small model) produces 200-word summary
   - **head-only** — keep first N paragraphs, append "[truncated — full content at <path>]"
   - **truncate** — hard cut at threshold, append truncation notice
4. Compressed result returned to agent. Full content saved to `~/.research-assistant/workspace/<projectId>/.compressed/<tool>-<hash>.md`

### 5.3. Agent-Side `compress` Tool

For outputs not covered by automatic rules, agent can call:
```
compress({ path: string, maxWords: number })
```
→ reads file, returns summary. Agent decides when context is too full.

---

## 6. Path-Jail Allowlist

### 6.1. Three-Layer Access Control

1. **Pre-configured allowlists** — paths in AGENTS.md or global config
2. **Dynamic approval** — for unlisted paths, user gets notification
3. **Session persistence** — once approved, stays approved for session

### 6.2. Allowlist Sources

**Global allowlist** (`~/.research-assistant/config.md`):
```markdown
## Allowed paths
- ~/Documents/Research
- ~/Downloads
```

**Per-project allowlist** (AGENTS.md):
```markdown
## Allowed paths
- ~/Projects/shared-libs/
- /tmp/research-data/
```

**App-level allowlist** (hardcoded):
- `/tmp/` — temp files
- `~/.research-assistant/` — app home (already covered)

### 6.3. Dynamic Approval Flow

When agent tries `read_file`/`write_file`/`list_dir` on path outside all zones:

1. `PathJail.validate()` checks allowlists (global + per-project + hardcoded)
2. If not allowed → throws `ApprovalRequiredError` with path + requested mode
3. Tool wrapper catches error, emits `path:approval_required` event via EventBus
4. Renderer shows `PendingPathBanner` (mirrors `PendingCommandBanner`)
5. User options:
   - `approve_once` — this call proceeds
   - `approve_session` — path added to session allowlist
   - `approve_always` — path added to global allowlist in `config.md`
   - `deny` — call rejected, agent gets error
6. `PathJail` session allowlist maintained in-memory per project

### 6.4. Container Integration

`run_in_docker` already isolated — only bind mount is workspace tmp dir. No path-jail needed inside container. Approval flow applies only to host-level file I/O tools.

---

## 7. System Prompt Assembly Order

Precedence (last = highest):

1. Base system prompt
2. Skill index (L1 routing)
3. Loaded skill content (only relevant skills)
4. Mastra memory summary
5. Conversation history
6. `.md` memory (MEMORY.md, app-memory) ← **highest precedence**

If Mastra says "user prefers X" but `.md` says "user prefers Y`, `.md` wins because it appears later.

---

## 8. Testing Strategy

| Component | Test Type | What to Verify |
|---|---|---|
| SkillRouter | Unit | Index scan accuracy, on-demand loading, hot reload |
| OutputRouter | Unit | AGENTS.md parsing, file moves, pattern matching |
| CompressionService | Unit | Threshold logic, strategy selection, summary quality |
| AllowlistService | Unit | Layer resolution, session persistence, global writes |
| PathJail + allowlist | Integration | Dynamic approval flow, IPC round-trip |
| Full research → skill | E2E | Research completes, output routed, skill proposed |
| File explorer | UI | Tree rendering, double-click, PathJail enforcement |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| "Empty platform" — app ships with no built-in capabilities | Research stays built-in skill (not optional). Only integrations become optional skills. |
| Dual memory confusion (Mastra vs .md) | Clear separation: Mastra = implicit conversational; .md = explicit user-reviewable |
| Skill quality pollution | Evaluator gate + `propose_tool` human approval prevents low-quality skills |
| File explorer DoS (massive directory) | Depth limit (3), ignore patterns, 1000-entry cap, pagination |
| Mid-session skill refresh cost | Delta injection as user message (not system prompt mutation). Batched changes. |
| Prompt cache invalidation | Skill index stable prefix; only loaded skill content varies per turn |
| AGENTS.md format drift | Version field in frontmatter (`agents-version: 1`). Parser handles missing fields gracefully. |

---

## 10. Open Questions (Resolved During Brainstorming)

| # | Question | Answer |
|---|---|---|
| 1 | Research output location? | Workspace for scratch, finals to AGENTS.md output location |
| 2 | Skill crystallization trigger? | Smart automatic (evaluator) + manual user trigger |
| 3 | Context compression approach? | Automatic for known long-output tools, agent-side `compress` tool for rest |
| 4 | Memory precedence? | Order-based: `.md` last = wins |
| 5 | Path-jail allowlist scope? | Global + per-project + dynamic approval |
| 6 | Integration → skill pipeline? | Agent autonomous + explicit user request |

---

## 11. Sources

- `04 Resources/AI/Research Assistant - Final Shape Specification & Roadmap.md`
- `04 Resources/AI/GenericAgent vs Research Assistant - Comparison & Path to Genericness.md`
- `04 Resources/Research Assistant/md-memory-patterns.md`
- `04 Resources/Research Assistant/refresh-skills-mid-session.md`
- `05 Archive/Research Assistant - Hermes Agent Safety Analysis.md`
- `05 Archive/Research Assistant - Next Steps Plan.md`
- `05 Archive/Research Assistant - Ollama and Cloud Model Provider Implementation.md`
- `src/main/agent/session.ts` (codebase)
- `src/main/agent/tools.ts` (codebase)
- `src/main/agent/worker-agent.ts` (codebase)
- `src/main/agent/extensions/safe-bash.ts` (codebase)
