# Run 9 — Design System & Playwright UI Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Intellectual Indigo + Scientific Teal design system with glassmorphism overlays to the Electron app, then add four Playwright UI tests verifying core user flows.

**Architecture:** Theme lives in `theme.ts` (palette, typography, MuiPaper/MuiCard overrides); glass utility in `src/renderer/styles/glass.ts` (spread into `sx`); `_simulateEvent` test helper added to the preload (guarded by `PLAYWRIGHT_TEST=1` env var). Playwright tests launch the real Electron binary — no mocks.

**Tech Stack:** MUI v9 (`createTheme`, `styleOverrides`), `@fontsource/manrope`, `@fontsource/inter`, `@playwright/test`, `playwright` (Electron launch via `_electron`), Bun, electron-vite.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/theme.ts` | Modify | Full dark palette + Manrope/Inter typography + MuiPaper/MuiCard overrides |
| `src/renderer/App.tsx` | Modify | Import fontsource CSS; always dark (remove media query) |
| `src/renderer/styles/glass.ts` | Create | `glassSx` constant |
| `src/renderer/components/settings/SettingsModal.tsx` | Modify | `PaperProps` glassSx; data-testid |
| `src/renderer/components/layout/chat/PendingToolModal.tsx` | Modify | `PaperProps` glassSx; data-testid on Paper + Approve button |
| `src/renderer/components/layout/chat/ResearchStatusBar.tsx` | Modify | glassSx on active bar; remove borderBottom; data-testid |
| `src/renderer/components/layout/chat/PendingToolBanner.tsx` | Modify | glassSx; remove warning border/bgcolor; data-testid on banner + Review button |
| `src/renderer/components/layout/LeftSidebar.tsx` | Modify | Remove borderTop/borderBottom; bgcolor contrast; data-testid on project items + new-project btn |
| `src/renderer/components/layout/chat/MessageInput.tsx` | Modify | Remove borderTop; bgcolor contrast; data-testid on input + send btn |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | Modify | Remove border on API-key bar; bgcolor contrast |
| `src/renderer/components/layout/chat/MessageList.tsx` | Modify | data-testid on message bubbles + streaming cursor |
| `src/renderer/electron.d.ts` | Modify | Add optional `_simulateEvent` to `electronAPI` type |
| `src/preload/index.ts` | Modify | `_testListeners` map; modified `on()`; conditional `_simulateEvent` on exposed API |
| `playwright.config.ts` | Create | `testDir: ./e2e`, `timeout: 30_000`, list reporter |
| `e2e/helpers/electron.ts` | Create | `launchApp()` — launches Electron with `PLAYWRIGHT_TEST=1`, returns `{ app, page }` |
| `e2e/create-project.spec.ts` | Create | Creates project, asserts it appears in sidebar |
| `e2e/send-message.spec.ts` | Create | Sends message, asserts user bubble + streaming cursor (skips if no API key) |
| `e2e/research-result.spec.ts` | Create | Simulates `RESEARCH_STATUS_UPDATE`, asserts ResearchStatusBar renders |
| `e2e/approve-pending-tool.spec.ts` | Create | Creates real pending-tool file, approves it, asserts modal closes |

---

## Task 1: Install Dependencies

**Files:** `package.json`

- [ ] **Step 1: Install font packages**

```bash
bun add @fontsource/manrope @fontsource/inter
```

Expected: packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Install Playwright**

```bash
bun add -d @playwright/test playwright
```

Expected: packages added to `devDependencies`.

- [ ] **Step 3: Install Chromium (Playwright needs it to orchestrate Electron)**

```bash
bunx playwright install chromium
```

Expected: Chromium downloaded to Playwright cache. Output ends with "✓ chromium".

- [ ] **Step 4: Add test:e2e script to package.json**

In `package.json`, inside the `"scripts"` block, add after `"test:coverage"`:

```json
"test:e2e": "playwright test",
```

- [ ] **Step 5: Verify no typecheck regressions**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(run9): add fontsource + playwright deps"
```

