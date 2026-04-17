# Research Assistant — Scaffold Run 1 Design

**Date:** 2026-04-17
**Scope:** Groups 1–4 only. Goal: runnable Electron window with 3-column placeholder AppShell. No agent logic, no DB, no real IPC responses.

---

## 1. Project Structure

```
research-assistant/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron entry, BrowserWindow, lifecycle
│   │   └── ipc-handlers.ts       # ipcMain registrations, stub responses
│   ├── preload/
│   │   └── index.ts              # contextBridge → window.electronAPI
│   ├── renderer/
│   │   ├── index.html            # HTML shell with #root
│   │   ├── main.tsx              # ReactDOM.createRoot → <App />
│   │   ├── App.tsx               # ThemeProvider + AppShell
│   │   ├── theme.ts              # MUI theme definition
│   │   └── components/
│   │       └── layout/
│   │           ├── AppShell.tsx
│   │           ├── LeftSidebar.tsx
│   │           ├── RightSidebar.tsx
│   │           └── chat/
│   │               ├── ChatPanel.tsx
│   │               ├── MessageList.tsx
│   │               ├── MessageInput.tsx
│   │               └── ResearchStatusBar.tsx
│   │           └── artifacts/
│   │               └── ArtifactPanel.tsx
│   └── shared/
│       └── ipc-channels.ts       # Typed IPC channel constants
├── electron.vite.config.ts
├── tsconfig.json                 # Root (references node + web)
├── tsconfig.node.json            # Main + preload
├── tsconfig.web.json             # Renderer
├── biome.json
└── package.json
```

---

## 2. Stack

| Layer | Choice |
|---|---|
| Runtime / package manager | Bun |
| Desktop framework | Electron (latest stable) |
| Build tool | electron-vite |
| UI | React + MUI v6 |
| Linting / formatting | Biome (no ESLint, no Prettier) |
| Language | TypeScript, strict mode throughout |

---

## 3. TypeScript Configuration

Three tsconfigs — root references both:

**tsconfig.json** (root)
- `composite: true`, no emit
- References `tsconfig.node.json` and `tsconfig.web.json`
- Path aliases: `@main/*`, `@renderer/*`, `@shared/*`
- Target: ES2022, moduleResolution: bundler

**tsconfig.node.json** (main + preload)
- Extends root
- Adds `@types/node`
- Module: CommonJS (Electron main requires CJS interop)
- Includes: `src/main/**/*`, `src/preload/**/*`, `electron.vite.config.ts`

**tsconfig.web.json** (renderer)
- Extends root
- Lib: DOM, DOM.Iterable
- JSX: react-jsx
- Includes: `src/renderer/**/*`

---

## 4. Biome Configuration

- Formatter: 2-space indent, line width 100, double quotes
- Linter: recommended rules enabled
- organizeImports: enabled
- VCS: gitignore integration enabled
- Excludes: `dist/`, `out/`, `node_modules/`, `**/*.d.ts`

---

## 5. Electron Main Process

### `src/main/index.ts`
- Creates `BrowserWindow`: 1280×800, minWidth 900, minHeight 600
- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, preload path resolved via `__dirname`
- Dev: loads `http://localhost:5173` (electron-vite dev server)
- Prod: loads `dist/renderer/index.html`
- Lifecycle: `app.whenReady()`, `window-all-closed` (quit on non-mac), `activate` (re-create window on mac)
- Calls `registerIpcHandlers()` on ready

### `src/preload/index.ts`
- `contextBridge.exposeInMainWorld('electronAPI', { send, on, invoke })`
- `send(channel, data)` — `ipcRenderer.send` — fire-and-forget (used for SEND_MESSAGE)
- `invoke(channel, data)` — `ipcRenderer.invoke` — request/response (used for GET_PROJECTS etc.)
- `on(channel, callback)` — `ipcRenderer.on` — subscribe to main→renderer pushes (MESSAGE_CHUNK etc.)
- Channels whitelisted via `const ALLOWED_CHANNELS` array — throws if unknown channel used

