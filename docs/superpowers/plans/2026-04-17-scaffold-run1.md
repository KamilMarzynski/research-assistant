# Research Assistant Scaffold — Run 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a runnable Electron desktop app with a 3-column placeholder AppShell, correct TypeScript/Biome config, typed IPC stubs, and a clean verification gate.

**Architecture:** Three-process Electron app — main (Node.js/TypeScript), preload (contextBridge), renderer (React + MUI). No agent logic, no DB, no real IPC responses. All services are stubs. Streaming IPC pattern is established via `ipcMain.on` + `webContents.send` for future use.

**Tech Stack:** Bun, Electron, electron-vite, React, MUI v6, TypeScript strict, Biome

---

## File Map

| File | Purpose |
|---|---|
| `package.json` | Bun project manifest, scripts |
| `tsconfig.json` | Root TS config used by `tsc --noEmit` |
| `tsconfig.node.json` | Main + preload build config for electron-vite |
| `tsconfig.web.json` | Renderer build config for electron-vite |
| `biome.json` | Linting + formatting config |
| `electron.vite.config.ts` | Build config for all three Electron processes |
| `src/shared/ipc-channels.ts` | Typed IPC channel constants shared by main + renderer |
| `src/main/index.ts` | Electron entry — BrowserWindow + lifecycle |
| `src/main/ipc-handlers.ts` | ipcMain registrations, stub responses |
| `src/preload/index.ts` | contextBridge → `window.electronAPI` |
| `src/renderer/index.html` | HTML shell |
| `src/renderer/main.tsx` | React entry point |
| `src/renderer/theme.ts` | MUI theme factory |
| `src/renderer/App.tsx` | ThemeProvider + AppShell |
| `src/renderer/components/layout/AppShell.tsx` | 3-column flex layout |
| `src/renderer/components/layout/LeftSidebar.tsx` | Placeholder |
| `src/renderer/components/layout/RightSidebar.tsx` | Placeholder |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Placeholder |
| `src/renderer/components/layout/chat/MessageList.tsx` | Placeholder |
| `src/renderer/components/layout/chat/MessageInput.tsx` | Placeholder |
| `src/renderer/components/layout/chat/ResearchStatusBar.tsx` | Placeholder |
| `src/renderer/components/layout/artifacts/ArtifactPanel.tsx` | Placeholder |

---

> **Note on TDD:** This task group is pure scaffolding — configuration files, type definitions, and placeholder UI. There is no business logic to unit test. The verification gate (Task 10) acts as the integration test: the app must run, type-check, and lint clean.

---

### Task 1: package.json + Folder Structure

**Files:**
- Create: `package.json`
- Create dirs: `src/main/`, `src/preload/`, `src/renderer/components/layout/chat/`, `src/renderer/components/layout/artifacts/`, `src/shared/`

- [ ] **Step 1: Create folder structure**

```bash
cd /Users/mayk/Projects/private/research-assistant
mkdir -p src/main src/preload src/shared
mkdir -p src/renderer/components/layout/chat
mkdir -p src/renderer/components/layout/artifacts
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "research-assistant",
  "version": "0.1.0",
  "description": "Event-driven desktop research assistant",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "biome lint ./src",
    "format": "biome format --write ./src",
    "check": "biome check --write ./src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {},
  "dependencies": {}
}
```

- [ ] **Step 3: Install dev dependencies**

```bash
bun add -d electron electron-vite typescript @biomejs/biome @types/react @types/react-dom @types/node @vitejs/plugin-react
```

- [ ] **Step 4: Install runtime dependencies**

```bash
bun add react react-dom @mui/material @mui/icons-material @emotion/react @emotion/styled @fontsource/roboto
```

- [ ] **Step 5: Verify installs**

```bash
bun run --help 2>/dev/null; cat package.json | grep -E '"electron"|"react"|"@mui"'
```

Expected: version strings present for all three packages.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: initialize project and install dependencies"
```

---

### Task 2: TypeScript Configuration

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`

- [ ] **Step 1: Write tsconfig.json** (root — used by `tsc --noEmit` for type checking all files)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "paths": {
      "@main/*": ["./src/main/*"],
      "@renderer/*": ["./src/renderer/*"],
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src", "electron.vite.config.ts"]
}
```

- [ ] **Step 2: Write tsconfig.node.json** (used by electron-vite for main + preload builds)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "module": "CommonJS",
    "moduleResolution": "node10",
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "out/main"
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "electron.vite.config.ts"
  ]
}
```

- [ ] **Step 3: Write tsconfig.web.json** (used by electron-vite for renderer build)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "types": [],
    "outDir": "out/renderer"
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json tsconfig.node.json tsconfig.web.json
git commit -m "chore: add TypeScript configuration"
```

---

### Task 3: Biome Configuration

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Write biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignore": ["dist/**", "out/**", "node_modules/**", "**/*.d.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  }
}
```

- [ ] **Step 2: Verify Biome runs (no src files yet — expect "no files processed")**

```bash
bun run check
```

Expected: exits 0, prints something like `Checked 0 file(s)` or processes only existing files.

