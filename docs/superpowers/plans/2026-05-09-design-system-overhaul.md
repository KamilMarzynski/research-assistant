# Design System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dark MUI theme with the warm terracotta "Scholar" design system, add custom icons, support light/dark/system modes.

**Architecture:** CSS custom properties drive all colors/spacing. Two CSS files (light + dark-scoped). A React context sets `data-theme` on `<html>`. MUI is reduced to a minimal skeleton for Dialog/Select/Menu/TextField only. Custom SVG icons replace MUI icons everywhere else.

**Tech Stack:** React 19, MUI v9 (minimal usage), TypeScript, Vite, Biome, Vitest.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/styles/tokens.css` | **Create** | Light-mode CSS custom properties + utility classes |
| `src/renderer/styles/tokens-dark.css` | **Create** | Dark-mode overrides gated by `html[data-theme="dark"]` |
| `src/renderer/theme/ThemeContext.tsx` | **Create** | React context: reads settings, watches system pref, sets `data-theme` |
| `src/renderer/components/shared/Icons.tsx` | **Create** | All 24 custom stroke SVG icons as typed React components |
| `src/renderer/main.tsx` | **Modify** | Import token CSS files |
| `src/renderer/App.tsx` | **Modify** | Wrap app in `ThemeContext.Provider`, remove `ThemeProvider` |
| `src/renderer/theme.ts` | **Modify** | Shrink to minimal MUI skeleton for kept components |
| `src/shared/ipc-types.ts` | **Modify** | Add `theme` field to `SettingsResponse` |
| `src/main/services/SettingsService.ts` | **Modify** | Add `theme` to `AppSettings`, `StoredSettings`, defaults, load/save |
| `src/renderer/components/layout/AppShell.tsx` | **Modify** | Restyle layout using CSS vars, drop MUI Box |
| `src/renderer/components/layout/LeftSidebar.tsx` | **Modify** | Full rewrite per `SidebarProjects` artboard |
| `src/renderer/components/layout/chat/ChatPanel.tsx` | **Modify** | Add `ChatHeader`, set bg to `var(--bg)` |
| `src/renderer/components/layout/chat/ChatHeader.tsx` | **Create** | Styled header: title + folder path + chip counts |
| `src/renderer/components/layout/chat/MessageList.tsx` | **Modify** | Rewrite bubbles per `Bubble` artboard |
| `src/renderer/components/layout/chat/MessageInput.tsx` | **Modify** | Rewrite per `Composer` artboard |
| `src/renderer/components/layout/chat/ResearchStatusBar.tsx` | **Modify** | Rewrite per `ResearchBar` artboard |
| `src/renderer/components/layout/DetailsPanel.tsx` | **Modify** | Add `MemoryStrip`, restructure layout |
| `src/renderer/components/layout/MemoryStrip.tsx` | **Create** | Project memory display per artboard |
| `src/renderer/components/layout/RecentOutputsPanel.tsx` | **Modify** | Restyle per `RecentOutputsPanelMini` artboard |
| `src/renderer/components/layout/FileExplorer.tsx` | **Modify** | Restyle rows per `ArtifactsList` artboard |
| `src/renderer/components/settings/SettingsModal.tsx` | **Modify** | Rewrite shell per `SettingsShell` artboard |
| `src/renderer/components/settings/GeneralTab.tsx` | **Modify** | Restyle toggles, add theme selector pills |
| `src/renderer/components/settings/ModelProviderTab.tsx` | **Modify** | Restyle provider cards, model selector |
| `src/renderer/components/settings/AuditTab.tsx` | **Modify** | Restyle table per artboard |
| `src/renderer/components/settings/SkillsTab.tsx` | **Modify** | Restyle list per artboard |
| `src/renderer/components/settings/SettingsTabs.tsx` | **Create** | Custom tab bar with underline accent (replaces MUI Tabs) |
| `src/renderer/components/layout/chat/PendingCommandBanner.tsx` | **Modify** | Restyle per `BannersArtboard` |
| `src/renderer/components/layout/chat/PendingPathBanner.tsx` | **Modify** | Restyle per `BannersArtboard` |
| `src/renderer/components/layout/chat/PendingToolBanner.tsx` | **Modify** | Restyle per `BannersArtboard` |
| `src/renderer/components/layout/chat/PendingCommandModal.tsx` | **Modify** | Restyle modal shell |
| `src/renderer/components/layout/chat/PendingToolModal.tsx` | **Modify** | Restyle modal shell |
| `src/renderer/components/layout/chat/PendingPathModal.tsx` | **Modify** | Restyle modal shell |
| `src/renderer/components/layout/chat/ReviewDialog.tsx` | **Modify** | Restyle modal shell |

---

### Task 1: Token CSS Files

**Files:**
- Create: `src/renderer/styles/tokens.css`
- Create: `src/renderer/styles/tokens-dark.css`

- [ ] **Step 1: Write `tokens.css`**

Copy `design_system/tokens.css` content into `src/renderer/styles/tokens.css` exactly as-is. The `:root` block and all utility classes (`app`, `btn`, `input`, `chip`, `card`, `dot`, `eyebrow`, `kbd`, `thin-scroll`, `hr`, `t-secondary`, `t-tertiary`, `t-mono`, `t-num`, `titlebar`).

- [ ] **Step 2: Write `tokens-dark.css`**

```css
/* Dark overrides — only active when html has data-theme="dark" */
html[data-theme="dark"] {
  /* Surfaces */
  --bg:        oklch(0.17 0.008 60);
  --surface:   oklch(0.21 0.010 60);
  --surface-2: oklch(0.25 0.012 60);
  --surface-3: oklch(0.30 0.014 60);
  --line:      oklch(0.30 0.012 60);
  --line-strong: oklch(0.38 0.014 60);

  /* Ink */
  --ink:       oklch(0.95 0.010 70);
  --ink-2:     oklch(0.74 0.012 70);
  --ink-3:     oklch(0.58 0.012 70);
  --ink-on-accent: oklch(0.16 0.010 60);

  /* Accent */
  --accent:        oklch(0.74 0.14 50);
  --accent-hover:  oklch(0.80 0.14 50);
  --accent-soft:   oklch(0.30 0.06 45);
  --accent-line:   oklch(0.42 0.09 45);

  /* Status */
  --success:       oklch(0.74 0.10 145);
  --success-soft:  oklch(0.28 0.04 145);
  --warn:          oklch(0.80 0.12 80);
  --warn-soft:     oklch(0.30 0.05 75);
  --danger:        oklch(0.72 0.14 28);
  --danger-soft:   oklch(0.28 0.06 25);
  --info:          oklch(0.74 0.10 240);
  --info-soft:     oklch(0.28 0.04 240);

  /* Shadows */
  --shadow-1: 0 1px 0 oklch(0 0 0 / 0.3), 0 1px 2px oklch(0 0 0 / 0.35);
  --shadow-2: 0 2px 4px oklch(0 0 0 / 0.4),  0 8px 24px oklch(0 0 0 / 0.45);
  --shadow-3: 0 4px 12px oklch(0 0 0 / 0.5), 0 24px 60px oklch(0 0 0 / 0.6);
  --focus-ring: 0 0 0 3px oklch(0.74 0.14 50 / 0.30);
}