### `src/shared/ipc-channels.ts`
```ts
export const IPC = {
  // renderer → main (invoke)
  GET_PROJECTS:    'GET_PROJECTS',
  CREATE_PROJECT:  'CREATE_PROJECT',
  GET_ARTIFACTS:   'GET_ARTIFACTS',

  // renderer → main (send, fire-and-forget)
  SEND_MESSAGE:    'SEND_MESSAGE',

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK:          'MESSAGE_CHUNK',
  MESSAGE_DONE:           'MESSAGE_DONE',
  NEW_MESSAGE:            'NEW_MESSAGE',
  RESEARCH_STATUS_UPDATE: 'RESEARCH_STATUS_UPDATE',
  RESEARCH_COMPLETE:      'RESEARCH_COMPLETE',
} as const

export type IpcChannel = typeof IPC[keyof typeof IPC]
```

### `src/main/ipc-handlers.ts`
- `registerIpcHandlers(win: BrowserWindow): void`
- `ipcMain.handle(IPC.GET_PROJECTS, ...)` → returns `[]`
- `ipcMain.handle(IPC.CREATE_PROJECT, ...)` → returns mock project
- `ipcMain.handle(IPC.GET_ARTIFACTS, ...)` → returns `[]`
- `ipcMain.on(IPC.SEND_MESSAGE, ...)` → logs call, no response yet
- Each handler logs: `[IPC] <channel> called with:`, payload

---

## 6. Renderer Process

### Theme (`src/renderer/theme.ts`)
- Exports `createAppTheme(mode: 'light' | 'dark'): Theme`
- MUI `createTheme` with:
  - Palette: `mode` passed in, primary `#3F51B5` (indigo)
  - Typography: Roboto (imported via `@fontsource/roboto`), standard MUI scale
  - Shape: `borderRadius: 12`

### App (`src/renderer/App.tsx`)
- `const isDark = useMediaQuery('(prefers-color-scheme: dark)')`
- `const theme = createAppTheme(isDark ? 'dark' : 'light')`
- Wraps `<AppShell />` in `<ThemeProvider theme={theme}>` + `<CssBaseline />`

### AppShell (`src/renderer/components/layout/AppShell.tsx`)
- `Box` with `display: flex`, `flexDirection: row`, `height: 100vh`, `overflow: hidden`
- `<LeftSidebar />` — `width: 240px`, `flexShrink: 0`
- `<ChatPanel />` — `flex: 1`, `overflow: hidden`
- `<RightSidebar />` — `width: 320px`, `flexShrink: 0`

### Placeholder Components
Each renders a `<Box>` with `bgcolor`, `height: 100%`, `display: flex`, `alignItems: center`, `justifyContent: center` and a `<Typography>` label. Components:
- `LeftSidebar` — label "Left Sidebar"
- `RightSidebar` — label "Right Sidebar"
- `ChatPanel` — label "Chat Panel"
- `MessageList` — label "Message List"
- `MessageInput` — label "Message Input"
- `ResearchStatusBar` — label "Research Status Bar"
- `ArtifactPanel` — label "Artifact Panel"

---

## 7. electron-vite Config

`electron.vite.config.ts` exports three configs:
- **main**: entry `src/main/index.ts`, build to `dist/main`
- **preload**: entry `src/preload/index.ts`, build to `dist/preload`
- **renderer**: Vite config with `@vitejs/plugin-react`, entry `src/renderer/index.html`, build to `dist/renderer`

---

## 8. Package.json Scripts

```json
{
  "dev":       "electron-vite dev",
  "build":     "electron-vite build",
  "preview":   "electron-vite preview",
  "lint":      "biome lint ./src",
  "format":    "biome format --write ./src",
  "check":     "biome check ./src",
  "typecheck": "tsc --noEmit"
}
```

---

## 9. Verification Gate

Before Run 1 is complete:
1. `bun run typecheck` — zero errors
2. `bun run check` — Biome clean (zero lint + format issues)
3. `bun run dev` — Electron window opens, 3-column AppShell visible
4. `window.electronAPI` visible in DevTools console (no `console.log` left in source)
5. Hot reload: edit `App.tsx` text → renderer updates without full Electron restart

---

## 10. What This Does NOT Include

- No database (Drizzle + bun:sqlite lands in Run 2)
- No real IPC responses (stubs only)
- No agent logic
- No Mastra
- No OpenRouter
- No settings screen
- No real sidebar/chat content
- Research agents not touched until Run 6