- [ ] **Step 3: Commit**

```bash
git add biome.json
git commit -m "chore: add Biome linting and formatting config"
```

---

### Task 4: electron-vite Config

**Files:**
- Create: `electron.vite.config.ts`

- [ ] **Step 1: Write electron.vite.config.ts**

```ts
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add electron.vite.config.ts
git commit -m "chore: add electron-vite build config"
```

---

### Task 5: Shared IPC Channels

**Files:**
- Create: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Write src/shared/ipc-channels.ts**

```ts
export const IPC = {
  // renderer → main (invoke — request/response)
  GET_PROJECTS: "GET_PROJECTS",
  CREATE_PROJECT: "CREATE_PROJECT",
  GET_ARTIFACTS: "GET_ARTIFACTS",

  // renderer → main (send — fire-and-forget)
  SEND_MESSAGE: "SEND_MESSAGE",

  // main → renderer (push via webContents.send)
  MESSAGE_CHUNK: "MESSAGE_CHUNK",
  MESSAGE_DONE: "MESSAGE_DONE",
  NEW_MESSAGE: "NEW_MESSAGE",
  RESEARCH_STATUS_UPDATE: "RESEARCH_STATUS_UPDATE",
  RESEARCH_COMPLETE: "RESEARCH_COMPLETE",
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat: add typed IPC channel constants"
```

---

### Task 6: Electron Main Process

**Files:**
- Create: `src/main/index.ts`
- Create: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Write src/main/ipc-handlers.ts**

```ts
import { type BrowserWindow, ipcMain } from "electron"
import { IPC } from "../shared/ipc-channels"

export function registerIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(IPC.GET_PROJECTS, (_event, payload: unknown) => {
    console.log("[IPC] GET_PROJECTS called with:", payload)
    return []
  })

  ipcMain.handle(IPC.CREATE_PROJECT, (_event, payload: unknown) => {
    console.log("[IPC] CREATE_PROJECT called with:", payload)
    return {
      id: "mock-1",
      name: "Mock Project",
      createdAt: new Date().toISOString(),
    }
  })

  ipcMain.handle(IPC.GET_ARTIFACTS, (_event, payload: unknown) => {
    console.log("[IPC] GET_ARTIFACTS called with:", payload)
    return []
  })

  ipcMain.on(IPC.SEND_MESSAGE, (_event, payload: unknown) => {
    console.log("[IPC] SEND_MESSAGE called with:", payload)
    // TODO(run-5): route to OpenRouter via Mastra agent, stream chunks back via MESSAGE_CHUNK
  })
}
```

- [ ] **Step 2: Write src/main/index.ts**

```ts
import { join } from "path"
import { BrowserWindow, app } from "electron"
import { registerIpcHandlers } from "./ipc-handlers"

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return win
}

app.whenReady().then(() => {
  const win = createWindow()
  registerIpcHandlers(win)

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      registerIpcHandlers(newWin)
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/main/ipc-handlers.ts
git commit -m "feat: add Electron main process and IPC handler stubs"
```

---

### Task 7: Preload Script

**Files:**
- Create: `src/preload/index.ts`

- [ ] **Step 1: Write src/preload/index.ts**

```ts
import { contextBridge, ipcRenderer } from "electron"
import { IPC, type IpcChannel } from "../shared/ipc-channels"

const ALLOWED_CHANNELS = Object.values(IPC) as IpcChannel[]

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.includes(channel as IpcChannel)) {
    throw new Error(`[preload] Channel "${channel}" is not whitelisted`)
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  send(channel: string, data?: unknown): void {
    assertAllowed(channel)
    ipcRenderer.send(channel, data)
  },

  invoke(channel: string, data?: unknown): Promise<unknown> {
    assertAllowed(channel)
    return ipcRenderer.invoke(channel, data)
  },

  on(channel: string, callback: (data: unknown) => void): () => void {
    assertAllowed(channel)
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(channel, handler)
    // Returns an unsubscribe function — call it to clean up listeners
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: add preload contextBridge with whitelisted IPC channels"
```

---

### Task 8: Renderer HTML + Entry

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`

- [ ] **Step 1: Write src/renderer/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <title>Research Assistant</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write src/renderer/main.tsx**

```tsx
import "@fontsource/roboto/300.css"
import "@fontsource/roboto/400.css"
import "@fontsource/roboto/500.css"
import "@fontsource/roboto/700.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("#root element not found in index.html")

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html src/renderer/main.tsx
git commit -m "feat: add renderer HTML shell and React entry point"
```

---

### Task 9: MUI Theme + App Root

**Files:**
- Create: `src/renderer/theme.ts`
- Create: `src/renderer/App.tsx`

- [ ] **Step 1: Write src/renderer/theme.ts**

```ts
import { createTheme, type Theme } from "@mui/material/styles"

export function createAppTheme(mode: "light" | "dark"): Theme {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#3F51B5",
      },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
    shape: {
      borderRadius: 12,
    },
  })
}
```

- [ ] **Step 2: Write src/renderer/App.tsx**

```tsx
import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material"
import AppShell from "./components/layout/AppShell"
import { createAppTheme } from "./theme"