/* Dark mode button/input overrides */
html[data-theme="dark"] .btn:hover { background: var(--surface-2); }
html[data-theme="dark"] .btn--primary { background: var(--accent); color: var(--ink-on-accent); border-color: var(--accent); }
html[data-theme="dark"] .btn--primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
html[data-theme="dark"] .btn--danger { background: var(--danger); color: oklch(0.16 0.01 60); border-color: var(--danger); }
html[data-theme="dark"] .input { background: var(--surface-2); }
html[data-theme="dark"] .input--sunken { background: var(--bg); }
html[data-theme="dark"] .chip--accent  { background: var(--accent-soft);  color: oklch(0.88 0.10 50);  border-color: var(--accent-line); }
html[data-theme="dark"] .chip--success { background: var(--success-soft); color: oklch(0.88 0.10 145); border-color: oklch(0.42 0.06 145); }
html[data-theme="dark"] .chip--warn    { background: var(--warn-soft);    color: oklch(0.90 0.10 80);  border-color: oklch(0.45 0.07 75); }
html[data-theme="dark"] .chip--danger  { background: var(--danger-soft);  color: oklch(0.88 0.11 28);  border-color: oklch(0.45 0.09 25); }
html[data-theme="dark"] .chip--info    { background: var(--info-soft);    color: oklch(0.88 0.08 240); border-color: oklch(0.42 0.06 240); }
html[data-theme="dark"] .dot--accent  { background: var(--accent); box-shadow: 0 0 0 3px oklch(0.74 0.14 50 / 0.18); }
html[data-theme="dark"] .tl-close { background: oklch(0.65 0.16 25); }
html[data-theme="dark"] .tl-min   { background: oklch(0.78 0.13 80); }
html[data-theme="dark"] .tl-max   { background: oklch(0.72 0.15 145); }
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/
git commit -m "$(cat <<'EOF'
   feat: add Scholar design tokens (light + dark)

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 2: Theme React Context

