# Research Assistant

> **Private project — work in progress.**

An AI-native desktop companion that runs deep, parallel research in the background without blocking your conversation. It learns your context across sessions through observational memory and drops structured Markdown artifacts into your project folder — optionally synced to your Obsidian vault.

## Vision

Most AI chat tools freeze while research runs. This assistant inverts the model:

- **Chat flows uninterrupted** — research dispatched as background subagents
- **Results arrive proactively** — OS notification when research completes
- **Memory compounds** — observational memory captures preferences, decisions, and conventions across sessions
- **Artifacts are structured** — research outputs saved as plain `.md` files tied to a project
- **Projects are first-class** — each chat is a project with its own context, history, and artifact folder
- **Nothing is hardcoded** — skills, conventions, and tools live in the filesystem; the agent loads them on demand
- **Self-evolving** — the agent observes your work patterns, learns how you like things done, and crystallizes new skills automatically (inspired by OpenClaw and Hermes agent approaches)

## What Works Now

### Chat & Projects
- Streaming chat UI with message history per project
- Project creation with native OS folder picker — every project is linked to a filesystem directory
- Project rename, delete, unlink via context menu
- Agent auto-starts after project creation — explores structure and writes project conventions automatically

### Agent Core
- Pi agent harness (`@mariozechner/pi-agent-core` + `pi-ai`) with persistent `AgentSession` per project
- Streaming tokens via IPC (`MESSAGE_CHUNK` / `MESSAGE_DONE`)
- 300s extended timeout for slow local models
- Thinking indicator while agent processes
- Duplicate message prevention with `agent_end` deduplication + DB reload

### Safety
- Approval gate for risky shell commands (`safe_bash`)
- Human-readable blocklist for dangerous operations
- Audit log for all executed commands
- Dynamic path approval outside project folders — approve once, approve for session, or deny
- File hash verification on write (`expected_hash`) with line-based editing

### Memory & Learning
- Observational memory via Mastra LibSQLStore — persists across sessions
- Structured memory system — agent saves/reads categorized markdown memories (philosophy, decision, finding, convention)
- App-level + project-level `MEMORY.md` — rolling summaries auto-loaded into context
- Observer writes daily conversation summaries
- `MEMORY.md` auto-summarization when files grow too long

### Skills & Extensibility
- Skills live as markdown files in `~/.research-assistant/skills/` and project folders
- Lazy loading — agent sees only an index until a skill is referenced
- Dynamic skill refresh without restart — file watcher detects changes and injects delta into next turn
- Skill crystallization — agent proposes new reusable skills after completing novel workflows; user approves via existing UI
- Research is now a built-in skill, not hardcoded

### Research
- Background research dispatch via subagents (shallow and deep modes)
- Research outputs routed to project folder automatically
- Task persistence — research tasks stored in Drizzle tasks table
- OS notifications on research complete when window unfocused

### UI
- React 19 + MUI v9 dark-mode interface
- File Explorer in right panel — recursive tree of project folder and workspace; double-click opens markdown/code viewer
- Recent outputs notification panel — unacknowledged file writes with acknowledge all / reveal in folder
- Settings modal with model provider configuration
- Markdown rendering via react-markdown (GFM)

### Model Providers
- OpenRouter, Ollama, and OpenAI supported
- Model auto-discovery with strict Autocomplete dropdowns — fetched via backend IPC from each provider's API
- Fallback logic: if Ollama is unreachable, falls back to default cloud provider with clear error messages

### Testing & Observability
- **Promptfoo eval harness** — Three-tier rubric for research artifact quality:
  - Tier 1: Completeness (deterministic + LLM rubric)
  - Tier 2: Cross-source synthesis (reconciles conflicting claims, references local + web data)
  - Tier 3: Actionable quality (1-5 score for decision-making usefulness)
  - Fixture-based: `tests/eval/fixtures/solid-state-batteries/` with local project files, GOAL.md, FILES.md
  - Run via `bun run test:eval --fixture solid-state-batteries`
- Playwright E2E tests — `bun run test:e2e`
- Vitest unit tests — `bun run test`

### File & Workspace
- Project folder linked at creation; agent reads/writes inside it
- `AGENTS.md` / `GOAL.md` / `FILES.md` per project for conventions, goals, and file inventory
- Per-project context refresh — system prompt rebuilt before every turn

## Known Gaps

- Light mode only — dark mode only; no light theme
- Ollama model pull from UI — host/model selection works, but pulling new models still requires terminal (`ollama pull`)
- Cross-platform packaging — macOS only; no Windows/Linux build pipeline
- Research status sidebar — ongoing researches and their status not yet visible in right panel
- Agent thinking stream — thinking steps are not visible to user (spinner only)

## What's Next