---

## Task 2: Rewrite Theme

**Files:**
- Modify: `src/renderer/theme.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Rewrite `src/renderer/theme.ts`**

Replace the entire file:

```ts
import { createTheme, type Theme } from "@mui/material/styles";

const manrope = '"Manrope", system-ui, -apple-system, sans-serif';
const inter = '"Inter", system-ui, -apple-system, sans-serif';

export function createAppTheme(): Theme {
  return createTheme({
    palette: {
      mode: "dark",
      primary: {
        main: "#5C6BC0",
      },
      secondary: {
        main: "#26C6DA",
      },
      background: {
        default: "#0D0F14",
        paper: "#13161E",
      },
      text: {
        primary: "#E8EAED",
        secondary: "#8A9BB0",
      },
    },
    typography: {
      fontFamily: inter,
      h1: { fontFamily: manrope },
      h2: { fontFamily: manrope },
      h3: { fontFamily: manrope },
      h4: { fontFamily: manrope },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none", border: "none" },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { border: "none" },
        },
      },
    },
  });
}
```

- [ ] **Step 2: Update `src/renderer/App.tsx`**

Replace the entire file:

```tsx
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { useState } from "react";
import AppShell from "./components/layout/AppShell";
import SettingsModal from "./components/settings/SettingsModal";
import { ProjectProvider } from "./contexts/ProjectContext";
import { createAppTheme } from "./theme";

const theme = createAppTheme();

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ProjectProvider>
        <AppShell onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ProjectProvider>
    </ThemeProvider>
  );
}
```

Note: `theme` is moved outside the component — it's a constant, no need to recreate on render.

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/theme.ts src/renderer/App.tsx
git commit -m "feat(run9): apply dark design system — Indigo+Teal palette, Manrope+Inter fonts"
```

---

## Task 3: Glassmorphism Utility + Apply to Modals

**Files:**
- Create: `src/renderer/styles/glass.ts`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`
- Modify: `src/renderer/components/layout/chat/PendingToolModal.tsx`

- [ ] **Step 1: Create `src/renderer/styles/glass.ts`**

```ts
export const glassSx = {
  background: "rgba(19, 22, 30, 0.6)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
} as const;
```

- [ ] **Step 2: Apply glassSx to SettingsModal Dialog**

In `src/renderer/components/settings/SettingsModal.tsx`, add the import and `PaperProps`:

Add at top of imports:
```tsx
import { glassSx } from "../../styles/glass";
```

Change the `<Dialog>` opening tag from:
```tsx
<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
```
to:
```tsx
<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: glassSx }}>
```

- [ ] **Step 3: Apply glassSx to PendingToolModal Dialog**

In `src/renderer/components/layout/chat/PendingToolModal.tsx`, add the import and `PaperProps`:

Add at top of imports:
```tsx
import { glassSx } from "../../../styles/glass";
```

Change the `<Dialog>` opening tag from:
```tsx
<Dialog open onClose={onClose} maxWidth="md" fullWidth>
```
to:
```tsx
<Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: glassSx }}>
```

- [ ] **Step 4: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/glass.ts src/renderer/components/settings/SettingsModal.tsx src/renderer/components/layout/chat/PendingToolModal.tsx
git commit -m "feat(run9): add glassSx utility, apply glass to SettingsModal + PendingToolModal"
```

---

## Task 4: Apply Glass to Status Bars + Remove Their Borders

**Files:**
- Modify: `src/renderer/components/layout/chat/ResearchStatusBar.tsx`
- Modify: `src/renderer/components/layout/chat/PendingToolBanner.tsx`

- [ ] **Step 1: Update ResearchStatusBar**

Replace the entire file `src/renderer/components/layout/chat/ResearchStatusBar.tsx`:

```tsx
import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { glassSx } from "../../../styles/glass";

interface ResearchState {
  active: boolean;
  message: string;
  doneMessage: string | null;
}

export default function ResearchStatusBar() {
  const [state, setState] = useState<ResearchState>({
    active: false,
    message: "",
    doneMessage: null,
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clearTimers = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };

    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data) => {
      const d = data as { status: string; message?: string; query?: string };
      if (d.status === "started") {
        setState({ active: true, message: "Research started…", doneMessage: null });
      } else if (d.status === "progress" && d.message) {
        setState((prev) => ({ ...prev, message: d.message ?? prev.message }));
      } else if (d.status === "failed") {
        setState({ active: false, message: "", doneMessage: "Research failed." });
        timers.current.push(setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000));
      }
    });

    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data) => {
      const d = data as { query: string };
      setState({ active: false, message: "", doneMessage: `Done: ${d.query}` });
      timers.current.push(setTimeout(() => setState((s) => ({ ...s, doneMessage: null })), 3000));
    });

    return () => {
      unsubUpdate();
      unsubComplete();
      clearTimers();
    };
  }, []);

  if (!state.active && !state.doneMessage) {
    return <Box sx={{ minHeight: 40 }} />;
  }

  return (
    <Box
      data-testid="research-status-bar"
      sx={{
        ...glassSx,
        px: 2,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 1,
        minHeight: 40,
      }}
    >
      {state.active && <CircularProgress size={14} />}
      <Typography variant="caption" color="text.secondary" noWrap>
        {state.doneMessage ?? state.message}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Update PendingToolBanner**

Replace the entire file `src/renderer/components/layout/chat/PendingToolBanner.tsx`:

```tsx
import { Box, Button, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { glassSx } from "../../../styles/glass";
import PendingToolModal from "./PendingToolModal";

interface PendingTool {
  name: string;
  skillContent: string;
}

export default function PendingToolBanner() {
  const [pendingTools, setPendingTools] = useState<PendingTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    window.electronAPI
      .invoke(IPC.GET_PENDING_TOOLS)
      .then((tools) => setPendingTools(tools as PendingTool[]));

    const unsub = window.electronAPI.on(IPC.TOOL_PENDING, (data) => {
      const tool = data as PendingTool;
      setPendingTools((prev) => {
        if (prev.some((t) => t.name === tool.name)) return prev;
        return [...prev, tool];
      });
    });

    return unsub;
  }, []);

  const handleApprove = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.REJECT_TOOL, { name: tool.name });
    setPendingTools((prev) => prev.filter((t) => t.name !== tool.name));
    setSelectedTool(null);
  };

  if (pendingTools.length === 0) return null;

  return (
    <>
      {pendingTools.map((tool) => (
        <Box
          key={tool.name}
          data-testid="pending-tool-banner"
          sx={{
            ...glassSx,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography variant="caption" sx={{ flex: 1 }}>
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </Typography>
          <Button size="small" data-testid="review-tool-btn" onClick={() => setSelectedTool(tool)}>
            Review
          </Button>
        </Box>
      ))}
      {selectedTool && (
        <PendingToolModal
          tool={selectedTool}
          onApprove={() => handleApprove(selectedTool)}
          onReject={() => handleReject(selectedTool)}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/ResearchStatusBar.tsx src/renderer/components/layout/chat/PendingToolBanner.tsx
git commit -m "feat(run9): apply glass to ResearchStatusBar + PendingToolBanner, remove container borders"
```

---

## Task 5: Remove Remaining Container Borders

**Files:**
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`

- [ ] **Step 1: Update LeftSidebar — remove borders, use bgcolor contrast, add data-testids**

Replace the entire file `src/renderer/components/layout/LeftSidebar.tsx`:

```tsx
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";

interface LeftSidebarProps {
  onOpenSettings: () => void;
}

export default function LeftSidebar({ onOpenSettings }: LeftSidebarProps) {
  const { activeProjectId, setActiveProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p as Project[]));
  }, []);

  const handleBrowseFolder = async () => {
    const path = await window.electronAPI.invoke(IPC.OPEN_FOLDER_DIALOG);
    setNewFolderPath(path as string | null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const project = (await window.electronAPI.invoke(IPC.CREATE_PROJECT, {
      name,
      folderPath: newFolderPath,
    })) as Project;
    setProjects((prev) => [...prev, project]);
    setNewName("");
    setNewFolderPath(null);
    setCreating(false);
    setActiveProjectId(project.id);
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.paper" }}>
      <Box sx={{ px: 2, py: 1.5, bgcolor: "background.default" }}>
        <Typography variant="subtitle2" color="text.secondary">
          Projects
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List dense disablePadding>
          {projects.map((p) => (
            <ListItemButton
              key={p.id}
              data-testid="project-item"
              selected={p.id === activeProjectId}
              onClick={() => setActiveProjectId(p.id)}
            >
              <ListItemText
                primary={p.name}
                slotProps={{ primary: { variant: "body2", noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ px: 1, py: 0.5 }}>
          {creating ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Project name"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setNewFolderPath(null);
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) {
                    setCreating(false);
                    setNewFolderPath(null);
                  }
                }}
              />
              <Button
                size="small"
                startIcon={<FolderOpenIcon />}
                onClick={handleBrowseFolder}
                sx={{ justifyContent: "flex-start" }}
              >
                {newFolderPath ? newFolderPath.split("/").pop() : "Link folder (optional)"}
              </Button>
              {newFolderPath && (
                <Chip
                  label={newFolderPath}
                  size="small"
                  onDelete={() => setNewFolderPath(null)}
                  sx={{ maxWidth: "100%", fontSize: 10 }}
                />
              )}
            </Box>
          ) : (
            <Button
              size="small"
              startIcon={<AddIcon />}
              data-testid="new-project-btn"
              onClick={() => setCreating(true)}
              fullWidth
              sx={{ justifyContent: "flex-start" }}
            >
              New project
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ p: 1, bgcolor: "background.default" }}>
        <IconButton size="small" onClick={onOpenSettings} title="Settings">
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Update MessageInput — remove borderTop, add bgcolor + data-testids**

Replace the entire file `src/renderer/components/layout/chat/MessageInput.tsx`:

```tsx
import SendIcon from "@mui/icons-material/Send";
import { Box, IconButton, MenuItem, Select, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";

const MODELS = [
  { id: "anthropic/claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "anthropic/claude-opus-4-6", label: "Opus 4.6" },
  { id: "anthropic/claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
];

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { model: string };
      setModel(settings.model);
    });
  }, []);

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    await window.electronAPI.invoke(IPC.SAVE_SETTINGS, { model: newModel });
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setContent("");
  };

  return (
    <Box
      sx={{
        p: 1.5,
        display: "flex",
        gap: 1,
        alignItems: "flex-end",
        bgcolor: "background.paper",
      }}
    >
      <Select
        size="small"
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
        sx={{ minWidth: 130, flexShrink: 0 }}
      >
        {MODELS.map((m) => (
          <MenuItem key={m.id} value={m.id}>
            {m.label}
          </MenuItem>
        ))}
      </Select>

      <TextField
        multiline
        maxRows={6}
        fullWidth
        size="small"
        placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
        slotProps={{ htmlInput: { "data-testid": "message-input" } }}
      />

      <IconButton
        onClick={handleSend}
        disabled={!content.trim() || disabled}
        color="primary"
        size="small"
        data-testid="send-btn"
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
```

- [ ] **Step 3: Update ChatPanel — remove border on API key bar**

In `src/renderer/components/layout/chat/ChatPanel.tsx`, find:

```tsx
<Box sx={{ p: 2, textAlign: "center", borderTop: 1, borderColor: "divider" }}>
```

Replace with:

```tsx
<Box sx={{ p: 2, textAlign: "center", bgcolor: "background.paper" }}>
```

- [ ] **Step 4: Verify typecheck + lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors, zero lint warnings.

- [ ] **Step 5: Commit design system complete**

```bash
git add src/renderer/components/layout/LeftSidebar.tsx src/renderer/components/layout/chat/MessageInput.tsx src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "feat(run9): remove container borders, add bgcolor contrast, add data-testid attributes"
```

---

## Task 6: Add data-testid Attributes to MessageList

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`

- [ ] **Step 1: Add data-testid to message bubbles and streaming cursor**

Replace the entire file `src/renderer/components/layout/chat/MessageList.tsx`:

```tsx
import { Box, Paper, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";

interface MessageListProps {
  messages: Message[];
  streamingContent: string | null;
}

export default function MessageList({ messages, streamingContent }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when messages or streaming content changes to auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: "auto",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {messages.map((msg) => (
        <Box
          key={msg.id}
          data-testid="message-bubble"
          sx={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "75%",
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: msg.role === "user" ? "primary.main" : "action.selected",
              borderRadius: 2,
            }}
          >
            <Typography
              variant="body2"
              color={msg.role === "user" ? "primary.contrastText" : "text.primary"}
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {msg.content}
            </Typography>
          </Paper>
        </Box>
      ))}

      {streamingContent !== null && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "75%" }}>
          <Paper elevation={0} sx={{ p: 1.5, bgcolor: "action.selected", borderRadius: 2 }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {streamingContent}
              <Box
                component="span"
                data-testid="streaming-cursor"
                sx={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  bgcolor: "text.primary",
                  ml: 0.5,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                  "@keyframes blink": { "50%": { opacity: 0 } },
                }}
              />
            </Typography>
          </Paper>
        </Box>
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
```

- [ ] **Step 2: Add data-testid to PendingToolModal Paper + Approve button**

In `src/renderer/components/layout/chat/PendingToolModal.tsx`, change `PaperProps` to include `data-testid`:

```tsx
<Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: glassSx, "data-testid": "pending-tool-modal" }}>
```

And add `data-testid` to the Approve button:

```tsx
<Button onClick={onApprove} variant="contained" data-testid="approve-tool-btn">
  Approve
</Button>
```

- [ ] **Step 3: Verify typecheck + lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx src/renderer/components/layout/chat/PendingToolModal.tsx
git commit -m "feat(run9): add data-testid attributes for Playwright tests"
```

---

## Task 7: Preload _simulateEvent Helper

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/electron.d.ts`

- [ ] **Step 1: Update `src/renderer/electron.d.ts`**

Replace the entire file:

```ts
import type { IpcChannel } from "../shared/ipc-channels";

declare global {
  interface Window {
    electronAPI: {
      send(channel: IpcChannel, data?: unknown): void;
      invoke(channel: IpcChannel, data?: unknown): Promise<unknown>;
      on(channel: IpcChannel, callback: (data: unknown) => void): () => void;
      /** Test-only: fires registered on() listeners for the given channel without going through IPC. Only present when PLAYWRIGHT_TEST=1. */
      _simulateEvent?: (channel: string, payload: unknown) => void;
    };
  }
}
```

- [ ] **Step 2: Update `src/preload/index.ts`**

Replace the entire file:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcChannel } from "../shared/ipc-channels";

const ALLOWED_CHANNELS = Object.values(IPC) as IpcChannel[];

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.includes(channel as IpcChannel)) {
    throw new Error(`[preload] Channel "${channel}" is not whitelisted`);
  }
}

// Parallel listener registry used by _simulateEvent in tests.
// Populated only when PLAYWRIGHT_TEST=1.
const _testListeners = new Map<string, Array<(data: unknown) => void>>();

const isTestMode = process.env["PLAYWRIGHT_TEST"] === "1";

const baseApi = {
  send(channel: IpcChannel, data?: unknown): void {
    assertAllowed(channel);
    ipcRenderer.send(channel, data);
  },

  invoke(channel: IpcChannel, data?: unknown): Promise<unknown> {
    assertAllowed(channel);
    return ipcRenderer.invoke(channel, data);
  },

  on(channel: IpcChannel, callback: (data: unknown) => void): () => void {
    assertAllowed(channel);
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(channel, handler);

    if (isTestMode) {
      const list = _testListeners.get(channel) ?? [];
      list.push(callback);
      _testListeners.set(channel, list);
    }

    return () => {
      ipcRenderer.removeListener(channel, handler);
      const list = _testListeners.get(channel);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  },
};

const api = isTestMode
  ? {
      ...baseApi,
      _simulateEvent(channel: string, payload: unknown): void {
        const list = _testListeners.get(channel) ?? [];
        for (const cb of list) cb(payload);
      },
    }
  : baseApi;

contextBridge.exposeInMainWorld("electronAPI", api);
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/electron.d.ts
git commit -m "feat(run9): add _simulateEvent test helper to preload (PLAYWRIGHT_TEST=1 only)"
```

---

## Task 8: Playwright Config + Launch Helper

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/helpers/electron.ts`

- [ ] **Step 1: Create `playwright.config.ts` at repo root**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
});
```

- [ ] **Step 2: Create `e2e/helpers/electron.ts`**

```ts
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
}

