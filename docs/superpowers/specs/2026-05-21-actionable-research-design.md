# Actionable Research — Design Spec

**Date:** 2026-05-21
**Status:** Draft

## Problem

Today the research flow treats research output as a terminal markdown artifact. The system has no path from "user implies a durable change to how the project works" → "research finds the right answer" → "system mutates itself accordingly".

Concretely:
- `BASE_SYSTEM_PROMPT` (`src/main/agent/prompts.ts:179`) only mentions skill **creation**, never update. FILES.md and GOAL.md are framed as static reference, never as mutable surfaces.
- `start_research({ query, deep })` carries no structure. Coordinator's understanding of user intent is lost the moment it calls the tool.
- `researcherPrompt` hardcodes a lit-review methodology unsuitable for tool-selection, convention changes, or integration setup.
- `### Output Files` handoff only lists artifacts. There is no signal for persistent system changes the researcher made (skill writes, FILES.md updates).
- `ResearchFinisherService` only does `mv` + summary. It cannot enforce the user's actual delivery contract (format, location, naming) from FILES.md.
- `FIRST_RUN_SKILL` exists as a separate code path for setup. Conceptually redundant — empty FILES.md/GOAL.md is just one possible project state.

Result: when a user says "from now on all outputs in this project should be PDF", today's system either produces one ad-hoc markdown summary or improvises an inline pandoc call. Neither updates FILES.md, neither produces a reusable md-to-pdf skill, neither makes the next research run conform automatically.

## Goal

Make the research pipeline express, decide, and apply persistent system changes — generically, without locking the action space to a fixed enum.

Two complementary boundaries:

1. **Input is expressive, structured.** Coordinator builds a `<research_brief>` XML chunk that names user intent, durability, expected outcomes, success criteria, existing state to consult, constraints, and out-of-scope. Code does not parse the brief — it is forwarded verbatim to the researcher prompt.
2. **Action surface is the file system.** Researcher uses `write_file` for every persistent change (artifacts, skills, FILES.md, GOAL.md, integration helpers). Path-jail enforces approval. No typed action vocabulary in code.

Plus a responsibility split:

3. **Researcher = brain.** Produces content. Mutates skills / FILES.md / GOAL.md. Best-effort on format/location.
4. **Finisher = hands-and-eyes on delivery.** Enforces FILES.md as the delivery contract. Uses conversion skills (e.g. md-to-pdf) to land final shape. Idempotent — if researcher already produced correct delivery, no action. Never mutates persistent surfaces (skills, FILES.md, GOAL.md, config.md).

## Non-goals

- In-flight scale escalation (single researcher dynamically becoming an orchestrator).
- Filesystem snapshot diffing for defense-in-depth against undeclared writes.
- Code-level hard block on finisher mutating persistent surfaces (prompt-only for v1).
- Skill versioning or rollback UI.
- Brief XML validation in code.
- Built-in format conversion skills (md-to-pdf etc.) — emerge from real user requests.

---

## Design

### 1. Research brief schema

The brief is an XML chunk with eight required tags. Required = always present; content may be empty string. Coordinator constructs it before calling `start_research` and passes it as a single string field. Code does not parse it.

```xml
<research_brief>
  <user_request>{verbatim user message that triggered research}</user_request>
  <coordinator_read>{1-2 sentences: what coordinator believes user wants long-term}</coordinator_read>
  <durability>one_shot | persistent</durability>
  <expected_outcomes>
    {free text: what shape the result takes — answer in chat, pdf in reports/,
     new skill, FILES.md update, integration setup. May list several.}
  </expected_outcomes>
  <success_criteria>
    {bullet list: how finisher decides done}
  </success_criteria>
  <existing_state_to_consult>
    {list of files / skill-index queries researcher must read before mutating —
     enforces update-over-create. E.g.: "FILES.md", "list_skills + read_skill
     on any md→pdf-related skill"}
  </existing_state_to_consult>
  <constraints>
    {free text: methodology hints, format preferences, secret-storage rules,
     "prefer update over create" reminders}
  </constraints>
  <out_of_scope>
    {free text: explicit do-not-touch list — prevents drift into adjacent work}
  </out_of_scope>
</research_brief>
```

