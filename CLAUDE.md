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

Event mapping:
| Pi event | IPC channel |
|---|---|
| `message_update` + `text_delta` | `MESSAGE_CHUNK` |
| `agent_end` | `MESSAGE_DONE` |

## IPC Contract (`src/shared/ipc-channels.ts`)

| Channel | Direction | Pattern | Purpose |
|---|---|---|---|
| `GET_PROJECTS` | renderer→main | `invoke` | Fetch project list |
| `CREATE_PROJECT` | renderer→main | `invoke` | Create project |
| `GET_ARTIFACTS` | renderer→main | `invoke` | Fetch artifacts |
| `GET_MESSAGES` | renderer→main | `invoke` | Fetch message history for project |
| `GET_SETTINGS` | renderer→main | `invoke` | Read current settings |
| `SAVE_SETTINGS` | renderer→main | `invoke` | Save API key + model |
| `SEND_MESSAGE` | renderer→main | `send` (fire-and-forget) | Submit chat message |
| `MESSAGE_CHUNK` | main→renderer | `webContents.send` | Stream LLM token |
| `MESSAGE_DONE` | main→renderer | `webContents.send` | Stream complete |
| `NEW_MESSAGE` | main→renderer | `webContents.send` | Push new message |
| `RESEARCH_STATUS_UPDATE` | main→renderer | `webContents.send` | Research progress |
| `RESEARCH_COMPLETE` | main→renderer | `webContents.send` | Research done |

**`ipcMain.handle` is global** — register handlers once at startup only (`app.whenReady`), never inside `activate`.

**Streaming pattern:** `ipcMain.on` + `event.sender.send(IPC.MESSAGE_CHUNK, token)` per chunk.

## Settings

`SettingsService` (`src/main/services/SettingsService.ts`) persists to `app.getPath('userData')/settings.json`:
- API key encrypted via `electron.safeStorage` (stored as base64)
- Model stored plain

## Agent Home Directory (Run 6+)

`~/.research-assistant/` — not yet implemented. Planned: `config.md`, `skills/`, `projects/<slug>/AGENTS.md`, `workspace/`, `audit.log`.

## Code Execution Model (Run 6+, Run 8)

Three tiers — not yet implemented:
- **Tier 1** (Run 6): Path-jailed `read`/`write`/`edit` via `src/main/agent/path-jail.ts`
- **Tier 2** (Run 6): `safe_bash` Pi extension — fenced execution with blocklist + timeout + audit log
- **Tier 3** (Run 8): `run_in_sandbox` E2B extension — isolated container

## Toolchain

| Concern | Tool |
|---|---|
| Runtime / package manager | Bun |
| Build | electron-vite |
| Linting + formatting | Biome v2 (no ESLint, no Prettier) |
| UI | React 19 + MUI v9 |
| Language | TypeScript strict throughout |
| DI | TSyringe (`@injectable()`, `@inject()`) |
| DB | Drizzle ORM + `@libsql/client` (NOT `bun:sqlite`) |

## TypeScript Path Aliases

```
@main/*    → src/main/*
@renderer/* → src/renderer/*
@shared/*  → src/shared/*
```

## What NOT to do

- No `require()` — ESM throughout
- No Node.js APIs in renderer — all go through IPC
- No ESLint, no Prettier — Biome only
- No `bun:sqlite` — use `@libsql/client`
- No `@mariozechner/pi-coding-agent` — use `pi-agent-core` + `pi-ai`
- No Mastra imports before Run 7
- Do not register `ipcMain.handle` inside the `activate` handler