export async function launchApp(): Promise<AppHandle> {
  const app = await electron.launch({
    args: [path.join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, PLAYWRIGHT_TEST: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: zero errors. (TypeScript will check `e2e/` if it's included in `tsconfig.json` — if it errors due to the `e2e/` dir not being in include, add `"e2e"` to the `include` array in `tsconfig.json`.)

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e/helpers/electron.ts
git commit -m "test(run9): add Playwright config and Electron launch helper"
```

---

## Task 9: Build App for Playwright

Before tests can run, the app must be built — Playwright launches `out/main/index.js`.

**Files:** none (build output only)

- [ ] **Step 1: Build the app**

```bash
bun run build
```

Expected: `out/main/index.js`, `out/preload/index.js`, `out/renderer/` all generated. No build errors.

- [ ] **Step 2: Verify `out/main/index.js` exists**

```bash
ls out/main/index.js
```

Expected: file exists.

---

## Task 10: create-project Test

**Files:**
- Create: `e2e/create-project.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/electron";

test("create project appears in sidebar", async () => {
  const { app, page } = await launchApp();

  try {
    await page.getByTestId("new-project-btn").click();
    await page.getByPlaceholder("Project name").fill("E2E Test Project");
    await page.keyboard.press("Enter");

    await expect(
      page.getByTestId("project-item").filter({ hasText: "E2E Test Project" }),
    ).toBeVisible();
  } finally {
    await app.close().catch(() => {});
  }
});
```

- [ ] **Step 2: Run the test**

```bash
PLAYWRIGHT_TEST=1 bunx playwright test e2e/create-project.spec.ts --reporter=list
```

Expected: `1 passed`.

If it fails with "new-project-btn not found": verify `data-testid="new-project-btn"` was added in Task 5.
If it fails with "Target closed": check that `out/main/index.js` exists (run `bun run build` again).

- [ ] **Step 3: Commit**

```bash
git add e2e/create-project.spec.ts
git commit -m "test(run9): add create-project Playwright test"
```

---

## Task 11: send-message Test

**Files:**
- Create: `e2e/send-message.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/electron";

test("user message appears after send", async () => {
  const { app, page } = await launchApp();

  try {
    // Skip if no API key configured
    const settings = (await page.evaluate(() =>
      window.electronAPI.invoke("GET_SETTINGS"),
    )) as { hasApiKey: boolean };

    if (!settings.hasApiKey) {
      test.skip();
      return;
    }

    // Create and select a project
    await page.getByTestId("new-project-btn").click();
    await page.getByPlaceholder("Project name").fill("Send Test");
    await page.keyboard.press("Enter");
    await page.getByTestId("project-item").filter({ hasText: "Send Test" }).click();

    // Type and send a message
    await page.getByTestId("message-input").fill("Hello agent");
    await page.getByTestId("send-btn").click();

    // User message bubble appears
    await expect(
      page.getByTestId("message-bubble").filter({ hasText: "Hello agent" }),
    ).toBeVisible();

    // Streaming cursor appears while response generates
    await expect(page.getByTestId("streaming-cursor")).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => {});
  }
});
```

- [ ] **Step 2: Run the test**

```bash
PLAYWRIGHT_TEST=1 bunx playwright test e2e/send-message.spec.ts --reporter=list
```

Expected: `1 passed` (or `1 skipped` if no API key in `settings.json`). Either is a passing result for CI.

- [ ] **Step 3: Commit**

```bash
git add e2e/send-message.spec.ts
git commit -m "test(run9): add send-message Playwright test"
```

---

## Task 12: research-result Test

**Files:**
- Create: `e2e/research-result.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/electron";

test("ResearchStatusBar renders on RESEARCH_STATUS_UPDATE event", async () => {
  const { app, page } = await launchApp();

  try {
    // Create and select a project — mounts ChatPanel which mounts ResearchStatusBar
    await page.getByTestId("new-project-btn").click();
    await page.getByPlaceholder("Project name").fill("Research Test");
    await page.keyboard.press("Enter");
    await page.getByTestId("project-item").filter({ hasText: "Research Test" }).click();

    // Simulate RESEARCH_STATUS_UPDATE from main process
    await page.evaluate(() => {
      window.electronAPI._simulateEvent?.("RESEARCH_STATUS_UPDATE", {
        status: "started",
      });
    });

    // ResearchStatusBar becomes visible with expected text
    await expect(page.getByTestId("research-status-bar")).toBeVisible();
    await expect(page.getByTestId("research-status-bar")).toContainText("Research started");
  } finally {
    await app.close().catch(() => {});
  }
});
```

- [ ] **Step 2: Run the test**

```bash
PLAYWRIGHT_TEST=1 bunx playwright test e2e/research-result.spec.ts --reporter=list
```

Expected: `1 passed`.

If it fails with "research-status-bar not found": the bar shows with `data-testid` only when `active === true`. The `status: "started"` event sets `active: true` — verify the `_simulateEvent` fires correctly by checking the preload build output.

- [ ] **Step 3: Commit**

```bash
git add e2e/research-result.spec.ts
git commit -m "test(run9): add research-result Playwright test"
```

---

## Task 13: approve-pending-tool Test

**Files:**
- Create: `e2e/approve-pending-tool.spec.ts`

This test creates a real pending-tool file on disk (via main process context), loads the app so `PendingToolBanner` reads it from disk on mount, then approves it through the UI.

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/electron";

const TOOL_NAME = "e2e-test-tool";

test("approve pending tool — banner shows, modal opens, approve dismisses", async () => {
  const { app, page } = await launchApp();

  try {
    // Create the pending-tool file in the main process before mounting PendingToolBanner
    await app.evaluate(async () => {
      const path = require("path") as typeof import("path");
      const fs = require("fs/promises") as typeof import("fs/promises");
      const os = require("os") as typeof import("os");

      const toolDir = path.join(
        os.homedir(),
        ".research-assistant",
        "pending-tools",
        "e2e-test-tool",
      );
      await fs.mkdir(toolDir, { recursive: true });
      await fs.writeFile(
        path.join(toolDir, "SKILL.md"),
        "# E2E Test Tool\n\nA tool created by the Playwright test suite.",
      );
    });

    // Create and select a project — mounts PendingToolBanner which calls GET_PENDING_TOOLS
    await page.getByTestId("new-project-btn").click();
    await page.getByPlaceholder("Project name").fill("Tool Test");
    await page.keyboard.press("Enter");
    await page.getByTestId("project-item").filter({ hasText: "Tool Test" }).click();

    // Banner should be visible (loaded from disk on mount)
    await expect(
      page.getByTestId("pending-tool-banner").filter({ hasText: "e2e-test-tool" }),
    ).toBeVisible();

    // Click Review to open modal
    await page.getByTestId("review-tool-btn").first().click();

    // Modal is visible with tool name
    await expect(page.getByTestId("pending-tool-modal")).toBeVisible();
    await expect(page.getByTestId("pending-tool-modal")).toContainText("e2e-test-tool");

    // Approve
    await page.getByTestId("approve-tool-btn").click();

    // Modal closes
    await expect(page.getByTestId("pending-tool-modal")).not.toBeVisible({ timeout: 3_000 });
  } finally {
    // Cleanup: remove the tool from both pending-tools/ and skills/ (approve moves it)
    await app.evaluate(async () => {
      const path = require("path") as typeof import("path");
      const fs = require("fs/promises") as typeof import("fs/promises");
      const os = require("os") as typeof import("os");

      const home = path.join(os.homedir(), ".research-assistant");
      await fs.rm(path.join(home, "pending-tools", "e2e-test-tool"), {
        recursive: true,
        force: true,
      });
      await fs.rm(path.join(home, "skills", "e2e-test-tool"), {
        recursive: true,
        force: true,
      });
    }).catch(() => {});

    await app.close().catch(() => {});
  }
});
```

- [ ] **Step 2: Run the test**

```bash
PLAYWRIGHT_TEST=1 bunx playwright test e2e/approve-pending-tool.spec.ts --reporter=list
```

Expected: `1 passed`.

If it fails with "pending-tool-banner not found": the banner renders `null` when `pendingTools.length === 0`. Check that `GET_PENDING_TOOLS` IPC handler reads from `~/.research-assistant/pending-tools/` and returns the tool. If the home dir doesn't exist yet (first run flow hasn't completed), the IPC handler may return an empty array — in that case, ensure `~/.research-assistant/pending-tools/` is created by the mkdir in the test setup step.

- [ ] **Step 3: Commit**

```bash
git add e2e/approve-pending-tool.spec.ts
git commit -m "test(run9): add approve-pending-tool Playwright test"
```

---

## Task 14: Full Test Suite + Final Verification

- [ ] **Step 1: Run full Playwright suite**

```bash
PLAYWRIGHT_TEST=1 bunx playwright test --reporter=list
```

Expected:
```
create-project.spec.ts    1 passed
send-message.spec.ts      1 passed  (or 1 skipped — both acceptable)
research-result.spec.ts   1 passed
approve-pending-tool.spec.ts  1 passed
```

- [ ] **Step 2: Run unit tests to confirm no regressions**

```bash
bun run test
```

Expected: all existing tests pass (182+).

- [ ] **Step 3: Run typecheck + lint**

```bash
bun run typecheck && bun run check
```

Expected: zero errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(run9): complete design system + Playwright UI tests"
```

---

## Self-Review Notes

- All four Playwright scenarios from the spec are covered: create-project, send-message, research-result, approve-pending-tool.
- send-message skips gracefully when no API key — no hard failure in CI.
- approve-pending-tool uses real disk files and real IPC — consistent with the project's no-mocks stance.
- `_simulateEvent` is dead code in production builds (the branch is never taken when `PLAYWRIGHT_TEST !== '1'`); the API shape differs (optional property) so no runtime breakage.
- The theme signature change (`createAppTheme()` → no args) affects only `App.tsx`, which is updated in Task 2.
- `out/` build artifacts are not committed (verify `.gitignore` includes `out/`).