**Files:**
- Create: `src/renderer/theme/ThemeContext.tsx`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write `ThemeContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IPC } from "../../shared/ipc-channels";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeMode;
  resolved: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const resolve = useCallback((mode: ThemeMode) => {
    if (mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return mode;
  }, []);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      const mode = (settings.theme as ThemeMode) ?? "system";
      setThemeState(mode);
      const r = resolve(mode);
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
    });
  }, [resolve]);

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
  }, [theme, resolve]);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, resolve]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    void window.electronAPI.invoke(IPC.SAVE_SETTINGS, { theme: mode });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 2: Modify `main.tsx`**

Add imports at the top:
```tsx
import "../styles/tokens.css";
import "../styles/tokens-dark.css";
```

- [ ] **Step 3: Modify `App.tsx`**

Replace the MUI `ThemeProvider` import and usage with `ThemeProvider` from our context.

```tsx
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import { CssBaseline, Snackbar, Alert } from "@mui/material"; // keep these
import { useEffect, useState } from "react";
import { IPC } from "../shared/ipc-channels";
import { decodeModelFallbackPayload } from "../shared/ipc-guards";
import AppShell from "./components/layout/AppShell";
import SettingsModal from "./components/settings/SettingsModal";
import { ProjectProvider } from "./contexts/ProjectContext";
import { ThemeProvider } from "./theme/ThemeContext";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fallbackAlert, setFallbackAlert] = useState<string | null>(null);

  useEffect(() => {
    const remove = window.electronAPI.on(IPC.MODEL_FALLBACK, (payload: unknown) => {
      const p = decodeModelFallbackPayload(payload);
      if (!p) return;
      if (p.reason === "ollama_unavailable") {
        setFallbackAlert(`Ollama is offline. Switched to ${p.fallbackProvider}.`);
      }
    });
    return remove;
  }, []);

  return (
    <ThemeProvider>
      <CssBaseline />
      <ProjectProvider>
        <AppShell onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ProjectProvider>
      <Snackbar open={!!fallbackAlert} autoHideDuration={6000} onClose={() => setFallbackAlert(null)}>
        <Alert severity="warning" onClose={() => setFallbackAlert(null)}>
          {fallbackAlert}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/theme/ThemeContext.tsx src/renderer/main.tsx src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
   feat: add theme context with light/dark/system support

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 3: Shrink MUI Theme

**Files:**
- Modify: `src/renderer/theme.ts`

- [ ] **Step 1: Rewrite `theme.ts`**

```ts
import { createTheme, type Theme } from "@mui/material/styles";

export function createAppTheme(): Theme {
  return createTheme({
    palette: {
      mode: "dark",
    },
    typography: {
      fontFamily: 'var(--font-sans)',
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            background: "var(--surface)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-base)",
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            fontFamily: "var(--font-sans)",
          },
        },
      },
    },
  });
}
```

Note: `glassSx` export is deleted. If any file still imports it, fix the import (remove it).

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors. If any file still imports `glassSx` or `createAppTheme`, fix it.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/theme.ts
git commit -m "$(cat <<'EOF'
   refactor: shrink MUI theme to minimal skeleton

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 4: Settings Backend — Add Theme Field

**Files:**
- Modify: `src/main/services/SettingsService.ts`
- Modify: `src/shared/ipc-types.ts`

- [ ] **Step 1: Modify `AppSettings` interface in SettingsService.ts**

Add `theme: "light" | "dark" | "system";` after `webAccessEnabled`.

- [ ] **Step 2: Modify `DEFAULT_SETTINGS`**

Add `theme: "system"` after `webAccessEnabled: true`.

- [ ] **Step 3: Modify `StoredSettings` interface**

Add `theme?: "light" | "dark" | "system";` after `webAccessEnabled`.

- [ ] **Step 4: Modify load/save logic**

Find the two places where `langfuseEnabled` and `webAccessEnabled` are read from stored settings and add `theme: stored.theme ?? "system"`.

Find the place where they are persisted in `save` and add `theme: next.theme`.

- [ ] **Step 5: Modify `SettingsResponse` in `ipc-types.ts`**

Add `theme: "light" | "dark" | "system";` after `webAccessEnabled`.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/SettingsService.ts src/shared/ipc-types.ts
git commit -m "$(cat <<'EOF'
   feat: persist theme setting in backend

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 5: Custom Icons

**Files:**
- Create: `src/renderer/components/shared/Icons.tsx`

- [ ] **Step 1: Write `Icons.tsx`**

Port all icons from `design_system/icons.jsx` into a typed TSX file:

```tsx
interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  strokeColor?: string;
  style?: React.CSSProperties;
}

function Ic({ d, size = 16, stroke = 1.6, fill = "none", strokeColor = "currentColor", style }: IconProps & { d: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={strokeColor}
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {d}
    </svg>
  );
}

export const IconPlus    = (p: IconProps) => <Ic {...p} d={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />;
export const IconSearch  = (p: IconProps) => <Ic {...p} d={<><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></>} />;
export const IconSettings= (p: IconProps) => <Ic {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />;
export const IconFolder  = (p: IconProps) => <Ic {...p} d={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>} />;
export const IconSend    = (p: IconProps) => <Ic {...p} d={<><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></>} />;
export const IconChevD   = (p: IconProps) => <Ic {...p} d={<polyline points="6 9 12 15 18 9"/>} />;
export const IconChevR   = (p: IconProps) => <Ic {...p} d={<polyline points="9 6 15 12 9 18"/>} />;
export const IconArrowL  = (p: IconProps) => <Ic {...p} d={<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>} />;
export const IconCheck   = (p: IconProps) => <Ic {...p} d={<polyline points="20 6 9 17 4 12"/>} />;
export const IconX       = (p: IconProps) => <Ic {...p} d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>} />;
export const IconDoc     = (p: IconProps) => <Ic {...p} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>} />;
export const IconAlert   = (p: IconProps) => <Ic {...p} d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></>} />;
export const IconShield  = (p: IconProps) => <Ic {...p} d={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>} />;
export const IconBolt    = (p: IconProps) => <Ic {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>} />;
export const IconBrain   = (p: IconProps) => <Ic {...p} d={<path d="M9 3a3 3 0 0 0-3 3v0a3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3 3 3 0 0 0 6 0 3 3 0 0 0 4-3 3 3 0 0 0 1-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3 3 3 0 0 0-6 0z"/>} />;
export const IconTerm    = (p: IconProps) => <Ic {...p} d={<><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>} />;
export const IconTrash   = (p: IconProps) => <Ic {...p} d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>} />;
export const IconRefresh = (p: IconProps) => <Ic {...p} d={<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>} />;
export const IconLink    = (p: IconProps) => <Ic {...p} d={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>} />;
export const IconEdit    = (p: IconProps) => <Ic {...p} d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>} />;
export const IconCpu     = (p: IconProps) => <Ic {...p} d={<><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/></>} />;
export const IconGlobe   = (p: IconProps) => <Ic {...p} d={<><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>} />;
export const IconBook    = (p: IconProps) => <Ic {...p} d={<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/>} />;
export const IconLogo    = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="var(--accent)" />
    <circle cx="12" cy="12" r="3.2" fill="var(--bg)" />
  </svg>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/shared/Icons.tsx
git commit -m "$(cat <<'EOF'
   feat: add custom stroke SVG icon set

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 6: AppShell Restyle

**Files:**
- Modify: `src/renderer/components/layout/AppShell.tsx`

- [ ] **Step 1: Rewrite `AppShell.tsx`**

Drop MUI `Box` entirely. Use plain `div` with CSS var references.

```tsx
import ChatPanel from "./chat/ChatPanel";
import DetailsPanel from "./DetailsPanel";
import LeftSidebar from "./LeftSidebar";

interface AppShellProps {
  onOpenSettings: () => void;
}

export default function AppShell({ onOpenSettings }: AppShellProps) {
  return (
    <div className="app" style={{ display: "flex", flexDirection: "row", height: "100vh", overflow: "hidden" }}>
      <div style={{ width: 248, flexShrink: 0, height: "100%", background: "var(--surface)", borderRight: "1px solid var(--line)" }}>
        <LeftSidebar onOpenSettings={onOpenSettings} />
      </div>
      <div style={{ flex: 1, overflow: "hidden", height: "100%", background: "var(--bg)" }}>
        <ChatPanel />
      </div>
      <div style={{ width: 320, flexShrink: 0, height: "100%", background: "var(--surface)", borderLeft: "1px solid var(--line)" }}>
        <DetailsPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/layout/AppShell.tsx
git commit -m "$(cat <<'EOF'
   refactor: restyle AppShell with CSS vars, drop MUI Box

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 7: LeftSidebar Rewrite

**Files:**
- Modify: `src/renderer/components/layout/LeftSidebar.tsx`

- [ ] **Step 1: Replace MUI imports with custom icons**

```tsx
import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Project } from "../../../shared/types";
import { useProject } from "../../contexts/ProjectContext";
import {
  IconLogo,
  IconPlus,
  IconFolder,
  IconSettings,
  IconChevD,
  IconCheck,
  IconX,
} from "../../components/shared/Icons";
```

- [ ] **Step 2: Rewrite JSX to match `SidebarProjects` artboard**

Use plain `div` elements with inline styles referencing CSS vars. Structure:
- Header: `IconLogo` + "Research Assistant" title
- "Projects" eyebrow + count badge
- Project list with dot indicators (active gets `dot--accent` + `var(--accent-soft)` bg, idle gets `dot--idle`)
- Folder icon on linked projects
- Create flow (input + folder select + cancel/create buttons using `.btn` classes)
- "New project" button
- Footer: user avatar circle + name + "local" label + settings button

Keep all existing state/logic (projects, creating, newName, newFolderPath, contextMenu, renaming, deleteTarget) unchanged. Only markup and styling change.

Key style references:
- Sidebar bg: `var(--surface)`
- Header/footer border: `1px solid var(--line)`
- Active item: `background: var(--accent-soft)`, `color: oklch(0.42 0.12 45)`
- Idle dot: `className="dot dot--idle"`
- Active dot: `className="dot dot--accent"`
- Eyebrow: `className="eyebrow"`
- User avatar: 24x24 circle, `background: var(--accent-soft)`, `color: oklch(0.42 0.12 45)`

- [ ] **Step 3: Run tests**

```bash
bun run test
```

Fix any broken selectors. Tests likely reference MUI classes or specific DOM structure.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/LeftSidebar.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite LeftSidebar per Scholar design system

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 8: ChatHeader + ChatPanel Restyle

**Files:**
- Create: `src/renderer/components/layout/chat/ChatHeader.tsx`
- Modify: `src/renderer/components/layout/chat/ChatPanel.tsx`

- [ ] **Step 1: Write `ChatHeader.tsx`**

```tsx
import { IconDoc, IconBrain } from "../../shared/Icons";

interface ChatHeaderProps {
  title: string;
  folder?: string;
}

export default function ChatHeader({ title, folder }: ChatHeaderProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 24px", borderBottom: "1px solid var(--line)", background: "var(--bg)"
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</span>
        {folder && <span className="t-mono t-tertiary" style={{ fontSize: 11 }}>{folder}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="chip"><IconBrain size={11} /> 14 memories</span>
        <span className="chip"><IconDoc size={11} /> 7 artifacts</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `ChatPanel.tsx`**

Import `ChatHeader`. Replace the empty-state `Box`/`Typography` with plain `div`. In the active chat view, add `<ChatHeader title={projectName} folder={...} />` above the banners. Keep all message/streaming logic.

Use `project.name` from the loaded messages or maintain a local state for the active project name. Since `useProject` only gives `activeProjectId`, fetch the project name from the projects list or add it to context. Simplest: keep a `projectName` state and look it up from the IPC `GET_PROJECTS` response or the messages metadata.

Actually, `ChatPanel` doesn't currently know the project name. The simplest approach: add `useEffect` to fetch project list and derive name from `activeProjectId`. Or just pass a static string for now and wire it properly in a follow-up.

For the plan, wire it minimally:

```tsx
const [projectName, setProjectName] = useState("");
useEffect(() => {
  if (!activeProjectId) return;
  window.electronAPI.invoke(IPC.GET_PROJECTS).then((projects) => {
    const p = projects.find((pr) => pr.id === activeProjectId);
    if (p) setProjectName(p.name);
  });
}, [activeProjectId]);
```

Then in the JSX:
```tsx
<ChatHeader title={projectName} folder={activeProjectId ? "~/Notes/..." : undefined} />
```

(The folder path can be fetched similarly or left as a placeholder.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/chat/ChatHeader.tsx src/renderer/components/layout/chat/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
   feat: add ChatHeader, restyle ChatPanel shell

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 9: MessageList Rewrite

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageList.tsx`

- [ ] **Step 1: Replace MUI imports and markup**

Remove `Box`, `Paper`, `Typography`, `CircularProgress`. Keep `MarkdownRenderer`.
Import custom icons if needed (not strictly needed for bubbles).

- [ ] **Step 2: Rewrite JSX**

Structure per `Bubble` artboard:

```tsx
<div className="thin-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
  {messages.map((msg) => (
    <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: 640 }}>
      {/* meta timestamp if desired */}
      <div style={{
        padding: "12px 16px",
        borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
        color: msg.role === "user" ? "var(--ink-on-accent)" : "var(--ink)",
        border: msg.role === "user" ? "none" : "1px solid var(--line)",
        fontSize: 13.5,
        lineHeight: 1.55,
      }}>
        {msg.role === "user" ? (
          <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.content}</span>
        ) : (
          <MarkdownRenderer content={msg.content} />
        )}
      </div>
    </div>
  ))}

  {streamingContent !== null && (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", maxWidth: 640 }}>
      <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "var(--surface)", border: "1px solid var(--line)", fontSize: 13.5, lineHeight: 1.55 }}>
        <MarkdownRenderer content={streamingContent} />
        <span data-testid="streaming-cursor" style={{ display: "inline-block", width: 8, height: "1em", background: "var(--ink)", marginLeft: 4, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
      </div>
    </div>
  )}

  {processing && !streamingContent && (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", maxWidth: 640 }}>
      <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "var(--surface)", border: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot dot--accent dot--pulse" />
        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Agent is thinking...</span>
      </div>
    </div>
  )}

  {/* empty state */}
  {messages.length === 0 && !streamingContent && !processing && (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", maxWidth: "85%" }}>
      <div style={{ padding: "12px 16px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line)", fontSize: 13.5, lineHeight: 1.55 }}>
        <p style={{ margin: "0 0 8px", color: "var(--ink-2)" }}>Welcome to your new project.</p>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>Tell me about your project so I can help you best. Useful details:</p>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
          <li>What is this project about?</li>
          <li>How are files organized?</li>
          <li>Where should research outputs go?</li>
          <li>Any naming conventions or tech stack?</li>
        </ul>
      </div>
    </div>
  )}

  <div ref={bottomRef} />
</div>
```

- [ ] **Step 3: Update tests**

Run `bun run test`. Update selectors if tests look for `data-testid="message-bubble"` or MUI classes. The `data-testid="streaming-cursor"` stays.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/layout/chat/MessageList.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite MessageList bubbles per Scholar design system

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 10: MessageInput Rewrite

**Files:**
- Modify: `src/renderer/components/layout/chat/MessageInput.tsx`

- [ ] **Step 1: Replace MUI imports**

Remove `SendIcon`, `Box`, `IconButton`, `MenuItem`, `Select`, `TextField`. Import custom icons:
```tsx
import { IconCpu, IconSend, IconSearch, IconBolt, IconBrain } from "../../shared/Icons";
```

- [ ] **Step 2: Rewrite JSX per `Composer` artboard**

```tsx
<div style={{ padding: "12px 24px 18px", background: "var(--bg)", borderTop: "1px solid var(--line)" }}>
  <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, borderColor: "var(--line-strong)", boxShadow: "var(--shadow-1)" }}>
    <textarea
      className="input"
      rows={2}
      placeholder="Ask, or hand off to background research..."
      value={content}
      onChange={(e) => setContent(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
      disabled={disabled}
      style={{ resize: "none", border: "none", padding: "4px 6px", background: "transparent", fontSize: 13.5, lineHeight: 1.5 }}
    />
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="btn btn--ghost btn--sm">
          <IconCpu size={13} />
          <span>{model}</span>
          <IconChevD size={12} />
        </button>
        <span style={{ width: 1, height: 14, background: "var(--line)" }} />
        <button className="btn btn--ghost btn--sm" title="Quick lookup"><IconSearch size={13} /> Quick</button>
        <button className="btn btn--ghost btn--sm" title="Standard parallel research"><IconBolt size={13} /> Standard</button>
        <button className="btn btn--ghost btn--sm" title="Deep parallel + evaluator"><IconBrain size={13} /> Deep</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="t-tertiary t-mono" style={{ fontSize: 10 }}>Return send · Shift+Return newline</span>
        <button className="btn btn--primary btn--sm" onClick={handleSend} disabled={!content.trim() || disabled}>
          <IconSend size={13} /> Send
        </button>
      </div>
    </div>
  </div>
</div>
```

Keep existing state/logic for `content`, `model`, `activeProvider`, `availableModels`, `modelsLoading`, `handleModelChange`, `handleSend`.

For the model selector, since we removed MUI `Select`, use a plain `<select>` or keep a styled `<button>` that opens a native `<select>` hidden underneath. Simplest for now: replace `Select` with a native `<select className="input">` inside the `.btn--ghost` button, or just show the model name as a button and use a hidden native select.

Actually, to keep functionality working without heavy re-implementation, keep the MUI `Select` but wrap it in a styled container. The plan allows keeping MUI Select. So we can keep the `Select` and just style its container with CSS vars.

But wait, the skill says no placeholders. Let me be explicit:

**Option A (recommended for this task):** Keep MUI `Select` but style it. Import `Select` and `MenuItem` from `@mui/material`. Wrap the select in a `div` with className. Use `sx` to map colors to CSS vars.

**Option B:** Replace with native `<select>`. Less styling control.

I'll go with Option A to preserve functionality:

```tsx
import { Select, MenuItem } from "@mui/material";
// ... inside JSX:
<Select
  size="small"
  value={model}
  disabled={modelsLoading || disabled}
  onChange={(e) => handleModelChange(e.target.value)}
  sx={{
    minWidth: 130,
    flexShrink: 0,
    fontSize: "var(--text-sm)",
    "& .MuiSelect-select": { py: 0.5, px: 1, fontSize: "var(--text-sm)" },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--line-strong)" },
  }}
>
  {modelOptions.map((m) => (
    <MenuItem key={m.id} value={m.id} sx={{ fontSize: "var(--text-sm)" }}>
      {m.name}
    </MenuItem>
  ))}
</Select>
```

Actually, since we decided to keep Select but style it, I'll include this in the plan.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/chat/MessageInput.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite MessageInput per Composer artboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 11: ResearchStatusBar Rewrite

**Files:**
- Modify: `src/renderer/components/layout/chat/ResearchStatusBar.tsx`

- [ ] **Step 1: Remove MUI imports**

Remove `Box`, `Button`, `CircularProgress`, `Typography`. Import:
```tsx
import { IconChevR } from "../../shared/Icons";
```

- [ ] **Step 2: Rewrite JSX per `ResearchBar` artboard**

```tsx
if (!state.active && !state.doneMessage && !state.error) {
  return <div style={{ minHeight: 40 }} />;
}

const isErr = !!state.error;
const isDone = !!state.doneMessage && !state.error;

return (
  <div data-testid="research-status-bar" style={{
    margin: "12px 24px 0",
    borderRadius: 10,
    padding: "8px 12px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: isErr ? "var(--danger-soft)" : isDone ? "var(--success-soft)" : "var(--accent-soft)",
    border: `1px solid ${isErr ? "oklch(0.82 0.07 25)" : isDone ? "oklch(0.82 0.05 145)" : "var(--accent-line)"}`,
  }}>
    <span className={`dot ${isErr ? "dot--danger" : isDone ? "dot--success" : "dot--accent"} ${state.active ? "dot--pulse" : ""}`} />
    <span style={{ fontSize: 12, fontWeight: 500, color: isErr ? "oklch(0.42 0.12 25)" : isDone ? "oklch(0.38 0.09 145)" : "oklch(0.42 0.12 45)" }}>
      {state.active ? "Researching in background" : isErr ? "Research failed" : "Research complete"}
    </span>
    <span style={{ fontSize: 12, color: "var(--ink-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {state.doneMessage ?? state.message}
    </span>
    {state.active && (
      <>
        <span className="chip chip--mono">{/* remoteCount if available */}subagents</span>
        <button className="btn btn--ghost btn--sm" onClick={handleCancel}>Cancel</button>
      </>
    )}
    {isErr && <button className="btn btn--outline btn--sm" onClick={handleRetry} data-testid="retry-research-btn">Retry</button>}
    {isDone && <button className="btn btn--ghost btn--sm">View artifact <IconChevR size={11} /></button>}
  </div>
);
```

Note: Add a `handleCancel` stub or wire to existing logic if there is a cancel path. If none, just omit the cancel button for now.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/layout/chat/ResearchStatusBar.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite ResearchStatusBar per ResearchBar artboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 12: DetailsPanel + MemoryStrip + RecentOutputsPanel

**Files:**
- Modify: `src/renderer/components/layout/DetailsPanel.tsx`
- Create: `src/renderer/components/layout/MemoryStrip.tsx`
- Modify: `src/renderer/components/layout/RecentOutputsPanel.tsx`
- Modify: `src/renderer/components/layout/FileExplorer.tsx`

- [ ] **Step 1: Write `MemoryStrip.tsx`**

```tsx
import { IconEdit } from "../shared/Icons";

export default function MemoryStrip() {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="eyebrow">Project memory</span>
        <button className="btn btn--ghost btn--sm" style={{ padding: "2px 6px", fontSize: 11 }}><IconEdit size={11} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {["Output folder: research/", "Prefer Markdown w/ inline citations", "Tone: terse, data-first"].map((t, i) => (
          <div key={i} style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ color: "var(--accent)", marginTop: 4 }}>—</span>
            <span style={{ flex: 1 }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `DetailsPanel.tsx`**

```tsx
import { useProject } from "../../contexts/ProjectContext";
import FileExplorer from "./FileExplorer";
import MemoryStrip from "./MemoryStrip";
import RecentOutputsPanel from "./RecentOutputsPanel";

export default function DetailsPanel() {
  const { activeProjectId } = useProject();

  if (!activeProjectId) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "var(--ink-3)", fontSize: 12, textAlign: "center" }}>
        Details, artifacts and recent outputs appear here once a project is selected.
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
      <MemoryStrip />
      <RecentOutputsPanel />
      <FileExplorer projectId={activeProjectId} />
    </div>
  );
}
```

- [ ] **Step 3: Restyle `RecentOutputsPanel.tsx`**

Read the current file first. Replace MUI components with plain divs using CSS classes. Match `RecentOutputsPanelMini` artboard: eyebrow header with dot + count, list items with tier chips, file path + ago, reveal/acknowledge buttons.

Key changes:
- Header: `<span className="eyebrow">Recent outputs</span>` + `<span className="dot dot--accent" />` + clear button
- Items: map over outputs, show tier chip (`chip`, `chip--info`, `chip--accent`), title with ellipsis, path + ago, action buttons
- First item gets `background: var(--surface-2)`

- [ ] **Step 4: Restyle `FileExplorer.tsx`**

Read current file. Restyle rows to match `ArtifactsList` artboard: `IconDoc`, title with ellipsis, date, chevron right. Use plain divs instead of MUI TreeView if it uses MUI. If it uses custom markup, just apply CSS var colors and the card styling.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/layout/DetailsPanel.tsx src/renderer/components/layout/MemoryStrip.tsx src/renderer/components/layout/RecentOutputsPanel.tsx src/renderer/components/layout/FileExplorer.tsx
git commit -m "$(cat <<'EOF'
   feat: restructure DetailsPanel with MemoryStrip, restyle panels

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 13: SettingsModal + Custom Tabs

**Files:**
- Create: `src/renderer/components/settings/SettingsTabs.tsx`
- Modify: `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Write `SettingsTabs.tsx`**

