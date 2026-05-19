# Research Finisher — Design Spec

**Date:** 2026-05-19  
**Status:** Approved

## Problem

The current `ResearchSummarizerService` is read-only and blind: it can't move files, it can't create index documents, and the code-side `OutputRouter.moveFinals()` moves *everything* in the workspace — including scratch notes and intermediate artefacts. Agents have no way to declare which files are final outputs. The result is indiscriminate file dumping and no agent intelligence at handoff time.

## Goal

Replace the summarizer + code-side file mover with a single **finisher agent** that:
1. Receives the full research output text (which contains a structured `## Handoff` section)
2. Moves only declared output files to `userProjectDir` using `mv` via `safe_bash`
3. Optionally creates an index file when memories or FILES.md suggest it adds value
4. Writes a brief, natural completion message for the user

The pattern is uniform at every nesting depth: every researcher and orchestrator ends with a `## Handoff` section, and the finisher processes the top-level one.

---

## Design

### 1. Naming changes

| Old | New |
|-----|-----|
| `AgentType` `"summarizer"` | `"finisher"` |
| `SummarizeJob` | `FinishJob` |
| `ResearchSummarizerService` | `ResearchFinisherService` |
| `AGENT_TYPE_PRESETS.summarizer` | `AGENT_TYPE_PRESETS.finisher` |
| `summarizerPrompt` | `finisherPrompt` |

### 2. FinishJob shape

```ts
export interface FinishJob {
  projectId: string;
  projectName: string;
  query: string;
  researchOutput: string;   // raw final text from the top-level agent (replaces filePaths)
  taskWorkspacePath: string;
  projectPath: string | null;
  folderPath: string | null;
  slug: string;
  provider: ModelProvider;
  filesMdContent?: string;
}
```

`filePaths` is removed — the finisher agent determines which files to move from the `## Handoff` section in `researchOutput`.

### 3. Prompt changes

#### Researcher prompt — new `## Handoff` instruction

Append to the existing researcher prompt:

> When done, end your response with a `## Handoff` section containing:
> 1. A 1–2 sentence summary of how the research went.
> 2. A `### Output Files` subsection listing the absolute path of every final output file, one per line. Scratch files, intermediate notes, and downloaded sources are **not** output files.

#### Orchestrator prompt — same, aggregated

> When done, end your response with a `## Handoff` section containing:
> 1. A 1–2 sentence summary of the overall research.
> 2. A `### Output Files` subsection listing the union of all output files declared by spawned sub-agents, plus any synthesis file you wrote yourself. One absolute path per line.

#### Finisher prompt (replaces summarizerPrompt)

```
You are the Scholar research finisher. A background research task just completed.

<dirs section>

## Your job

1. Parse the `## Handoff` → `### Output Files` list from the research output.
2. For each declared output file:
   - Use safe_bash to run `mv <source> <dest>` to move it to userProjectDir (or the appropriate subdirectory per FILES.md).
   - Never recreate or copy file content. If mv fails, report the error.
3. Check read_memory and FILES.md for project conventions. If the research produced multiple linked documents, decide whether an index or table-of-contents file adds value. If yes, use write_file to create it.
4. Skim the moved files with read_file to surface 2–3 key findings.
5. Write a brief natural message for the user: what was researched, where files landed, key findings. Under 200 words.

Write ONLY the final message — no preamble, no tool output, no explanation.
```

#### Finisher tool set

`read_file`, `list_dir`, `read_memory`, `safe_bash`, `write_file`

(Up from read-only. `safe_bash` is required for `mv`. `write_file` is required for optional index creation.)

### 4. ResearchService changes

- **Remove** the `OutputRouter.moveFinals()` block after `agent_end` — no more code-side file scanning or moving.
- **Capture** the return value of `run(config.query)` — currently discarded. Pass it as `researchOutput` in `FinishJob`.
- `research:complete` event: `filePaths` field becomes `[]` always (kept for backwards compat with renderer) — meaningful file list is now only available after the finisher completes.

### 5. Event changes

`research:summary_ready` payload gains `movedFiles: string[]`:

```ts
{ type: "research:summary_ready"; payload: { projectId: string; text: string; movedFiles: string[] } }
```

The finisher agent reports moved files so the renderer can surface them.

### 6. Deletions

- `src/main/agent/OutputRouter.ts` — fully replaced by finisher agent behaviour
- `src/main/agent/OutputRouter.test.ts` — no longer needed

---

## Data flow

```
ResearchService
  └─ run(query) → researchOutput (string, contains ## Handoff)
       └─ research:complete emitted (filePaths: [])
       └─ ResearchFinisherService.finish(FinishJob)
            └─ finisher agent
                 ├─ parse ## Handoff → ### Output Files
                 ├─ safe_bash: mv each file to userProjectDir
                 ├─ (optional) write_file: index document
                 ├─ read_file: skim outputs for key findings
                 └─ return user message text
            └─ messageService.addMessage(text)
            └─ eventBus.emit(research:summary_ready, { text, movedFiles })
```

---

## What does NOT change

- `SummaryQueue`, `SummaryStreamCoordinator` — unchanged; still drain the summary queue as streamed IPC chunks
- `SpawnResult` — no structural change; agent-to-agent communication stays plain strings
- `ResearchService._runResearch()` overall shape — only the post-`agent_end` block changes
- All other `AgentType` presets (researcher, coder, orchestrator, evaluator)