`<durability>` is the only enum: `one_shot` or `persistent`. Determined by coordinator from cue words in the user message (`always`, `from now on`, `for this project`, `default to`, `every time`, `stop doing X`, `switch to Y`, `make it so`). When the cue is faint, coordinator asks the user before classifying.

### 2. Coordinator (`BASE_SYSTEM_PROMPT`) changes

`src/main/agent/prompts.ts:179-217`. Three blocks replaced.

#### Replace `## When to call start_research` (L181-189)

```
## When to call start_research

- The user asks about files, documents, project structure, or topics
- The request requires current data, web sources, or external verification
- The answer requires multiple steps or sources to be accurate
- You are not fully certain
- The topic may have changed since your training data
- The user implies a persistent system change (see "Detecting persistent intent")

Even simple persistent-intent requests warrant research:
"always output as pdf" sounds trivial but requires checking if a
md-to-pdf skill exists, picking a converter, updating FILES.md, etc.

Pass the brief as the `brief` field of start_research. Set deep=true
when the brief implies multi-source or parallel work; deep=false
otherwise. Default to false when unsure.
```

#### Replace `## Skills` + `## Skill creation` (L191-201)

```
## Persistent system changes — core idea

This assistant grows by writing files. Research may produce not only
artifacts for the user, but persistent changes to the assistant itself:
- skills at ~/.scholar/skills/<name>/SKILL.md (global)
- skills at <assistantProjectSkillsDir>/<name>/SKILL.md (project-scoped)
- FILES.md (output routing) at <assistantProjectDir>/FILES.md
- GOAL.md (project intent) at <assistantProjectDir>/GOAL.md
- config.md (global user prefs) at ~/.scholar/config.md
- integration helpers (credentials paths, connector skills)

Every file write to these locations is a persistent system change.
Path-jail will ask the user to approve each write at write time.

## Detecting persistent intent

Phrases that imply persistent change:
  "always", "from now on", "for this project", "default to",
  "every time", "stop doing X", "switch to Y", "make it so"

When you detect such a cue, the research brief MUST set
<durability>persistent</durability> and list the surfaces the
researcher should consider mutating in <expected_outcomes>.

When the cue is faint, ask the user before classifying as persistent.
A wrong persistent classification leads to silent system mutation —
worse than asking one extra question.

## Building the research brief

Before calling start_research, construct a <research_brief> with all
eight required tags. Empty content is OK; missing tags is not.
The researcher uses these tags to choose methodology and scope.
```

#### Replace `## Output conventions` (L208-212)

```
## Output conventions are mutable

FILES.md and GOAL.md are not constants. If research shows these should
change, the researcher will write the updated version directly with
write_file (path-jail will gate). Reading them is good. Updating them
is core to how this app learns the user.
```

### 3. `start_research` tool signature

`src/main/agent/tools/research-tools.ts:28-38` rewritten.

```ts
const startResearchParameters = Type.Object({
  brief: Type.String({
    description:
      "A <research_brief> XML chunk built by the coordinator. Must contain all required tags. Forwarded verbatim to the research worker.",
  }),
  deep: Type.Optional(
    Type.Boolean({
      description:
        "true → orchestrator with parallel subtasks. false → single researcher. Default false.",
    }),
  ),
});

export function createStartResearchTool(
  startResearchFn: (brief: string, deep?: boolean) => Promise<{ taskId: string }>,
): AgentTool<typeof startResearchParameters, { taskId: string }> {
  // body unchanged except brief replaces query
}
```

Plumbing: `ResearchService.startResearch(brief, deep)` carries the brief through to where `researcherPrompt` / `orchestratorPrompt` are built. The brief travels coordinator → tool → service → worker prompt as one opaque string.

### 4. Researcher prompt

`src/main/agent/prompts.ts:46-94` (function `researcherPrompt`) rewritten.

