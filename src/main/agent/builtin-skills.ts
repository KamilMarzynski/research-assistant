export const START_RESEARCH_SKILL = `---
name: start_research
description: Dispatch a background research task. Use when the user asks for in-depth research that would take more than one exchange to complete.
---

# start_research

Use the \`start_research\` tool to dispatch a background research worker when:
- The user asks to "research", "investigate", "find out about", or "look into" something non-trivial
- The task requires reading multiple files, running scripts, or synthesising across sources
- The research will take more than a quick answer

## Tool signature

\`\`\`
start_research({ query: string })
\`\`\`

- \`query\`: a clear, self-contained research question. Include all necessary context — the worker has no access to the current conversation.

## What happens next

- The tool returns immediately with a \`taskId\`
- A background agent runs the research using \`read_file\`, \`list_dir\`, and \`safe_bash\`
- When done, a summary will be injected into this conversation automatically
- The artifact is saved to the project workspace

## Examples of good queries

- "Summarise the API surface of all TypeScript files in src/main/services/ — list public methods and their signatures"
- "Find all usages of the IProjectRepository interface and list every call site"
- "Read README.md and CLAUDE.md and write a one-page onboarding guide for a new developer"
`;

export const DISCOVER_PROJECT_SKILL = `---
name: discover_project
description: Walk and document a linked project folder. Use automatically when a project has a folderPath but no AGENTS.md exists yet.
---

# discover_project

When a project has a linked folder but \`~/.research-assistant/projects/<slug>/AGENTS.md\` does not exist yet, run project discovery automatically at the start of the first message.

## Discovery steps

1. Call \`list_dir({ path: "<folderPath>" })\` to see top-level structure
2. For each interesting item (README, package.json, CLAUDE.md, AGENTS.md, src/, docs/), call \`read_file\` to understand the project
3. Write \`~/.research-assistant/projects/<slug>/AGENTS.md\` using \`write_file\` with the template below
4. Tell the user: "I've read your project structure and written a context file. Ready to help."

## AGENTS.md template

\`\`\`markdown
# <Project Name> — Agent Context

## What this project is
<one paragraph>

## Folder structure
<bullet list of key dirs/files and their purpose>

## Key files
<list of important files to know>

## Conventions
<naming, code style, any patterns observed>

## Notes
<anything else the agent should know>
\`\`\`

## Slug format

Slug = project name, lowercased, spaces → hyphens, non-alphanumeric stripped.
Example: "My Cool Project!" → "my-cool-project"
`;