| Phase | Focus | Status |
|---|---|---|
| A | Foundation — filesystem-native workflow, AGENTS.md, project folders | Done |
| B | Memory & Skills — structured memory, MEMORY.md, skill refresh, crystallization | Done |
| C | Genericness — skills as files, research as skill, path approval, file explorer | Done |
| D | Testing & Observability — Promptfoo eval harness (fixture-based, three-tier rubric), E2E happy-path suite, Langfuse tracing | In Progress |
| E | Polish — heartbeat sync, Ollama pull UI, light mode, cross-platform packaging | Planned |

## Tech Stack

| Concern | Tool |
|---|---|
| Runtime / package manager | Bun |
| Desktop shell | Electron 41 |
| Build | electron-vite |
| UI | React 19 + MUI v9 |
| Agent harness | `@mariozechner/pi-agent-core` + `pi-ai` |
| Observational memory | Mastra (LibSQLStore) |
| Database | `@libsql/client` + Drizzle ORM |
| DI container | TSyringe |
| Linting + formatting | Biome v2 |
| Tests | Vitest |
| Language | TypeScript (strict) |

## Architecture

Three-process Electron app:

```
src/main/       — Node.js: BrowserWindow, IPC handlers, services, agents
src/preload/    — Bridge: exposes window.electronAPI via contextBridge
src/renderer/   — Browser: React + MUI, communicates only via IPC
src/shared/     — Types and constants shared across all processes
```

The renderer has no Node.js access — all system calls go through IPC.

## Frameworks & Architectural Approaches

### Agent Harness — Pi SDK

The agent core is built on **`@mariozechner/pi-agent-core`** + **`pi-ai`** (not `pi-coding-agent`, which is a CLI app). One `AgentSession` per project wraps a Pi `Agent` and persists across messages to preserve conversation history.

- **Event mapping:** `message_update` + `text_delta` → `MESSAGE_CHUNK` IPC; `agent_end` → `MESSAGE_DONE`
- **System prompt rebuilt every turn** — `AGENTS.md`, `GOAL.md`, `MEMORY.md`, and skill index are reloaded before each message so changes are picked up immediately
- **Context window management** — messages are pruned backwards from the tail to fit within model context window minus a reserved token buffer
- **Worker agent factory** — `createWorkerAgent(config)` spawns sub-agents (researcher, evaluator, etc.) that share the same base but differ by `toolNames`, `skills`, and `systemPromptAddition`
- **Evaluator injection** — `request_evaluation` tool is wired via callback to prevent `tools.ts` ↔ `worker-agent.ts` circular import

### IPC — Whitelist Bridge

The preload script is the **only** bridge between renderer and main. It whitelists channels explicitly and blocks everything else:

| Direction | Pattern | Channels |
|---|---|---|
| Renderer → Main | `invoke` (request/response) | `GET_PROJECTS`, `CREATE_PROJECT`, `GET_MESSAGES`, `GET_SETTINGS`, `SAVE_SETTINGS` |
| Renderer → Main | `send` (fire-and-forget) | `SEND_MESSAGE` |
| Main → Renderer | `webContents.send` (push) | `MESSAGE_CHUNK`, `MESSAGE_DONE`, `NEW_MESSAGE`, `RESEARCH_STATUS_UPDATE`, `RESEARCH_COMPLETE` |

- `contextBridge.exposeInMainWorld("electronAPI", api)` — renderer accesses only this API
- `assertAllowed(channel)` throws if a non-whitelisted channel is used
- Test mode adds `_simulateEvent` for renderer testability without Electron

### Dependency Injection — TSyringe

All services are `@injectable()` with Symbol tokens for repositories:

```
container.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository })
container.registerSingleton(ProjectService)
```

- Child container created per app instance
- `bootstrap()` sequence: DB init → migrations → DI registration → IPC handlers
- Repositories implement interfaces (`IProjectRepository`, `IMessageRepository`, etc.) — easy to swap

### Database — Drizzle + `@libsql/client`

- Single SQLite file at `userData/scholar.db` with WAL mode
- App tables (`projects`, `messages`, `artifacts`) coexist with Mastra tables (`mastra_*` prefix) — no collision
- **`@libsql/client` chosen over `bun:sqlite`** — unifies driver with Mastra's `LibSQLStore`; prevents `drizzle-kit` conflicts
- Idempotent `ALTER TABLE` on bootstrap for schema evolution
- Drizzle migrator runs at startup before DI container is wired

### Memory — Mastra LibSQLStore (Direct)

**Mastra `LibSQLStore` is used directly, NOT via Mastra's `Memory` class** — Mastra's `Memory` couples tightly to Mastra's own `Agent`; incompatible with Pi's `Agent`.

