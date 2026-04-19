# Research Assistant

> **Private project — work in progress.**

An event-driven desktop research assistant that runs deep, parallel research in the background without interrupting the conversation. Built as an Electron app with a Mastra-powered agent loop, observational memory, and structured artifact output.

## Vision

Most AI chat tools block the conversation while research runs. This assistant inverts that model:

- **Chat flows uninterrupted** — research is dispatched as a background subagent
- **Results arrive proactively** — a notification or email when research is done
- **Memory accumulates** — the assistant learns your context and preferences across sessions via observational memory
- **Artifacts are structured** — research outputs are saved as `.md` files tied to a project, optionally synced to an Obsidian vault
- **Projects are first-class** — each chat is a project with its own context, history, and artifact folder

Research has three tiers: quick lookup, standard parallel research, and deep research (parallel agents + evaluator loop).

## Tech Stack

| Concern | Tool |
|---|---|
| Runtime / package manager | Bun |
| Desktop shell | Electron 41 |
| Build | electron-vite |
| UI | React 19 + MUI v9 |
| Agent framework | Mastra |
| Database | bun:sqlite + Drizzle ORM |
| Linting + formatting | Biome v2 |
| Tests | Vitest |
| Language | TypeScript (strict) |

## Architecture

Three-process Electron app:

```
src/main/       — Node.js: BrowserWindow, IPC handlers, services, Mastra agents
src/preload/    — Bridge: exposes window.electronAPI via contextBridge
src/renderer/   — Browser: React + MUI, communicates only via IPC
src/shared/     — Types and constants shared across all processes
```

The renderer has no Node.js access — all system calls go through IPC. Research agents are plain orchestrators (no Mastra overhead) that run in main and push status updates to the renderer.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Node.js is not required — Bun handles everything

## Setup

```bash
bun install
```

## Development

```bash
bun run dev          # Start Electron with hot-reload (Vite dev server + Electron)
```

## Build

```bash
bun run build        # Production build via electron-vite
```

## Testing

```bash
bun run test              # Run tests once
bun run test:watch        # Watch mode
bun run test:coverage     # Coverage report
```

## Code Quality

```bash
bun run typecheck    # tsc --noEmit (must be zero errors before committing)
bun run check        # Biome lint + format check with auto-fix
bun run lint         # Lint only
bun run format       # Format only
```

## Database

```bash
bun run db:generate  # Generate Drizzle migrations from schema
```

DB file is stored at `app.getPath('userData')/research-assistant.db` — outside the repo, per-user.

## Project Structure

```
src/
├── main/
│   ├── db/               — Drizzle schema + migrations
│   ├── repositories/     — IProjectRepository, IMessageRepository, IArtifactRepository
│   ├── services/         — ProjectService, MessageService, ResearchService, FileService
│   ├── agents/           — Mastra agent loop + research subagents
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
docs/
└── superpowers/
    ├── specs/            — Design specs per run
    └── plans/            — Implementation task plans per run
```

## Implementation Status

| Run | Scope | Status |
|---|---|---|
| 1 | Scaffold — Electron shell, IPC stubs, layout components | ✅ Done |
| 2 | Shared types, bun:sqlite + Drizzle, repositories, services, EventBus | ✅ Done |
| 3 | CLAUDE.md update, final verification, git hygiene | Next |
| 4 | Real chat UI + message persistence | Planned |
| 5 | OpenRouter integration + streaming | Planned |
| 6 | Mastra agent loop + research subagents | Planned |
| 7 | Observational memory + LangFuse | Planned |
| 8 | Tier 2/3 research (parallel + evaluator loop) | Planned |
| 9 | Stitch design system (replace generic MUI theme) | Planned |

Full roadmap in Obsidian: `04 Resources/AI/Research Assistant - Implementation Roadmap.md`
