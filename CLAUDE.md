# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # Start Electron with hot-reload (Vite dev server + Electron)
bun run build        # Production build via electron-vite
bun run typecheck    # tsc --noEmit — must be zero errors before committing
bun run check        # Biome lint + format check (auto-fixes) — must be clean before committing
bun run lint         # Biome lint only (no fix)
bun run format       # Biome format only (with --write)
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

**Critical constraint:** The renderer is a pure browser context. No Node.js APIs there — all system calls go through IPC. The preload script is the only bridge.

### IPC Contract (`src/shared/ipc-channels.ts`)

| Channel | Direction | Pattern | Purpose |
|---|---|---|---|
| `GET_PROJECTS` | renderer→main | `invoke` | Fetch project list |
| `CREATE_PROJECT` | renderer→main | `invoke` | Create project |
| `GET_ARTIFACTS` | renderer→main | `invoke` | Fetch artifacts |
| `SEND_MESSAGE` | renderer→main | `send` (fire-and-forget) | Submit chat message |
| `MESSAGE_CHUNK` | main→renderer | `webContents.send` | Stream LLM token |
| `MESSAGE_DONE` | main→renderer | `webContents.send` | Stream complete |
| `NEW_MESSAGE` | main→renderer | `webContents.send` | Push new message |
| `RESEARCH_STATUS_UPDATE` | main→renderer | `webContents.send` | Research progress |
| `RESEARCH_COMPLETE` | main→renderer | `webContents.send` | Research done |

**`ipcMain.handle` is global** — register handlers once at startup only (`app.whenReady`), never inside the `activate` handler.

**Streaming pattern:** `ipcMain.on` + `event.sender.send(IPC.MESSAGE_CHUNK, token)` per chunk. `ipcMain.handle` cannot stream — it's request/response only.

### Research Architecture

Research is **not** triggered by the renderer. The main-process Mastra agent detects research intent in a `SEND_MESSAGE` payload and internally dispatches a research subagent. The renderer only observes via `RESEARCH_STATUS_UPDATE` and `RESEARCH_COMPLETE` events.

Research agents (Run 6+) are **plain orchestrators — no Mastra**. This keeps main conversation context clean (no compaction pressure). Pattern: orchestrator → parallel researchers → evaluator. Result: summary injected into main conversation + artifact saved to project dir.

**One project = one Mastra conversation** (persistent context per project).

## Toolchain

| Concern | Tool |
|---|---|
| Runtime / package manager | Bun |
| Build | electron-vite |
| Linting + formatting | Biome v2 (no ESLint, no Prettier) |
| UI | React 19 + MUI v9 |
| Language | TypeScript strict throughout |

## Current State (Run 1 complete)

Run 1 scaffold is done. All files are placeholder stubs — no real logic yet.

- `src/main/ipc-handlers.ts` — stub handlers returning mock data
- `src/renderer/components/layout/` — placeholder Box+Typography components
- No database, no services, no agent logic

## Upcoming Runs

**Run 2** (next): Shared types + bun:sqlite + Drizzle ORM + repository pattern + services + event bus.
> Before starting Run 2: research Mastra Observational Memory (task in Obsidian project note "Budowa asystenta badawczego"). This informs `IMessageRepository` interface design — specifically whether semantic `search(query)` is needed now or deferred.

**Run 3**: CLAUDE.md update, final verification, git hygiene.
**Run 4**: Real chat UI + message persistence.
**Run 5**: OpenRouter integration + streaming.
**Run 6**: Mastra agent loop + research subagents.
**Run 7**: Observational memory + LangFuse.
**Run 8**: Tier 2/3 research (parallel + evaluator loop).
**Run 9**: Stitch design system (replace generic MUI theme).

Full roadmap: `04 Resources/AI/Research Assistant - Implementation Roadmap.md` in Obsidian vault.

## DB Strategy (Run 2)

`bun:sqlite` + Drizzle ORM. Repository interfaces (`IProjectRepository`, `IMessageRepository`, `IArtifactRepository`) abstract the storage layer — the goal is to swap to an AI-native storage solution later without changing services. DB file at `app.getPath('userData')/research-assistant.db`.

## TypeScript Path Aliases

```
@main/*    → src/main/*
@renderer/* → src/renderer/*
@shared/*  → src/shared/*
```

Configured in `electron.vite.config.ts` (aliases) and `tsconfig.json` (for IDE). Three tsconfigs: root (`tsconfig.json`), node process (`tsconfig.node.json`), renderer (`tsconfig.web.json`).

## Docs

Implementation plans and specs live in `docs/superpowers/`:
- `specs/` — design specs per run
- `plans/` — implementation task plans per run
