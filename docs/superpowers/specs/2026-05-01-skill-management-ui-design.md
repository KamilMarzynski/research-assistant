# Skill Management UI — Design Spec

> Date: 2026-05-01
> Status: Approved

## Summary

Add skill management UI to Settings modal — browse, view, delete, and toggle installed skills. No manual editing (agent-driven only via `propose_tool`).

## Backend

### New IPC channels (`src/shared/ipc-channels.ts`)

| Channel | Direction | Pattern | Payload | Returns |
|---|---|---|---|---|
| `GET_SKILLS` | renderer→main | `invoke` | — | `SkillInfo[]` |
| `TOGGLE_SKILL` | renderer→main | `invoke` | `{ name: string, enabled: boolean }` | — |
| `DELETE_SKILL` | renderer→main | `invoke` | `{ name: string }` | — |

### Shared type (`src/shared/types.ts` or inline)

```ts
interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  content: string;  // full SKILL.md
}
```

### `HomeService` additions

- **`getSkills()`** — reads `~/.research-assistant/skills/` dir, reads each `SKILL.md`, parses frontmatter for name/description, checks for `.disabled` marker file, returns `SkillInfo[]`.
- **`toggleSkill(name, enabled)`** — creates or removes `~/.research-assistant/skills/<name>/.disabled` marker file
- **`deleteSkill(name)`** — `rm -rf ~/.research-assistant/skills/<name>`

### `context.ts` change

`readSkillsFromDir()` in `src/main/agent/context.ts` — skip directories that contain `.disabled` file. This is the only change needed to honor disabled state at runtime.

### IPC handlers

Register `GET_SKILLS`, `TOGGLE_SKILL`, `DELETE_SKILL` in `ipc-handlers.ts`. Reuse existing pattern from pending-tool handlers.

## Frontend

### SettingsModal — 4th tab "Skills"

Add tab index 3 to the existing `Tabs` component. Content:

- **Skill list** — each row shows:
  - Skill name (bold)
  - Description (muted, one line)
  - Enable/disable Switch (right-aligned)
  - Expand icon to view full SKILL.md content
- **Expanded view** — monospace `<pre>` box with full skill content (same style as PendingToolModal)
- **Delete** — icon button on each row, opens confirmation dialog (same pattern as "Clear Audit Log")
- **No Save/Cancel buttons** for this tab — toggle and delete are instant actions

### States

- **Empty state**: "No skills installed. Skills are created when an agent proposes a new tool."
- **Loading**: Skills list has loading skeleton or spinner
- **Error**: Error banner if fetch fails, retry button

## Agent session changes

None. Skills are loaded at session start via `loadSkills()` / `loadSkillsByContent()`. The `.disabled` file check in `readSkillsFromDir()` is the only runtime change — no need to hot-reload skills mid-session.

## Test plan

- HomeService: `getSkills` returns list, `toggleSkill` creates/removes `.disabled`, `deleteSkill` removes dir
- context.ts: `readSkillsFromDir` skips dirs with `.disabled`
- IPC handlers: each new channel handled correctly
- SettingsModal: Skills tab renders list, toggle calls TOGGLE_SKILL, delete shows confirmation then calls DELETE_SKILL