```
You are a background researcher.

## Research Brief
{verbatim XML brief}

## Directories
{dirSection}

## Mutable surfaces — you may write to these as persistent system changes

- ~/.scholar/skills/<name>/SKILL.md           — global capabilities
- {assistantProjectSkillsDir}/<name>/SKILL.md — project-scoped capabilities
- {assistantProjectDir}/FILES.md              — output routing for this project
- {assistantProjectDir}/GOAL.md               — project intent
- ~/.scholar/config.md                        — global user preferences
- {userProjectDir}/<anything>                 — research artifacts

Each write here is a persistent system change. Path-jail will ask the user
to approve. Treat as you would a code commit, not a scratch file.

## Update over create

Before creating a new skill, you MUST:
  1. call list_skills to see existing skills
  2. read_skill on any name-similar or topic-similar candidate
  3. if any match within reason — update its body via write_file; do NOT create a sibling
  4. only create new when no reasonable match exists
  5. justify your choice in the handoff Summary

The same principle applies to FILES.md and GOAL.md: read before write,
update existing content rather than appending or replacing wholesale.

## Every user request can mutate FILES.md and GOAL.md

If the brief's <durability> is persistent OR <expected_outcomes> implies
convention change, you MUST read FILES.md/GOAL.md first, then write_file
the updated version. Silently producing a one-off output when the brief
implied a rule is wrong.

## Approach

Choose methodology based on brief.<expected_outcomes> and <constraints>:
- factual external claims  → search broadly, cite primary sources
- internal tool/skill pick → enumerate options, probe via execute_code, choose
- convention change        → read existing FILES.md/GOAL.md/skills, write updated content
- integration setup        → probe auth flow, draft skill that calls it, document secrets path
Mixed outcomes → mix approaches.

## Format and delivery

Work in whatever format suits the research — markdown for prose, scripts
for code, jsonl for data. You may best-effort write the final artifact
in the format FILES.md requests, but you are not required to.
A finisher agent runs after you and enforces FILES.md conformance using
conversion skills.

Therefore: prioritize content correctness over final format.
If converting would distract from the research, leave conversion to the finisher.

## Scale autonomy

You are running as a single researcher. If you discover the brief implies
independent parallel subtopics, note this in the handoff Summary — do not
spawn children. The coordinator may rerun as deep=true if appropriate.

## Handoff (REQUIRED)

End your response with a `## Handoff` section:

### Summary
Free prose. Cover:
  - what you found
  - methodology you chose and why
  - for any persistent change: justification (especially skill update vs create)
  - one-line self-check against each <success_criteria> item: pass / fail / unknown + evidence

### Files changed
List every path you wrote to during this run, one per line, absolute paths.
Include scratch, artifacts, skills, FILES.md, GOAL.md, integrations.
The finisher will categorize. If you wrote nothing, write "(none)".
```

### 5. Orchestrator prompt

`src/main/agent/prompts.ts:96-134` (function `orchestratorPrompt`) gets the same shape as researcher with three diffs:

**Scale autonomy block flipped:**

```
You are running as an orchestrator. You may spawn parallel or sequential
sub-researchers via spawn_agents_parallel / spawn_agent. If a brief turns
out trivial, just answer without spawning. Always justify chosen scale
in the handoff Summary.
```

**Sub-briefs to children:** parent constructs a narrower `<research_brief>` per child, narrowing `<expected_outcomes>` and `<success_criteria>` to the child's slice. Children see the same prompt structure as a top-level researcher. The brief shape is uniform across nesting depth.

**Handoff aggregation:**

```
### Files changed
Take the union of all `### Files changed` lists from spawned agents,
plus any file you wrote yourself. Dedup by absolute path. One per line.
```

### 6. Finisher prompt and tool scope

`src/main/agent/prompts.ts:157-177` (function `finisherPrompt`) rewritten.

```
You are a research finisher.

A research run just completed. Your job is two things:
  1. Deliver the user-facing artifacts in the shape FILES.md specifies
  2. Report what happened — including any persistent system changes the
     researcher made

## Directories
{dirSection}

## Delivery contract — FILES.md
{filesMdContent or "(none — write to userProjectDir, descriptive filenames)"}

