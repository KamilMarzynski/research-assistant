# Project Slug + Workspace Relocation Design

## Problem

- Project directories use random UUIDs: `~/.scholar/projects/<uuid>/` — unreadable, hard to navigate.
- Agent workspace is flat: `~/.scholar/workspace/<uuid>/` — separated from project files, no logical grouping.

## Goal

- Project dirs use readable slugs: `~/.scholar/projects/<slug>/`
- Agent workspace lives inside project tree: `~/.scholar/projects/<slug>/workspace/`
- No migration — existing projects can be discarded (WIP app).

## Architecture

### Slug Generation

Derive slug from project name at creation time:

```
ai-safety-research-a7f3k2
```

- Base: project name lowercased, stripped of non-alphanum, spaces → hyphens
- Suffix: 6-char alphanumeric hash truncated from project UUID
- Guarantees uniqueness (UUID suffix), stays readable

Store slug as new column `slug` on `projects` table. UUID remains primary key.

### Directory Structure

```
~/.scholar/
├── projects/
│   └── <slug>/
│       ├── AGENTS.md          (project-level instructions)
│       ├── MEMORY.md          (project-level memory)
│       ├── FILES.md           (project-level file index)
│       ├── skills/            (project-level skills)
│       └── workspace/         (agent scratch space)
│           ├── .compressed/   (compression cache)
│           └── <future: task- dirs>
├── skills/                    (global skills)
├── tasks/                     (persisted research tasks)
├── pending-tools/             (skills awaiting approval)
├── app-memory/                (app-level memory files)
├── config.md                  (user preferences)
└── skills_manifest.json
```

### Service Changes

| Service | Change |
|---|---|
| `ProjectService` | Generate slug on `createProject()`. Pass slug to `HomeService` for dir creation. Store slug in DB. |
| `HomeService` | `ensureWorkspaceForProject(projectId, slug)` → creates `projects/<slug>/workspace/`. Remove old `workspace/<uuid>/` logic. |
| `PathJail` | Accept `slug` instead of `projectId` for workspace path. Read/write zones updated. |
| `tools.ts` | `workspacePath` derived from slug. `safe_bash` cwd = `projects/<slug>/workspace/`. |
| `SettingsService` | `getProjectPath(projectId)` returns path from DB (which is `projects/<slug>/`). |

### Path Helpers (paths.ts)

```typescript
export function getProjectPath(slug: string): string {
  return join(getHomePath(), "projects", slug);
}

export function getWorkspacePath(slug: string): string {
  return join(getProjectPath(slug), "workspace");
}
```

### Slug Collision

Impossible in practice (UUID suffix). On collision → append `-1`, `-2`, etc.

### Future Task Nesting (deferred)

When tasks are introduced, workspace will nest:

```
projects/<slug>/workspace/
├── default/
└── task-<taskId>/
```

For now, all agent work goes into `workspace/` directly.

## Testing

- `ProjectService.createProject` generates valid slug.
- `HomeService.ensureWorkspaceForProject` creates correct directory.
- `PathJail` allows reads/writes inside `projects/<slug>/workspace/`.
- `safe_bash` runs with correct cwd.

## Migration

None. Delete existing projects. Schema migration adds `slug` column to `projects` table.

## Open Questions

- Should `toSlug()` in `context.ts` be moved to shared utility and reused? Yes.
- Should project display name change update slug? No — slug is stable after creation.
