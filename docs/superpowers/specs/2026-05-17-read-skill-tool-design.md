# Read Skill Tool Design

## Goal

Reduce system prompt size and stop exposing skill file paths in the available-skills prompt block. The prompt should list only skill names and descriptions. Agents should load full skill instructions through a dedicated `read_skill` tool.

## Current State

Skill discovery is centered in `src/main/agent/SkillRouter.ts`. It scans global skills under `~/.scholar/skills` and project skills under `~/.scholar/projects/<slug>/skills`, with later directories overriding earlier ones. `buildSystemContext` injects the router's XML into the system prompt, and the current XML tells agents to use `read_file` against the listed `SKILL.md` path.

Agent tools are registered through `src/main/agent/tools.ts`. Existing skill execution is handled separately by `run_skill_script`, which already captures the project slug in a closure instead of asking the model to pass project identity.

## Proposed Behavior

The system prompt should include an `<available_skills>` block containing only each skill's `name` and `description`. It should instruct the agent to call `read_skill` with the skill name when a task matches a skill description.

`read_skill` accepts one parameter:

```ts
{
  skillName: string;
}
```

It does not accept `projectId` or project slug. The tool is created with the current session's project slug and home path, so project context is implicit and cannot be chosen by the model.

## Resolution Rules

`read_skill` resolves the requested skill in this order:

1. Project skills: `~/.scholar/projects/<slug>/skills`
2. Global skills: `~/.scholar/skills`

Within each scope, a skill matches if either:

- `SKILL.md` frontmatter has `name` equal to `skillName`
- the skill directory name equals `skillName`

Project skills take precedence over global skills on conflict.

Invalid skill names should be rejected before filesystem lookup. Use the existing lowercase slug style: lowercase letters, digits, and hyphens, starting with a letter or digit.

## Return Shape

The tool returns the main `SKILL.md` body without YAML frontmatter, plus recursive metadata for other files in the skill directory.

```ts
interface ReadSkillResult {
  name: string;
  scope: "project" | "global";
  body: string;
  files: Array<{
    name: string; // path relative to the skill directory
    path: string; // absolute path usable with read_file
  }>;
}
```

The recursive file list excludes dotfiles and `SKILL.md`. It includes nested files such as `references/example.md` or `scripts/script.sh`, sorted by relative name for deterministic output.

## Tool Registration

Add `read_skill` to `AgentToolName` and register it in `createAgentTools`. It should be available by default alongside the core file, bash, code, and skill-script tools. If callers pass `toolNames`, existing filtering behavior applies.

Update prompt text in `BASE_SYSTEM_PROMPT` and `buildSystemContext` from reading `SKILL.md` via `read_file` to using `read_skill`.

## Testing

Add focused tests for:

- prompt skill XML contains names/descriptions but no paths
- `read_skill` strips frontmatter from `body`
- project skill wins over global skill with the same name
- directory-name fallback works when frontmatter name is missing or different
- recursive file listing returns relative names and absolute paths
- dotfiles and `SKILL.md` are excluded from `files`
- invalid and missing skill names fail clearly
- `createAgentTools` includes and filters `read_skill`

Run the repository quality checks after implementation:

```bash
bun run typecheck
bun run check
bun run test
bun run test:coverage
```