- Per-project isolation via `resourceId = threadId = projectId`
- Custom Observer/Reflector using Pi `complete()` for compression instead of Mastra's built-in
- Mastra's internal Observer/Reflector calls bypass LangFuse (infrastructure calls, not user-facing)
- `MemoryManager.buildContext()` called in `ipc-handlers.ts` before `AgentSession` construction (constructor stays sync)

### Safety — Path Jail + Approval Gates

**PathJail** validates all filesystem paths against allowed roots (project folder, workspace, agent home). **Three-layer security:**

1. **Path approval outside project** — dynamic banner when agent tries to read/write outside allowed zones; options: approve once, approve session, deny
2. **Command blocklist** — `safe_bash` tool uses human-readable blocklist for dangerous operations (`rm -rf /`, `mkfs`, etc.) + 30s timeout + 2KB output cap
3. **File hash verification** — `write_file` requires `expected_hash`; mismatch forces re-read to prevent overwriting concurrent changes
4. **Audit log** — all executed commands logged to `~/.research-assistant/audit.log`

### Skills — Filesystem-First Extensibility

Skills are markdown files, not code. This keeps the agent generic and lets users teach new capabilities without touching core code.

- **4 sources scanned:** `~/.research-assistant/skills/` (global), `~/.agents/skills/` (legacy), `<project>/.research-assistant/skills/`, `<project>/.agents/skills/`
- **Lazy loading** — agent sees only an XML index of skill names until a skill is referenced in conversation
- **Dynamic refresh** — chokidar watches skill dirs; changes detected and injected as context update on next turn
- **Crystallization** — after completing novel multi-step workflows, agent proposes new reusable skills; user approves via existing pending-tool UI
- **Builtins deployed on first run** — `start_research`, `discover_project`, `evaluate-research` written only if `SKILL.md` missing (preserves customizations)

### Research Pipeline

```
User asks → Agent detects research need → start_research skill
  → ResearchService spawns worker agent (Tier 1)
  → Worker runs tools (read_file, web_search, safe_bash, etc.)
  → Optional: request_evaluation → evaluator agent parses JSON verdict
  → Output routed to project folder via OutputRouter
  → Task JSON deleted → OS notification fired
```

- **Task persistence = file presence** — `tasks/<taskId>.json` means in-progress; deleted on completion/failure
- **Auto-resume on app start** — `registerIpcHandlers()` reads `tasks/` dir and re-dispatches unfinished research
- **Recursion guard** — evaluator toolNames never include `request_evaluation`
- **Research workers structurally excluded from memory** — no Mastra imports in `ResearchService`

### Model Provider Routing

- **OpenRouter** — primary cloud provider; Pi's built-in provider abstraction handles routing
- **Ollama** — local models via `/api/tags` discovery; fallback to cloud if Ollama unreachable
- **OpenAI** — direct via `/v1/models` discovery
- **LangFuse proxy** — Pi model object spread with overridden `baseUrl` + `x-langfuse-*` headers; no LangFuse JS SDK; off by default

### UI — React 19 + MUI v9

- StrictMode throughout; `createRoot` API
- CSS custom properties for design tokens (`tokens.css`, `tokens-dark.css`)
- `react-markdown` + `remark-gfm` for GFM rendering
- Testing Library + happy-dom for component tests
- Playwright for E2E tests

### Code Quality — Biome v2

- Single tool for lint + format — no ESLint, no Prettier
- `check --write` auto-fixes on commit
- TypeScript strict mode; `tsc --noEmit` is a hard gate

## Development

```bash
bun install
bun run dev          # Start Electron with hot-reload
```

## Quality Gates

```bash
bun run typecheck    # tsc --noEmit — must be zero errors
bun run check        # Biome lint + format check with auto-fix
bun run test         # Run all Vitest tests
```

## Database

```bash
bun run db:generate  # Generate Drizzle migrations from schema
```

DB stored at `app.getPath('userData')/research-assistant.db` — outside the repo, per-user.

## Langfuse (Local)

Local observability stack available for development:

```bash
docker compose -f docker-compose.langfuse.yml up -d
```

Services: `langfuse-web` (port 3000), `postgres`, `clickhouse`, `redis`, `minio`.

## Project Structure

```
src/
├── main/
│   ├── db/               — Drizzle schema + migrations
│   ├── repositories/     — Project, Message, Artifact repositories
│   ├── services/         — Project, Message, Research, File, Settings services
│   ├── agent/            — AgentSession, path jail, tool handlers
│   ├── ipc-handlers.ts   — IPC channel registrations
│   └── index.ts          — Main process entry
├── preload/
│   └── index.ts          — contextBridge whitelist
├── renderer/
│   ├── components/       — React UI components
│   └── main.tsx          — Renderer entry
└── shared/
    ├── ipc-channels.ts   — Channel name constants
    └── types.ts          — Shared TypeScript types
```
