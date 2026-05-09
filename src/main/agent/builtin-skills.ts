export type BuiltinSkill = Record<string, string>;

export const FIRST_RUN_SKILL = `You are setting up for first use. Ask the user these questions one at a time. Do not ask all at once.
1. How do you organise your projects? (e.g. folder per project, by topic, other)
2. Do you use a note-taking app or work with plain folders?
3. What file types do you mainly work with?
4. Any naming conventions or folder structures you always follow?

If the user's setup is complex (e.g. cloud sync, LaTeX pipelines, custom tooling, multiple workspaces), start a research task with start_research to understand their full workflow before writing config.md. Do not guess — research it.

After receiving all answers (or after the research completes), write a concise summary to ~/.research-assistant/config.md (plain Markdown, human-editable). Then confirm setup is complete.`;

export const EVALUATE_RESEARCH_SKILL: BuiltinSkill = {
  "SKILL.md": `---
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
`,
};

export const RESEARCH_SKILL: BuiltinSkill = {
  "SKILL.md": `---
name: research
description: >-
  Dispatch background research tasks. Use when the user asks to research, investigate,
  find out about, or look into something non-trivial. Set deep=true for complex multi-source
  research that benefits from parallel subtopic investigation, code execution, or hierarchical
  orchestration.
---

# research

## Tool signature

\`\`\`
start_research({ query: string, deep?: boolean })
\`\`\`

- \`query\`: a clear, self-contained research question. Include all necessary context.
- \`deep\`: set to \`true\` for complex multi-source research. Defaults to \`false\`.

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
`,
  "evaluator.md": `# Research Evaluator

You are a research evaluator. Read the file at the given path, assess it against the criteria, and respond with ONLY a JSON object in this exact format:

\`\`\`json
{
  "pass": true,
  "criteria": [
    { "name": "criterion name", "pass": true, "rationale": "one sentence" }
  ]
}
\`\`\`

## Evaluation criteria

- **Completeness**: does the document address the research question fully?
- **Evidence**: are claims supported by sources or tool outputs?
- **Structure**: is the document organised with clear headings and sections?
- **Actionability**: are findings concrete and useful to the requester?
- **Novelty**: is the approach or finding something that could be reused as a skill?
`,
  "orchestrator.md": `# Orchestrated Research

You are a top-level research orchestrator. Plan and execute a thorough research strategy for the given query.
Write intermediate results to subdirectories within your workspace root.
Create final output files in the project folder using write_file, not in the workspace.
Name files meaningfully (no task IDs in filenames).
Use save_artifact to persist valuable outputs — both intermediate and final.
`,
  "shallow.md": `# Shallow Research

You are a background researcher. Investigate the given query thoroughly using the available tools.
Create final output files in the project folder using write_file, not in the workspace.
Name files meaningfully (no task IDs in filenames).
Be thorough. When done, respond with a final summary of your findings.
`,
};

export const BUILTIN_SKILLS: Record<string, BuiltinSkill> = {
  "evaluate-research": EVALUATE_RESEARCH_SKILL,
  research: RESEARCH_SKILL,
};