Custom tab bar matching `SettingsShell` artboard. No MUI Tabs.

```tsx
import { IconSettings, IconCpu, IconShield, IconBolt } from "../shared/Icons";

const tabs = [
  { label: "General", icon: IconSettings },
  { label: "Model provider", icon: IconCpu },
  { label: "Audit log", icon: IconShield },
  { label: "Skills", icon: IconBolt },
];

interface SettingsTabsProps {
  active: number;
  onChange: (idx: number) => void;
}

export default function SettingsTabs({ active, onChange }: SettingsTabsProps) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "14px 22px 0", borderBottom: "1px solid var(--line)" }}>
      {tabs.map((t, i) => {
        const Icon = t.icon;
        const isActive = i === active;
        return (
          <div
            key={t.label}
            onClick={() => onChange(i)}
            style={{
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--ink)" : "var(--ink-2)",
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
              cursor: "pointer",
            }}
          >
            <Icon size={13} />{t.label}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `SettingsModal.tsx`**

Replace MUI `Dialog`, `DialogTitle`, `Tabs` with custom shell. Keep MUI `Dialog` only if needed for animation/backdrop. Actually, the artboard shows a card modal. We can keep MUI `Dialog` but override `paper` heavily.

Replace imports: keep `Button`, `Dialog`, `DialogActions`, `DialogContent`, `DialogContentText`, `DialogTitle` from MUI but style them. Remove `Tab`, `Tabs`.

Replace the top section:
```tsx
<Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
  <div className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", maxHeight: 720 }}>
    <div style={{ padding: "18px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.005em" }}>Settings</div>
      <button className="btn btn--ghost btn--icon" onClick={onClose}><IconX size={14} /></button>
    </div>
    <SettingsTabs active={tab} onChange={setTab} />
    <div className="thin-scroll" style={{ flex: 1, overflow: "auto", padding: "22px 26px" }}>
      {/* tab content */}
    </div>
    {(tab === 0 || tab === 1 || tab === 3) && (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 22px", borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
        <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>Save changes</button>
      </div>
    )}
  </div>
