export const START_RESEARCH_SKILL = `---
name: start_research
description: Dispatch a background research task. Use when the user asks for research, investigation, or in-depth analysis.
---

# start_research

Use the \`start_research\` tool to dispatch a background research worker when:
- The user asks to "research", "investigate", "find out about", or "look into" something non-trivial
- The task requires reading multiple files, running scripts, or synthesising across sources
- The research will take more than a quick answer

## Tool signature

\`\`\`
start_research({ query: string, deep?: boolean })
\`\`\`

- \`query\`: a clear, self-contained research question. Include all necessary context — the worker has no access to the current conversation.
- \`deep\`: set to \`true\` for complex multi-source research that benefits from parallel subtopic investigation, code execution, or hierarchical orchestration. Defaults to \`false\` (single researcher).

## When to set deep: true

- Query requires researching multiple independent subtopics in parallel
- Query involves processing data files (CSV, JSON, etc.) with code
- Query requires fetching and analysing papers, articles, or web pages
- Query is open-ended enough that an orchestrator should plan the approach

## What happens next

- The tool returns immediately with a \`taskId\`
- A background agent runs the research using the available tools
- When done, a summary will be injected into this conversation automatically
- Artifacts are saved to the project workspace

## Examples

Standard research (deep: false or omitted):
- "Summarise the API surface of all TypeScript files in src/main/services/"
- "Find all usages of the IProjectRepository interface"

Deep research (deep: true):
- "Research the latest approaches to LLM memory management — check academic papers and GitHub repos"
- "Analyse the CSV at ~/data/sales.csv and produce a trend report"
- "Compare the top 5 vector databases for production use — benchmark if possible"

## Web Access

Your researcher agents have two web access tools:

- **fetch_url** — fetch a specific web page and get clean Markdown content
- **web_search** — search DuckDuckGo for relevant pages

Use these when the research requires:
- Reading documentation, papers, articles, or blog posts
- Finding current information not in the project files
- Comparing approaches from external sources

**Note:** safe_bash still blocks curl and wget. Use fetch_url instead.
`;

export const DISCOVER_PROJECT_SKILL = `---
name: discover_project
description: Walk and document a linked project folder. Use when a project has a folderPath but no AGENTS.md exists yet, or when the user asks you to analyze their project structure.
---

# discover_project

When a project has a linked folder but \`~/.research-assistant/projects/<slug>/AGENTS.md\` does not exist yet, run project discovery automatically at the start of the first message.

## Discovery steps

1. Call \`list_dir({ path: "<folderPath>" })\` to see top-level structure
2. For each interesting item (README, package.json, CLAUDE.md, AGENTS.md, src/, docs/), call \`read_file\` to understand the project
3. Write the AGENTS.md file using \`write_file\`:
   - If the project has a linked folder, write to \`<folderPath>/AGENTS.md\` (preferred location)
   - Otherwise, write to \`~/.research-assistant/projects/<slug>/AGENTS.md\`
   Use the template below.
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

## Output location
<where research outputs and artifacts should be saved>

## Notes
<anything else the agent should know>
\`\`\`

## Slug format

Slug = project name, lowercased, spaces → hyphens, non-alphanumeric stripped.
Example: "My Cool Project!" → "my-cool-project"
`;

export const FIRST_RUN_SKILL = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?
After receiving all answers, write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;

export const EVALUATE_RESEARCH_SKILL = `---
name: evaluate-research
description: Evaluate the completeness and quality of a research output file. Respond with JSON only.
---

# evaluate-research

You are a research evaluator. When invoked:

1. Read the file at the path provided using \`read_file\`
2. Assess it against each criterion listed
3. Respond with **only** a JSON object in this exact format — no preamble, no explanation:

\`\`\`json
{
  "pass": true,
  "criteria": [
    { "name": "criterion name", "pass": true, "rationale": "one sentence" }
  ]
}
\`\`\`

## Evaluation criteria for research outputs

- **Completeness**: does the document address the research question fully?
- **Evidence**: are claims supported by sources or tool outputs?
- **Structure**: is the document organised with clear headings and sections?
- **Actionability**: are findings concrete and useful to the requester?

Apply any additional criteria passed to you in the prompt.
`;