## What you own
- Final format of user-facing artifacts (use conversion skills as needed)
- Final location of user-facing artifacts (respect FILES.md)
- Final naming of user-facing artifacts (respect FILES.md)
- The user-facing summary message

## What you do NOT touch
- ~/.scholar/skills/, {assistantProjectSkillsDir}/  (skill bodies)
- {assistantProjectDir}/FILES.md
- {assistantProjectDir}/GOAL.md
- ~/.scholar/config.md
- Any file listed under <existing_state_to_consult> that researcher already wrote to

The researcher already wrote those. Your job is to surface them to the
user, not edit them.

## Idempotency

If the researcher already produced a file in the right format, in the
right location, with the right name — no action. Just acknowledge it.
Do not overwrite correct work.

## Workflow

1. Parse `### Files changed` from research output
2. Read brief (forwarded as <research_brief> below) to know success criteria
3. For each declared file:
     - read it
     - categorize: artifact / skill / FILES.md / GOAL.md / config / integration / scratch
     - if artifact and not yet matching FILES.md:
         - decide what transformation is needed (location, format, name)
         - if format conversion needed: list_skills → find a converter
           (e.g. md-to-pdf) → read_skill → execute_code to run it
         - if no skill exists for the needed conversion: surface the gap
           in your message — do NOT improvise heavy logic
4. Verify final delivery against <success_criteria>
5. Write user-facing summary

## Research Brief (forwarded from coordinator)
{verbatim XML brief}

## Tools
read_file, list_dir, read_memory, list_skills, read_skill,
execute_code (running conversion skills),
write_file (artifacts only — path-jail blocks writes to skill dirs and
  config.md with an approval popup; FILES.md/GOAL.md are technically
  reachable but you MUST NOT touch them per "What you do NOT touch" above),
safe_bash (mv / rename / lightweight scripting only — no inline conversion)

## Output

Plain message to user. Under 200 words. Cover:
  - 2-3 concrete findings from the research itself
  - persistent system changes the researcher made (one bullet per change)
    e.g. "Updated FILES.md to require pdf for all outputs"
         "Created new skill md-to-pdf (~/.scholar/skills/md-to-pdf/)"
  - artifacts delivered (final paths + format)
  - any success_criteria that did NOT pass + why
  - any gap you couldn't fix (missing converter skill, FILES.md ambiguity)

Write ONLY the final message — no preamble, no tool output, no XML.
```

**Tool set change:** finisher preset in `AGENT_TYPE_PRESETS.finisher` (`src/main/agent/worker-agent.ts`) gains `list_skills`, `read_skill`, `execute_code`. Existing tools (`read_file`, `list_dir`, `read_memory`, `safe_bash`, `write_file`) stay.

**Hard boundary enforcement:** prompt-only for v1. Path-jail already blocks finisher writes to `homeSkills` (approval popup). `assistantProjectDir` writes are technically reachable via `readWriteZones` — relying on the prompt's "do NOT touch" list to keep finisher disciplined. If drift observed in practice, add a finisher-mode flag to `PathJail` later.

### 7. `ResearchFinisherService` changes

`src/main/services/ResearchFinisherService.ts`:

- Rename `parseOutputFiles` → `parseFilesChanged`. Logic unchanged; heading changes from `### Output Files` to `### Files changed`.
- Add `brief: string` field to `FinishJob` interface. Plumb from `ResearchService` (where the brief is in scope at research kickoff).
- Pass brief into finisher prompt builder so the prompt can include it under `## Research Brief (forwarded from coordinator)`.
- No structural change to queue / event flow.

### 8. First-run handling — kill `FIRST_RUN_SKILL`

`src/main/agent/builtin-skills.ts:3-44` (`FIRST_RUN_SKILL`) deleted.

`src/main/agent/system-prompt-builder.ts:9` loses the `isFirstRun` branch — single `basePrompt` path. `SystemPromptContext` loses `firstRunPrompt` and `isFirstRun` fields.

`src/main/agent/MessagePipeline.ts:96` drops `firstRunPrompt: FIRST_RUN_SKILL` from the prompt-builder call.

`src/main/agent/context.ts:120-127` (the "missing project configuration" hint) is sharpened so coordinator handles setup via the same brief flow as any other persistent change:

