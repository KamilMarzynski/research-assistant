# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
bun run dev          # Start Electron with hot-reload (Vite dev server + Electron)
bun run build        # Production build via electron-vite
bun run typecheck    # tsc --noEmit — must be zero errors before committing
bun run check        # Biome lint + format check (auto-fixes) — must be clean before committing
bun run lint         # Biome lint only (no fix)
bun run format       # Biome format only (with --write)
bun run test         # Run all Vitest tests
bun run test:coverage  # Run tests with coverage report (enforces 90% thresholds)
```

**Always use `bun` and `bunx`. Never `npm`, `npx`, or `yarn`.**

## Architecture

Three-process Electron app:

```
src/main/       — Node.js process: BrowserWindow, IPC handlers, services, agents
src/preload/    — Bridge: exposes window.electronAPI via contextBridge (whitelist-only)
src/renderer/   — Browser context: React + MUI, communicates only via window.electronAPI
src/shared/     — Types and constants shared across all three processes
```

**Critical constraint:** The renderer is a pure browser context. No Node.js APIs — all system calls go through IPC. The preload is the only bridge.

## Agent Harness

**Package:** `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`

**Never install `@mariozechner/pi-coding-agent`** — that is a CLI terminal app, not an SDK.

`AgentSession` (`src/main/agent/session.ts`) wraps one Pi `Agent` per project:
- Created lazily on first `SEND_MESSAGE` for a project
- Stored in `Map<projectId, AgentSession>` in `ipc-handlers.ts`
- Reused for subsequent messages (preserves Pi conversation history)
- `beforeToolCall` blocks all tool calls until Run 6

## IPC Contract (`src/shared/ipc-channels.ts`)

renderer→main: `ipcMain.handle` (invoke) for queries/mutations; `ipcMain.on` for fire-and-forget (`SEND_MESSAGE`).
main→renderer: `webContents.send` for push events (streaming chunks, status updates, approvals).

**`ipcMain.handle` is global** — register once at startup (`app.whenReady`), never inside `activate`.

**Streaming:** `ipcMain.on(SEND_MESSAGE)` → `event.sender.send(MESSAGE_CHUNK, token)` per chunk → `MESSAGE_DONE`.

## Langfuse (Local)

```bash
docker compose -f docker-compose.langfuse.yml up -d   # start
docker compose -f docker-compose.langfuse.yml down   # stop
```

## Agent Home Directory

`~/.scholar/` — implemented. Layout:

```
~/.scholar/
├── projects/<slug>/        — one dir per project (slug = readable name + 6-char UUID suffix)
│   ├── GOAL.md             — project goals (agent-written on first run)
│   ├── FILES.md            — output routing conventions (agent-written on first run)
│   ├── MEMORY.md           — project-level rolling memory
│   ├── skills/             — project-scoped skills
│   └── workspace/          — agent scratch space (task subdirs created per research run)
├── skills/                 — global skills
├── tasks/                  — persisted research task records
├── pending-tools/          — skills awaiting user approval
└── app-memory/             — app-level memory files
```

## Code Execution Model

- **Tier 1**: Path-jailed `read_file`/`write_file`/`list_dir` (`src/main/agent/path-jail.ts`) — workspace, project dir, optionally linked folder
- **Tier 2**: `safe_bash` — shell with blocklist, timeout, audit log; blocked cmds trigger approve-once/session/deny flow
- **Tier 2.5**: `run_skill_script` — runs `script.{sh,py}` from skills dirs only; 60s timeout, 64 KB cap, audit log
- **Tier 3**: `execute_code` — Docker container; Python, JavaScript, bash; not E2B

## Clean Code

**UI:** Scholar design system (custom tokens/components) + MUI v9 used sparingly — not vanilla MUI.

- **Services own one domain** — IPC handlers only route, no business logic
- **React components** — no business logic; talk to main only via `window.electronAPI`
- **Early returns** over nested conditionals
- **No magic strings** — use constants from `src/shared/`
- **TSyringe** — `@injectable()` on every service; inject interfaces, not concretes
- **Types** — each feature gets a `*.types.ts` file (e.g. `session.types.ts`, `tools.types.ts`); no inline type sprawl in implementation files

## Quality Standards

Before claiming any task done, run in order:
1. `bun run typecheck` — zero errors
2. `bun run check` — zero lint/format issues
3. `bun run test` — all tests pass
4. `bun run test:coverage` — 90% branches/functions/lines/statements enforced

New code must maintain coverage — add tests for every new service, tool, or handler. Never leave broken tests behind.

## What NOT to do

- No `require()` — ESM throughout
- No Node.js APIs in renderer — all go through IPC
- No ESLint, no Prettier — Biome only
- No `bun:sqlite` — use `@libsql/client`
- No `@mariozechner/pi-coding-agent` — use `pi-agent-core` + `pi-ai`
- Do not register `ipcMain.handle` inside the `activate` handler
