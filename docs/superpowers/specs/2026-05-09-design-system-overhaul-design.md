# Design System Overhaul — Scholar Theme

**Date:** 2026-05-09
**Scope:** Apply the `design_system/` artboards to the Electron renderer (React + MUI).
**Approach:** CSS utility classes from `tokens.css` / `tokens-dark.css`, custom SVG icons, light+dark theme support.

## Goals

- Replace the current dark-only MUI theme with the warm terracotta "Scholar" design system.
- Support light, dark, and system modes.
- Keep all existing functionality. No data model or IPC changes.
- Ship a clean, consistent visual language across all renderer components.

## Non-Goals

- New features (tier selector, memory strip content, artifact viewer deep navigation). Shells only.
- Backend or IPC contract changes.
- Replacing MUI Dialog, Select, Tabs, Menu, TextField — these stay with heavy overrides.

## Architecture

### Global Theme System

`App.tsx` renders a context provider that:
- Reads `theme` from settings (light / dark / system).
- Watches `matchMedia('(prefers-color-scheme: dark)')` when `system`.
- Sets `data-theme="light" | "dark"` on `<html>`.

Both `tokens.css` and `tokens-dark.css` are imported in `main.tsx` (or a single merged file). Dark tokens are gated behind `html[data-theme="dark"]` selectors so they override light values.

`theme.ts` is reduced to a minimal MUI theme factory for the few kept MUI components (Dialog, Select, Tabs, Menu). It inherits the same token variables via CSS custom properties.

### Icon Migration

New file: `src/renderer/components/shared/Icons.tsx`
- Converts every icon from `design_system/icons.jsx` into a typed React component.
- Props: `size?: number`, `strokeColor?: string`, defaults to `currentColor`.
- All existing `import Icon from "@mui/icons-material/…"` replaced with the matching custom icon.

### Component Rewrites (Priority Order)

| # | Component | Strategy | Key Changes |
|---|---|---|---|
| 1 | `theme.ts` | Shrink | Remove glassSx, palette, typography overrides. Keep a minimal dark-friendly MUI theme skeleton for Dialog/Select/Tabs. |
| 2 | `App.tsx` | Extend | Add `ThemeProvider` context, `data-theme` on `<html>`, import token CSS. |
| 3 | `Icons.tsx` | New | All 24 custom stroke icons. |
| 4 | `AppShell.tsx` | Restyle | Remove MUI `Box` wrappers. Use plain `<div>` with `className="app"` and flex layout via inline styles referencing `var(--*)`. Widths stay 248 / auto / 320. |
| 5 | `LeftSidebar.tsx` | Rewrite | Match `SidebarProjects` artboard: logo + title header, "Projects" eyebrow with count, project list with dot indicators + active highlight, folder icon, create flow, user avatar strip, settings button. |
| 6 | `ChatPanel.tsx` | Restyle | Add styled `ChatHeader` sub-component (title + folder path + chip counts), set background to `var(--bg)`. |
| 7 | `MessageList.tsx` | Rewrite | Replace `Paper`/`Typography` with `.bubble` markup. User bubble: `var(--accent)` bg + `var(--ink-on-accent)` text, rounded `14px 14px 4px 14px`. Assistant bubble: `var(--surface)` bg + `var(--ink)` text, rounded `14px 14px 14px 4px`. Meta timestamps in `t-mono t-tertiary`. |
| 8 | `MessageInput.tsx` | Rewrite | Match `Composer` artboard: card wrapper with shadow, textarea without border, model selector pill button, tier buttons (Quick/Standard/Deep — styled, non-functional for now), send button. |
| 9 | `ResearchStatusBar.tsx` | Rewrite | Match `ResearchBar` artboard: pulsing dot, colored soft backgrounds, chip for subagent count, cancel/retry/view buttons. |
| 10 | `DetailsPanel.tsx` | Restructure | Add `MemoryStrip` sub-component (new, from artboard). Restyle `RecentOutputsPanel`. Keep `FileExplorer` but restyle its rows to match `ArtifactsList` artboard look. |
| 11 | `SettingsModal.tsx` | Rewrite | Match `SettingsShell` artboard: card with shadow, custom tab bar with underline accent (not MUI Tabs), cancel/save footer. Sub-tabs restyled per artboards: `GeneralTab` (toggles, theme selector pills), `ModelProviderTab` (provider cards with radio dots, reachability dots), `AuditTab` (table with styled headers + chip status), `SkillsTab` (list with bolt icon, toggle, expand). |
| 12 | Banners & Modals | Restyle | `PendingCommandBanner`, `PendingPathBanner`, `PendingToolBanner` restyled per `BannersArtboard`. `PendingCommandModal`, `PendingToolModal`, `PendingPathModal`, `ReviewDialog` restyled with `.card` + custom header icons. |