```
This project has no GOAL.md or FILES.md yet. Ask the user the questions
below, then construct a research_brief with <durability>persistent</durability>
and <expected_outcomes> covering GOAL.md and FILES.md creation. Pass the
brief to start_research even though it is a setup task — researcher will
write the files following the same approval flow as any other persistent
change.

Questions to gather:
1. What is this project about? (for GOAL.md)
2. Where should research outputs go? (for FILES.md)
3. What file types do you mainly work with? (for FILES.md)
4. Any naming conventions or folder structures? (for FILES.md)
5. Detailed reports or concise summaries? (for config.md)
6. Frequently used tools or workflows? (for config.md)
```

Setup becomes one path: persistent research over empty project state.

### 9. Migration — none required

- Existing `GOAL.md` / `FILES.md` format unchanged.
- Existing skills in `~/.scholar/skills/` discoverable via `list_skills`, eligible for update-over-create.
- Existing tasks persisted with `query: string` stay readable; new tasks add `brief: string`. Both fields kept on the persisted task record for back-compat.

---

## Data flow

```
User: "from now on, all outputs in this project should be PDF"
  │
  ▼
Coordinator (main chat agent)
  ├─ detects "from now on" → durability = persistent
  ├─ builds <research_brief> with:
  │   - durability=persistent
  │   - expected_outcomes: update FILES.md to require pdf; ensure md-to-pdf skill exists
  │   - existing_state_to_consult: FILES.md, list_skills for converters
  │   - constraints: prefer update over create
  └─ calls start_research({ brief, deep=false })
  │
  ▼
ResearchService.startResearch(brief, deep=false)
  └─ spawns single researcher worker with researcherPrompt(brief)
  │
  ▼
Researcher
  ├─ reads FILES.md → no pdf rule today
  ├─ list_skills → no md-to-pdf
  ├─ enumerates converters (pandoc vs wkhtmltopdf vs weasyprint)
  ├─ probes via execute_code → pandoc wins
  ├─ write_file ~/.scholar/skills/md-to-pdf/SKILL.md (path-jail approval popup)
  ├─ write_file {assistantProjectDir}/FILES.md (path-jail allowed)
  └─ handoff:
       ## Handoff
       ### Summary
       Picked pandoc for md→pdf. Created skill, updated FILES.md to require pdf.
       success_criteria self-check:
         - FILES.md says pdf-only: pass (rewrote Output locations block)
         - md-to-pdf skill exists: pass (created ~/.scholar/skills/md-to-pdf/)
       ### Files changed
       /Users/.../.scholar/skills/md-to-pdf/SKILL.md
       /Users/.../.scholar/projects/<slug>/FILES.md
  │
  ▼
ResearchFinisherService.finish(FinishJob with brief + researchOutput)
  └─ finisher worker
       ├─ parses ### Files changed
       ├─ categorizes: 1 skill, 1 config — both persistent surfaces, NO touch
       ├─ no user-facing artifacts to deliver this run
       └─ writes message:
            "Set up PDF-only outputs for this project.
             - Updated FILES.md to require pdf for all outputs
             - Created new skill md-to-pdf at ~/.scholar/skills/md-to-pdf/
             Next research run will produce PDFs automatically."
```

---

## File-by-file change list

| File | Change |
|---|---|
| `src/main/agent/prompts.ts` | Rewrite `BASE_SYSTEM_PROMPT`, `researcherPrompt`, `orchestratorPrompt`, `finisherPrompt` per sections 2/4/5/6 |
| `src/main/agent/tools/research-tools.ts` | Replace `query` with `brief` in tool params; rename callback param |
| `src/main/services/ResearchService.ts` | Plumb `brief` instead of `query` to worker setup; persist brief in task record |
| `src/main/services/ResearchFinisherService.ts` | Rename `parseOutputFiles` → `parseFilesChanged`; add `brief` to `FinishJob`; pass brief to finisher prompt |
| `src/main/agent/worker-agent.ts` | Update `AGENT_TYPE_PRESETS.finisher` to add `list_skills`, `read_skill`, `execute_code` tools |
| `src/main/agent/builtin-skills.ts` | Delete `FIRST_RUN_SKILL` constant |
| `src/main/agent/system-prompt-builder.ts` | Remove `firstRunPrompt` and `isFirstRun` from `SystemPromptContext`; single-path builder |
| `src/main/agent/MessagePipeline.ts` | Drop `firstRunPrompt` and first-run detection from prompt-builder call |
| `src/main/agent/context.ts` | Sharpen empty-state hint to instruct brief-based setup |
| `src/shared/ipc-types.ts` (if task record schema lives here) | Persisted task record gains optional `brief: string` field |