export default function App() {
  const isDark = useMediaQuery("(prefers-color-scheme: dark)")
  const theme = createAppTheme(isDark ? "dark" : "light")

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppShell />
    </ThemeProvider>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/theme.ts src/renderer/App.tsx
git commit -m "feat: add MUI theme factory and App root component"
```

---

### Task 10: AppShell Layout

**Files:**
- Create: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Write src/renderer/components/layout/AppShell.tsx**

```tsx
import { Box } from "@mui/material"
import ArtifactPanel from "./artifacts/ArtifactPanel"
import ChatPanel from "./chat/ChatPanel"
import LeftSidebar from "./LeftSidebar"
import RightSidebar from "./RightSidebar"

export default function AppShell() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Box sx={{ width: 240, flexShrink: 0, height: "100%" }}>
        <LeftSidebar />
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden", height: "100%" }}>
        <ChatPanel />
      </Box>
      <Box
        sx={{
          width: 320,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <RightSidebar />
        <ArtifactPanel />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/layout/AppShell.tsx
git commit -m "feat: add 3-column AppShell layout"
```

---

### Task 11: Placeholder Components

**Files:**
- Create: `src/renderer/components/layout/LeftSidebar.tsx`
- Create: `src/renderer/components/layout/RightSidebar.tsx`
- Create: `src/renderer/components/layout/chat/ChatPanel.tsx`
- Create: `src/renderer/components/layout/chat/MessageList.tsx`
- Create: `src/renderer/components/layout/chat/MessageInput.tsx`
- Create: `src/renderer/components/layout/chat/ResearchStatusBar.tsx`
- Create: `src/renderer/components/layout/artifacts/ArtifactPanel.tsx`

- [ ] **Step 1: Write src/renderer/components/layout/LeftSidebar.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function LeftSidebar() {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Left Sidebar
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 2: Write src/renderer/components/layout/RightSidebar.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function RightSidebar() {
  return (
    <Box
      sx={{
        height: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.selected",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Right Sidebar
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 3: Write src/renderer/components/layout/chat/ChatPanel.tsx**

```tsx
import { Box, Typography } from "@mui/material"
import MessageInput from "./MessageInput"
import MessageList from "./MessageList"
import ResearchStatusBar from "./ResearchStatusBar"

export default function ChatPanel() {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <ResearchStatusBar />
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <MessageList />
      </Box>
      <MessageInput />
    </Box>
  )
}
```

- [ ] **Step 4: Write src/renderer/components/layout/chat/MessageList.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function MessageList() {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Message List
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 5: Write src/renderer/components/layout/chat/MessageInput.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function MessageInput() {
  return (
    <Box
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 64,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Message Input
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 6: Write src/renderer/components/layout/chat/ResearchStatusBar.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function ResearchStatusBar() {
  return (
    <Box
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        minHeight: 40,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Research Status Bar
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 7: Write src/renderer/components/layout/artifacts/ArtifactPanel.tsx**

```tsx
import { Box, Typography } from "@mui/material"

export default function ArtifactPanel() {
  return (
    <Box
      sx={{
        height: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Artifact Panel
      </Typography>
    </Box>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/
git commit -m "feat: add placeholder UI components for all layout regions"
```

---

### Task 12: Verification Gate

No new files. Runs checks on what was built.

- [ ] **Step 1: Run TypeScript type check**

```bash
bun run typecheck
```

Expected: exits 0, zero errors. If errors appear, fix them before proceeding — do not skip.

- [ ] **Step 2: Run Biome check**

```bash
bun run check
```

Expected: exits 0, zero lint errors, zero format issues. If issues appear, run `bun run format` first then re-run `bun run check`.

- [ ] **Step 3: Start the app**

```bash
bun run dev
```

Expected: Electron window opens showing three columns — Left Sidebar (240px), Chat Panel (flex), Right Sidebar (320px). Each column shows its label text.

- [ ] **Step 4: Verify electronAPI in DevTools**

Open DevTools in the Electron window: `View → Toggle Developer Tools` (or Cmd+Option+I / Ctrl+Shift+I).

In the Console tab, type:
```js
window.electronAPI
```

Expected: object with `send`, `invoke`, `on` methods visible. Must not be `undefined`.

- [ ] **Step 5: Verify hot reload**

With `bun run dev` still running, open `src/renderer/App.tsx` and change any visible text (e.g., temporarily add a `<Typography>` to `AppShell`). Save the file.

Expected: renderer updates in the Electron window within 1-2 seconds without a full Electron restart (Vite HMR).

Revert the test change after confirming.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: Run 1 scaffold complete — Electron window running, typecheck and Biome clean"
```

---

## Checklist Summary

| Check | Command | Expected |
|---|---|---|
| Types | `bun run typecheck` | Zero errors |
| Lint/format | `bun run check` | Zero issues |
| App runs | `bun run dev` | Electron window with 3-column AppShell |
| IPC bridge | `window.electronAPI` in DevTools | Object with send/invoke/on |
| Hot reload | Edit + save renderer file | UI updates without restart |