### Files Affected

- **New:** `src/renderer/components/shared/Icons.tsx`, `src/renderer/theme/ThemeProvider.tsx` (or inline in App), `src/renderer/styles/tokens.css`, `src/renderer/styles/tokens-dark.css` (copied/adapted from `design_system/`).
- **Modified heavily:** `App.tsx`, `theme.ts`, `AppShell.tsx`, `LeftSidebar.tsx`, `MessageList.tsx`, `MessageInput.tsx`, `ResearchStatusBar.tsx`, `DetailsPanel.tsx`, `SettingsModal.tsx`, `GeneralTab.tsx`, `ModelProviderTab.tsx`, `AuditTab.tsx`, `SkillsTab.tsx`.
- **Modified lightly:** `ChatPanel.tsx`, `FileExplorer.tsx`, `PendingCommandBanner.tsx`, `PendingPathBanner.tsx`, `PendingToolBanner.tsx`, `PendingCommandModal.tsx`, `PendingToolModal.tsx`, `PendingPathModal.tsx`, `ReviewDialog.tsx`.
- **Deleted:** `glassSx` export from `theme.ts`.
- **Tests:** Update snapshots and test selectors where markup changes. No test logic changes.

### MUI Components Kept (with overrides)

| Component | Where | Override Strategy |
|---|---|---|
| Dialog | Settings modal, confirm dialogs | `slotProps={{ paper: { className: 'card' } }}` — rely on CSS var inheritance |
| Select | Model dropdown in MessageInput, Settings | Override `MenuProps` paper class, selected item colors |
| Tabs | Settings tab bar | **Replace** with custom tab bar per artboard. MUI Tabs removed. |
| Menu | Project context menu in LeftSidebar | Override paper bg/border colors |
| TextField | Input fields | Override root styles to match `.input` class |

### CSS Classes to Port from Artboards

Ported into the global stylesheet:
- `.app`
- `.btn`, `.btn--primary`, `.btn--outline`, `.btn--ghost`, `.btn--danger`, `.btn--sm`, `.btn--icon`
- `.input`, `.input--sunken`
- `.chip`, `.chip--accent`, `.chip--success`, `.chip--warn`, `.chip--danger`, `.chip--info`, `.chip--mono`
- `.card`
- `.dot`, `.dot--accent`, `.dot--success`, `.dot--warn`, `.dot--danger`, `.dot--idle`, `.dot--pulse`
- `.eyebrow`
- `.kbd`
- `.thin-scroll`
- `.hr`
- `.t-secondary`, `.t-tertiary`, `.t-mono`, `.t-num`
- `.titlebar` (if custom titlebar enabled later)

### Theme Persistence

A new `theme` field is added to `Settings` schema (light / dark / system). `SettingsService` reads/writes it alongside existing settings. Default: `system`.

### Testing Checklist

- `bun run typecheck` — zero errors
- `bun run check` — Biome clean
- `bun run test` — all existing tests pass (snapshot updates as needed)
- Launch with `-- --remote-debugging-port=9222`, visually verify light+dark, sidebar, chat, settings, banners

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| MUI component styling fights custom CSS | Isolate MUI overrides to a small `mui-overrides.css` file; scope them under `.mui` class if needed. |
| CSS variable performance in Electron | oklch() is natively supported in Chromium ≥ 111. Electron 35+ is fine. |
| Tests break from selector changes | Run tests after each component; update `data-testid` and selectors as we go. |
| Design system evolves | Tokens are source of truth. If artboards change, update the two CSS files only. |

---
*Spec approved → proceed to implementation plan.*