---

## Testing

| Component | Test type | Verify |
|---|---|---|
| `BASE_SYSTEM_PROMPT` rewrite | Snapshot | Contains new sections; old "Skill creation" block gone |
| `researcherPrompt` rewrite | Snapshot | Includes brief slot, mutable-surfaces block, update-over-create rule, `### Files changed` handoff format |
| `orchestratorPrompt` rewrite | Snapshot | Same plus orchestration-specific blocks |
| `finisherPrompt` rewrite | Snapshot | Includes "do NOT touch" list, idempotency block, brief slot |
| `start_research` tool | Unit | Accepts `brief` field, forwards to `startResearchFn` |
| `ResearchService` plumbing | Unit | `brief` reaches `researcherPrompt`/`orchestratorPrompt` unchanged |
| `parseFilesChanged` | Unit | Parses new heading; ignores old heading (returns empty) |
| Finisher tool set | Unit | `AGENT_TYPE_PRESETS.finisher` includes `list_skills`, `read_skill`, `execute_code` |
| First-run setup | Integration | Empty project triggers context hint; coordinator builds persistent brief; researcher writes GOAL.md/FILES.md with approval popups |
| Persistent-flow E2E | Integration | "from now on as PDF" user message → brief built → researcher updates FILES.md + creates md-to-pdf skill → finisher reports both in summary |
| One-shot flow E2E | Integration | Simple factual question → brief built with `one_shot` → researcher writes only artifact, no persistent changes → finisher delivers artifact |

Coverage target stays 90% per CLAUDE.md.

---

## Risks

| Risk | Mitigation |
|---|---|
| Coordinator misclassifies durability → silent system mutation | Ask user when cue is faint; durability call-out in finisher's summary so user notices |
| Researcher ignores update-over-create → skill bloat | Prompt explicit; finisher reports "created N new skills, updated M" in summary; user sees growth |
| Researcher writes to forbidden surface despite prompt | Path-jail approval popup is last line of defense |
| Brief XML malformed | Researcher works on garbage, produces low-quality output, evaluator surfaces gap; cheaper than code-level validation |
| Approval popups during background research interrupt UX | Already a v1 reality; not solving here |
| Finisher mutates persistent surface despite prompt | Surface in user message ("I changed FILES.md") — user sees and can push back; harden later if drift observed |
| FILES.md ambiguity blocks finisher delivery | Finisher surfaces the ambiguity in summary; user resolves in next turn |
| `propose_skill` removal leaves chat-only proposal gap | All skill writes route through `write_file` + path-jail; coordinator can write skills directly without research if user asks |

---

## Open questions resolved during brainstorming

| # | Question | Resolution |
|---|---|---|
| 1 | Brief schema strictness | XML with eight required tags; content may be empty |
| 2 | Skill write path | Single mechanism — `write_file` + path-jail approval. `propose_skill` not in current code |
| 3 | Change tracking source-of-truth | Trust researcher's `### Files changed` declared list |
| 4 | Hard boundary on finisher writes to persistent surfaces | Prompt-only for v1 |
| 5 | First-run handling | Delete `FIRST_RUN_SKILL`; setup becomes a persistent brief over empty state |
| 6 | In-flight scale escalation | Out of scope; researcher notes in handoff, coordinator may rerun deep |
| 7 | Snapshot-diff defense-in-depth | Out of scope; rely on researcher declaration + path-jail approvals |
| 8 | Built-in conversion skills (md-to-pdf, etc.) | Out of scope; emerge from real user requests |
