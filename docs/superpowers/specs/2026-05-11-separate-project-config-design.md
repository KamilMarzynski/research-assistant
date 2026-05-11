# Design: Separate Project Config from Linked Folders

## Date
2026-05-11

## Context
The research assistant currently stores project configuration (`AGENTS.md`, `MEMORY.md`, `.scholar/skills`, `.agents/skills`) inside linked project folders. This is wrong because:

1. The linked folders are **scientific projects**, not Claude Code projects. The app should not pollute them.
2. Config and skills should live in one predictable place: `~/.scholar/`.
3. We need two distinct files with different purposes:
   - `GOAL.md` = what this project is about
   - `FILES.md` = how the user organizes files / naming conventions / output conventions

## Directory Structure (After)

```
~/.scholar/
  config.md                          # global user style
  skills/                            # global skills only
  projects/<slug>/
    GOAL.md                          # what project is about
    FILES.md                         # file organization, naming, output conventions
    MEMORY.md                        # project memory
    skills/                          # project-specific skills
  workspace/<projectId>/              # tool scratch space
```

The linked project folder is **never touched by the app**. The agent may still `write_file` there to save research outputs, but no config or metadata is stored inside it.

## Detailed Changes

### 1. `src/main/paths.ts`

Remove:
- `getAgentsHome()`
- `getAgentsPath()`
- `getProjectSkillsPaths()`

Add:
- `getProjectConfigPath(slug: string): string` → `join(getScholarHome(), "projects", slug)`

### 2. `src/main/agent/context.ts` (`buildSystemContext`)

Current behavior: reads `AGENTS.md` from linked folder, falls back to `~/.scholar/projects/<slug>/AGENTS.md`.

New behavior:
- Load `GOAL.md` from `~/.scholar/projects/<slug>/GOAL.md`
- Load `FILES.md` from `~/.scholar/projects/<slug>/FILES.md`
- Load `MEMORY.md` from `~/.scholar/projects/<slug>/MEMORY.md`
- No `folderPath` fallback for any of these
- `folderPath` parameter removed from `buildSystemContext`
- If either `GOAL.md` or `FILES.md` is missing, inject onboarding prompt telling the agent to write both to `~/.scholar/projects/<slug>/`

### 3. `src/main/agent/SkillRouter.ts` (`createDefaultSkillRouter`)

Current: takes `projectFolderPath`, resolves to:
- `~/.agents/skills`
- `~/.scholar/skills`
- `<folderPath>/.agents/skills`
- `<folderPath>/.scholar/skills`

New: takes `projectName` (or slug), resolves to:
- `~/.scholar/skills` (global)
- `~/.scholar/projects/<slug>/skills` (project-local)

Drop `~/.agents` entirely.

### 4. `src/main/agent/path-jail.ts`

Current zones:
- `readWrite`: workspace, projectsDir, projectFolder
- `readOnly`: homeSkills, agentsSkills, projectAgentsSkills, projectHomeSkills

New zones:
- `readWrite`: workspace, projectsDir, projectFolder *(projectFolder stays for write_file output)*
- `readOnly`: homeSkills, projectSkills (`~/.scholar/projects/<slug>/skills`)

Drop:
- `agentsSkills`
- `projectAgentsSkills`
- `projectHomeSkills`

Add:
- `projectSkills = join(projectsDir, "skills")`

### 5. `src/main/services/ProjectService.ts`

`createProject`: remove `mkdir(join(folderPath, ".scholar"))`.

`linkFolder`: remove `mkdir(join(folderPath, ".scholar"))`.

`deleteProject`: remove cleanup of:
- `AGENTS.md` in project folder
- `MEMORY.md` in project folder
- `.scholar` in project folder
- `.agents` in project folder

Keep cleanup of:
- `~/.scholar/workspace/<projectId>`
- `~/.scholar/projects/<slug>`

### 6. `src/main/services/HomeService.ts`

`ensureDirectories`: remove `join(agents, "skills")` from dirs list. Remove `agents` path entirely.

### 7. `src/main/services/ResearchService.ts`

In the `agent_end` handler:
- Read `FILES.md` from `~/.scholar/projects/<slug>/FILES.md` only
- No project folder fallback
- Pass content to `OutputRouter.parseConventions` as before

### 8. `src/main/ipc/artifact-handlers.ts`

In `GET_FILE_TREE`, remove the dot-file exception that allowed `.scholar` and `.agents` to appear in the tree:

```typescript
// REMOVE:
if (
  entry.name.startsWith(".") &&
  !entry.name.startsWith(".scholar") &&
  !entry.name.startsWith(".agents")
) {
  continue;
}
```

Replace with simple "skip all dot files" logic:
```typescript
if (entry.name.startsWith(".")) continue;
```

### 9. `src/main/agent/OutputRouter.ts`

Keep `parseConventions` and `moveFinals` unchanged. The caller passes `FILES.md` content instead of `AGENTS.md` content. The `"## Output location"` section syntax stays the same.

### 10. Onboarding (`builtin-skills.ts` + `context.ts`)

Current onboarding prompt tells agent to write `AGENTS.md` with 4 questions combined into one file.

New onboarding prompt:
- Tells agent to write **two** files:
  - `GOAL.md` = what this project is about
  - `FILES.md` = how files are organized, naming conventions, output locations
- Files go to `~/.scholar/projects/<slug>/` via `write_file`
- First-run global setup still writes `config.md` to `~/.scholar/config.md`

### 11. `src/main/agent/session.ts`

- `buildSystemContext` call: remove `folderPath` parameter
- `createDefaultSkillRouter` call: pass `projectName` instead of `folderPath`

## Test Updates

| Test file | Changes |
|---|---|
| `context.test.ts` | Remove `folderPath` cases. Mock `~/.scholar/projects/<slug>/GOAL.md` and `FILES.md`. Add `GOAL.md` loading test. |
| `path-jail.test.ts` | Remove `.agents`/`.scholar` subdir tests. Add `~/.scholar/projects/<slug>/skills` as readOnly. |
| `ProjectService.test.ts` | Remove project-folder cleanup assertions. |
| `HomeService.test.ts` | Remove `~/.agents` assertions. |
| `OutputRouter.test.ts` | Rename `AGENTS.md` → `FILES.md` in test content strings. |
| `session.test.ts` | Update mocks for new `buildSystemContext` and `createDefaultSkillRouter` signatures. |
| `tools.test.ts` | Update workspace path assertions if needed. |

## Edge Cases

1. **Project with no linked folder**: still gets `~/.scholar/projects/<slug>/` with all config.
2. **Project rename**: slug changes. Existing `~/.scholar/projects/<old-slug>/` stays until manual cleanup. Acceptable — rename is rare.
3. **Research output when no linked folder**: `OutputRouter.moveFinals` falls back to `~/.scholar/projects/<slug>/` as default if no `folderPath`.

## Migration Notes

This is a clean break (no migration). Any existing `AGENTS.md` or `MEMORY.md` in linked project folders will be ignored. The agent will recreate config in `~/.scholar/projects/<slug>/` on first interaction.
