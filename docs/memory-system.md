# Scholar Memory System

Scholar has a layered memory architecture. Each layer serves a different purpose, and together they create the feeling of a research assistant that actually remembers you and your work.

---

## Layer 1 — Conversational Memory (Automatic)

**What it is:** Every message you send and every response Scholar gives is stored for the current project. When the conversation grows long, Scholar automatically compresses it into a concise summary.

**What it does for you:** When you return to a project after days or weeks, Scholar still remembers what you were working on, what decisions you made, and what questions remained open. You do not need to repeat yourself.

**How it works:** The recent conversation history (last ~20 turns) is replayed into the context window so the model sees the full back-and-forth. A separate compressed summary captures the essence of older conversations. Both are injected into the system prompt automatically — you never manage this directly.

**Scope:** Per-project only. Each project has its own isolated conversation history.

---

## Layer 2 — Structured Knowledge Memory (Agent-Initiated)

**What it is:** When Scholar encounters something it judges worth remembering — a convention you prefer, a decision you made, a tool it learned to use, an important finding — it can save that as a structured memory.

**What it does for you:** Over time, Scholar builds a personal knowledge base about how you like to work. It might remember that you prefer terse output, that you always want citations inline, or that you use a specific folder structure for research artifacts. These memories then influence future behavior without you having to restate them.

**Categories:**

- **Philosophy** — Broad working principles (e.g., "prefer evidence over opinion")
- **Decision** — Choices made and their rationale (e.g., "use Vite over webpack")
- **Finding** — Important facts discovered during research
- **Tool Reference** — How to use a specific tool or API effectively
- **Project Convention** — Rules specific to a project (naming, structure, etc.)

**Scope:** Memories can be universal (apply to all projects) or project-specific. Scholar decides the scope based on whether the knowledge seems broadly reusable or tied to one context.

**Important:** This layer is *agent-initiated* and *tool-queried*. Scholar decides when something is worth saving, and later decides when to look it up via the `read_memory` tool. These categorized memories are **not** automatically injected into every prompt. They are fetched on demand.

---

## Layer 3 — Working Context Files (User-Controlled)

**What it is:** You can create and edit plain markdown files that Scholar reads into its system prompt on every interaction. These are your direct levers for controlling Scholar's behavior.

**The three files:**

1. **Working Style** — Describes how you like to work. Tone, formatting preferences, depth level, citation style. This is global and applies across all projects.

2. **Project Context** — Describes what a specific project is about, how files are organized, where outputs should go, and any domain-specific context. This lives with the project.

3. **Memory Notes** — Free-form notes you want Scholar to always remember for a project or globally. Less structured than Layer 2 memories, more like a scratchpad of important context.

**What it does for you:** Unlike the automatic layers, this is fully under your control. You write it once, and Scholar reads it into the system prompt before each new user message. It is the most reliable way to enforce preferences because it bypasses the agent's judgment about what is worth remembering.

---

## Layer 4 — Content Compression (Token Management)

**What it is:** When Scholar reads large files, fetches web pages, or gets search results, the raw content can be enormous. A compression layer summarizes or truncates this content before it reaches the model, while preserving the full text for reference.

**What it does for you:** Scholar can ingest long documents, large codebases, or multi-page search results without hitting token limits. The full content is saved locally so you or Scholar can reference it later if needed.

**Note:** This is not really "memory" in the sense of learning — it is a token-efficiency mechanism. But it is part of the context system that determines what Scholar knows in any given moment.

---

## How the Layers Interact

When you send a message, Scholar assembles its context window from layers that are automatically injected, plus tools the agent can call on demand:

**Automatically injected into the system prompt:**

1. **Base identity** — Who Scholar is and what its job is
2. **Working Style** — Your global preferences
3. **Skills** — Reusable techniques Scholar has learned
4. **Project Context** — What this project is about
5. **App-level Memory Notes** — Global free-form notes
6. **Project-level Memory Notes** — Project-specific free-form notes
7. **Compressed Conversation Summary** — What you talked about in past sessions
8. **Recent Conversation History** — Full back-and-forth of the current session
9. **Your current message**

**Available on demand (not auto-injected):**

10. **Structured Knowledge Memories** — Scholar can query these via tool calls when it judges them relevant

**Note on refresh cadence:** The system prompt (layers 1–8) is rebuilt and injected fresh *before each new user message*. It is not refreshed on internal tool calls or agent follow-ups within the same turn. This means your context files are always current when you type something new, but a long chain of internal agent reasoning uses the same system snapshot.

---

## Current Limitations

- **No cross-project conversational memory.** Each project's conversation history is isolated. If you work on Project A, then Project B, then return to A, Scholar remembers A's past sessions but has no memory of what happened in B.

- **Agent decides what to save.** Structured memories (Layer 2) are created by Scholar's judgment. The user cannot directly create or edit them through the UI.

- **No semantic search on memories.** Structured memories are searched by category and text matching, not by meaning.

These are known constraints that future work may address.

---

## Summary Table

| Layer | Trigger | Scope | User Control | Purpose |
|---|---|---|---|---|
| Conversational Memory | Automatic | Per-project | None | Remember past sessions |
| Structured Knowledge | Agent-initiated | App or project | Indirect (via request) | Build reusable knowledge base |
| Working Context Files | User-edited | App or project | Full | Directly control behavior |
| Content Compression | Automatic | Per-action | None | Stay within token limits |