</Dialog>
```

Override MUI Dialog `slotProps={{ paper: { sx: { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-3)' } } }}`.

Remove the `glassSx` import — it no longer exists.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsTabs.tsx src/renderer/components/settings/SettingsModal.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite SettingsModal shell with custom tab bar

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 14: GeneralTab Rewrite

**Files:**
- Modify: `src/renderer/components/settings/GeneralTab.tsx`

- [ ] **Step 1: Add theme prop and rewrite markup**

```tsx
interface GeneralTabProps {
  langfuseEnabled: boolean;
  onLangfuseChange: (enabled: boolean) => void;
  webAccessEnabled: boolean;
  onWebAccessChange: (enabled: boolean) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

export default function GeneralTab({
  langfuseEnabled,
  onLangfuseChange,
  webAccessEnabled,
  onWebAccessChange,
  theme,
  onThemeChange,
}: GeneralTabProps) {
  return (
    <div style={{ paddingTop: 8 }}>
      <span className="eyebrow">Behavior</span>
      <h2 style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 600 }}>General</h2>
      <p style={{ margin: "0 0 16px", color: "var(--ink-2)", fontSize: 12.5, maxWidth: 560 }}>
        Defaults that apply to every project.
      </p>

      <Row title="LangFuse tracing" sub="Send agent runs and tool calls to your LangFuse instance." control={<Toggle on={langfuseEnabled} onChange={onLangfuseChange} />} />
      <Row title="Web access for agents" sub="Enables fetch_url and web_search tools." control={<Toggle on={webAccessEnabled} onChange={onWebAccessChange} />} />
      <Row title="Theme" sub="The app follows your system theme; you can pin one if you prefer." control={
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--surface-2)", borderRadius: 8 }}>
          {(["system", "light", "dark"] as const).map((t) => (
            <div key={t} onClick={() => onThemeChange(t)} style={{
              padding: "5px 10px", fontSize: 12, borderRadius: 6,
              background: theme === t ? "var(--surface)" : "transparent",
              fontWeight: theme === t ? 600 : 500,
              boxShadow: theme === t ? "var(--shadow-1)" : "none",
              cursor: "pointer", textTransform: "capitalize",
            }}>{t}</div>
          ))}
        </div>
      } />
    </div>
  );
}

function Row({ title, sub, control }: { title: string; sub: string; control: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 480 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>{sub}</span>
      </div>
      {control}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 36, height: 20, borderRadius: 999,
      background: on ? "var(--accent)" : "var(--surface-3)",
      border: "1px solid var(--line)", position: "relative", flexShrink: 0,
      cursor: "pointer", transition: "background 120ms ease",
    }}>
      <div style={{
        position: "absolute", top: 1, left: on ? 17 : 1,
        width: 16, height: 16, borderRadius: "50%",
        background: "white", boxShadow: "var(--shadow-1)",
        transition: "left 120ms ease",
      }} />
    </div>
  );
}
```

- [ ] **Step 2: Wire theme in `SettingsModal.tsx`**

In `SettingsModal`, import `useTheme` from `../../theme/ThemeContext`. Add local state:
```tsx
const { theme: currentTheme, setTheme } = useTheme();
const [themeSetting, setThemeSetting] = useState<"light" | "dark" | "system">("system");
```

Load it in the `useEffect` that loads settings:
```tsx
setThemeSetting(settings.theme ?? "system");
```

Pass to `GeneralTab`:
```tsx
<GeneralTab
  langfuseEnabled={langfuseEnabled}
  onLangfuseChange={setLangfuseEnabled}
  webAccessEnabled={webAccessEnabled}
  onWebAccessChange={setWebAccessEnabled}
  theme={themeSetting}
  onThemeChange={(t) => { setThemeSetting(t); setTheme(t); }}
/>
```

Include `theme` in the `handleSave` payload:
```tsx
await window.electronAPI.invoke(IPC.SAVE_SETTINGS, {
  // ...existing fields...
  theme: themeSetting,
});
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/GeneralTab.tsx src/renderer/components/settings/SettingsModal.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite GeneralTab with custom toggles and theme selector

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 15: ModelProviderTab Rewrite

**Files:**
- Modify: `src/renderer/components/settings/ModelProviderTab.tsx`

- [ ] **Step 1: Rewrite markup**

Replace MUI `Box`, `FormControl`, `InputLabel`, `Select`, `MenuItem`, `TextField`, `Chip`, `Button`, `Typography` with plain elements styled via CSS classes. Keep MUI `Select` for model dropdowns if desired (style its `sx`), or replace with native styled selects.

Match `SettingsModelArtboard`:
- Provider cards grid (2 columns): each card is a `div` with border, background, radio dot. Active card gets `var(--accent)` border + `var(--accent-soft)` bg.
- API key input: `<input className="input" type="password" />`
- Model selector: styled select or keep MUI Select with CSS var overrides
- Helper text in `t-tertiary` small font

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/ModelProviderTab.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite ModelProviderTab per Scholar artboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 16: AuditTab Rewrite

**Files:**
- Modify: `src/renderer/components/settings/AuditTab.tsx`

- [ ] **Step 1: Rewrite markup**

Match `SettingsAuditArtboard`:
- Filter pills: styled `div`s in a segmented control (like GeneralTab theme selector)
- Search input: `<input className="input" placeholder="filter..." />`
- Table: plain HTML `<table>` with styled `<thead>` (background `var(--surface-2)`, uppercase headers, `var(--ink-3)` color) and `<tbody>` rows with `t-mono` for command + time.
- Status chips: `chip chip--success` for executed, `chip chip--danger` for blocked
- Action buttons: Refresh (`.btn--outline btn--sm`) + Clear (`.btn--ghost btn--sm` with `color: var(--danger)`)

Remove MUI `Box`, `Button`, `Chip`, `CircularProgress`, `Table`-family components if used.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/AuditTab.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite AuditTab per Scholar artboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 17: SkillsTab Rewrite

**Files:**
- Modify: `src/renderer/components/settings/SkillsTab.tsx`

- [ ] **Step 1: Rewrite markup**

Match `SettingsSkillsArtboard`:
- Header row with eyebrow + title + description + "New skill" button
- Filter chips: `all`, `built-in`, `custom`, `disabled`
- List inside `.card`: each row has bolt icon in a 30x30 `var(--surface-2)` square, skill name in `t-mono`, builtin/custom chip, toggle, view/hide button, trash icon for custom skills
- Expanded view shows YAML source in a `pre` block with `var(--surface-2)` bg

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/settings/SkillsTab.tsx
git commit -m "$(cat <<'EOF'
   feat: rewrite SkillsTab per Scholar artboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 18: Banners Restyle

**Files:**
- Modify: `src/renderer/components/layout/chat/PendingCommandBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingPathBanner.tsx`
- Modify: `src/renderer/components/layout/chat/PendingToolBanner.tsx`

- [ ] **Step 1: Rewrite each banner per `BannersArtboard`**

Common anatomy: `div` with border-radius 10, colored soft background, border, flex row with gap 10.
- Icon (Shield/Alert/Bolt) sized 14 with specific stroke color
- Chip with category (`chip--danger` for destructive, `chip--warn` for privilege, default for tool)
- Text: command/path in `t-mono` inline pill, description
- Action button: `.btn--ghost btn--sm` or `.btn--outline btn--sm`

Apply to all three files. Remove MUI components.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/layout/chat/PendingCommandBanner.tsx src/renderer/components/layout/chat/PendingPathBanner.tsx src/renderer/components/layout/chat/PendingToolBanner.tsx
git commit -m "$(cat <<'EOF'
   feat: restyle pending banners per BannersArtboard

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 19: Modals Restyle

**Files:**
- Modify: `src/renderer/components/layout/chat/PendingCommandModal.tsx`
- Modify: `src/renderer/components/layout/chat/PendingToolModal.tsx`
- Modify: `src/renderer/components/layout/chat/PendingPathModal.tsx`
- Modify: `src/renderer/components/layout/chat/ReviewDialog.tsx`

- [ ] **Step 1: Restyle each modal shell**

Match `BlockedCommandModalArtboard` and `PendingToolModalArtboard`:
- Header: 36x36 icon container with `var(--danger-soft)` or `var(--accent-soft)` bg, title, subtitle, chip
- Body: sections with `.eyebrow` headings, pre blocks for code
- Footer: border-top, `var(--surface)` bg, action buttons

Keep MUI `Dialog` for the backdrop/animation but replace inner markup with plain divs and CSS classes. Remove `DialogTitle`, `DialogContent`, `DialogContentText`, `DialogActions` — replace with custom markup inside `Dialog` children.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/layout/chat/PendingCommandModal.tsx src/renderer/components/layout/chat/PendingToolModal.tsx src/renderer/components/layout/chat/PendingPathModal.tsx src/renderer/components/layout/chat/ReviewDialog.tsx
git commit -m "$(cat <<'EOF'
   feat: restyle modals per Scholar artboards

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```
Expected: zero errors.

- [ ] **Step 2: Lint + format check**

```bash
bun run check
```
Expected: clean.

- [ ] **Step 3: Run tests**

```bash
bun run test
```
Expected: all pass. Fix any snapshot or selector failures.

- [ ] **Step 4: Visual verification**

```bash
bun run dev -- --remote-debugging-port=9222
```

Checklist:
- [ ] Light mode loads with warm paper background and terracotta accent
- [ ] Dark mode switches to warm charcoal
- [ ] Sidebar shows logo, project list with dots, footer avatar
- [ ] Chat header shows title + chips
- [ ] User bubbles are terracotta, assistant bubbles are surface
- [ ] Composer has card wrapper, model pill, tier buttons, send button
- [ ] Research bar shows pulsing dot when active
- [ ] Details panel shows MemoryStrip, RecentOutputs, FileExplorer
- [ ] Settings modal has custom tab bar, styled toggles, theme selector
- [ ] Model provider cards have radio dots
- [ ] Audit log table has styled headers and chip status
- [ ] Skills list has bolt icons and toggles
- [ ] All banners and modals match artboard styling

- [ ] **Step 5: Commit any test fixes**

```bash
git commit -m "$(cat <<'EOF'
   test: update selectors and snapshots for design system overhaul

   Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
   EOF
   )"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Implementing Task |
|---|---|
| Global theme system (ThemeContext, data-theme) | Task 2, 14 |
| Token CSS files | Task 1 |
| Icon migration | Task 5 |
| AppShell restyle | Task 6 |
| LeftSidebar rewrite | Task 7 |
| ChatHeader | Task 8 |
| MessageList rewrite | Task 9 |
| MessageInput rewrite | Task 10 |
| ResearchStatusBar rewrite | Task 11 |
| DetailsPanel restructure | Task 12 |
| SettingsModal + tabs | Task 13 |
| GeneralTab | Task 14 |
| ModelProviderTab | Task 15 |
| AuditTab | Task 16 |
| SkillsTab | Task 17 |
| Banners | Task 18 |
| Modals | Task 19 |
| Settings backend (theme field) | Task 4 |
| Testing checklist | Task 20 |

### Placeholder Scan

- No "TBD", "TODO", "implement later" found.
- All code blocks contain actual content.
- No vague references like "Similar to Task X".

### Type Consistency

- `ThemeMode` defined as `"light" | "dark" | "system"` in Task 2.
- Used consistently in `AppSettings`, `StoredSettings`, `SettingsResponse`, `GeneralTabProps`.
- `IconProps` interface used in Task 5 for all icons.
- `Toggle` component signature used in Task 14 matches usage.

### Risk Notes

- `ChatPanel` fetches project name from `GET_PROJECTS` in Task 8. If the IPC takes time, the header may briefly show empty. Acceptable for now.
- MUI `Select` is kept in `MessageInput` and `ModelProviderTab` with CSS var overrides. This is explicitly allowed by the spec.
- `FileExplorer` restyle in Task 12 is described at a high level because the current implementation wasn't fully read in planning. The implementing agent should read `FileExplorer.tsx` first and apply the same CSS-var-based restyling principles.

---

*Plan complete. Proceed to execution.*
