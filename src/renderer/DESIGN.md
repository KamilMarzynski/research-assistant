# Scholar Design System

> **For agentic workers:** Read this file before touching any renderer UI. Every visual decision must reference these rules.

## Philosophy

Warm, minimal, modern. Single terracotta accent on warm paper neutrals. No bold colors, no gradients, no drop shadows on light mode. Everything should feel like a calm workspace — not a dashboard.

## Tokens

Tokens live in `src/renderer/styles/tokens.css` (light) and `tokens-dark.css` (dark overrides). Always use CSS variables. **Never hardcode colors.** Never use hex/RGB/oklch literals in component code.

### Surfaces

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `oklch(0.985 0.008 70)` | `oklch(0.17 0.008 60)` | Page background |
| `--surface` | `oklch(0.97 0.01 70)` | `oklch(0.21 0.01 60)` | Cards, sidebars, panels |
| `--surface-2` | `oklch(0.94 0.012 70)` | `oklch(0.25 0.012 60)` | Sunken — inputs, code blocks |
| `--surface-3` | `oklch(0.91 0.014 70)` | `oklch(0.3 0.014 60)` | Hover on surface-2 |
| `--line` | `oklch(0.9 0.012 70)` | `oklch(0.3 0.012 60)` | Hairlines, borders |
| `--line-strong` | `oklch(0.85 0.014 70)` | `oklch(0.38 0.014 60)` | Input borders, card borders |

### Ink (text)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--ink` | `oklch(0.22 0.012 60)` | `oklch(0.95 0.01 70)` | Body text |
| `--ink-2` | `oklch(0.45 0.012 60)` | `oklch(0.74 0.012 70)` | Secondary text |
| `--ink-3` | `oklch(0.62 0.01 70)` | `oklch(0.58 0.012 70)` | Tertiary / placeholders |
| `--ink-on-accent` | `oklch(0.99 0.005 70)` | `oklch(0.16 0.01 60)` | Text on accent bg |

### Accent (single hue — terracotta)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--accent` | `oklch(0.62 0.13 45)` | `oklch(0.74 0.14 50)` | Primary accent |
| `--accent-hover` | `oklch(0.56 0.14 45)` | `oklch(0.8 0.14 50)` | Hover state |
| `--accent-soft` | `oklch(0.93 0.04 45)` | `oklch(0.3 0.06 45)` | Tinted background |
| `--accent-line` | `oklch(0.82 0.07 45)` | `oklch(0.42 0.09 45)` | Accent borders |

### Status colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--success` | `oklch(0.58 0.09 145)` | `oklch(0.74 0.1 145)` | Success |
| `--success-soft` | `oklch(0.94 0.03 145)` | `oklch(0.28 0.04 145)` | Success bg |
| `--warn` | `oklch(0.7 0.11 75)` | `oklch(0.8 0.12 80)` | Warning |
| `--warn-soft` | `oklch(0.95 0.04 75)` | `oklch(0.3 0.05 75)` | Warning bg |
| `--danger` | `oklch(0.55 0.13 25)` | `oklch(0.72 0.14 28)` | Danger |
| `--danger-hover` | `oklch(0.48 0.13 25)` | `oklch(0.65 0.14 28)` | Danger hover |
| `--danger-soft` | `oklch(0.94 0.04 25)` | `oklch(0.28 0.06 25)` | Danger bg |
| `--info` | `oklch(0.55 0.08 240)` | `oklch(0.74 0.1 240)` | Info |
| `--info-soft` | `oklch(0.94 0.03 240)` | `oklch(0.28 0.04 240)` | Info bg |

### Typography

| Token | Value |
|---|---|
| `--font-sans` | `"Inter", ui-sans-serif, system-ui, ...` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, ...` |
| `--text-xs` | `11px` |
| `--text-sm` | `12px` |
| `--text-base` | `13px` |
| `--text-md` | `14px` |
| `--text-lg` | `16px` |
| `--text-xl` | `20px` |
| `--text-2xl` | `28px` |

Base body: `font-size: var(--text-base)`, `color: var(--ink)`.

### Spacing

| Token | Value |
|---|---|
| `--s-1` | `4px` |
| `--s-2` | `8px` |
| `--s-3` | `12px` |
| `--s-4` | `16px` |
| `--s-5` | `20px` |
| `--s-6` | `24px` |
| `--s-8` | `32px` |
| `--s-10` | `40px` |
| `--s-12` | `48px` |

### Radius

| Token | Value | Usage |
|---|---|---|
| `--r-sm` | `6px` | Small buttons, inputs |
| `--r-md` | `10px` | Buttons, cards, dropdowns |
| `--r-lg` | `14px` | Large cards, modals |
| `--r-xl` | `20px` | Hero cards |
| `--r-pill` | `999px` | Chips, dots |

### Shadows

| Token | Light | Dark |
|---|---|---|
| `--shadow-1` | `0 1px 0 rgba/0.04, 0 1px 2px rgba/0.05` | `0 1px 0 rgba/0.3, 0 1px 2px rgba/0.35` |
| `--shadow-2` | `0 2px 4px rgba/0.06, 0 8px 24px rgba/0.08` | `0 2px 4px rgba/0.4, 0 8px 24px rgba/0.45` |
| `--shadow-3` | `0 4px 12px rgba/0.1, 0 24px 60px rgba/0.14` | `0 4px 12px rgba/0.5, 0 24px 60px rgba/0.6` |

## Theme Switching

Theme is controlled by `html[data-theme="dark"]` attribute. The `ThemeContext` (`src/renderer/theme/ThemeContext.tsx`) watches system preference and user setting. **Never** set `data-theme` manually in components.

Always import CSS tokens globally in your entry point:
```css
@import "./styles/tokens.css";
@import "./styles/tokens-dark.css";
```

## Utility Classes

Use these classes. **Do not** re-create equivalent inline styles.

### Buttons (`.btn`)

Base class: `.btn`. Add modifier classes for variants.

| Modifier | Effect |
|---|---|
| `.btn--primary` | Accent bg, white text |
| `.btn--outline` | Transparent bg, line-strong border |
| `.btn--ghost` | Transparent bg, ink-2 text |
| `.btn--danger` | Danger bg, white text |
| `.btn--sm` | Smaller padding + font |
| `.btn--icon` | Square icon-only button |

All buttons have built-in hover states via CSS. Do not add inline `:hover`.

### Input (`.input`)

`.input` — standard form input with Scholar border, focus ring, placeholder color.
`.input--sunken` — darker background (surface-2) variant.

### Chips (`.chip`)

`.chip` — pill-shaped label. Modifiers: `.chip--accent`, `.chip--success`, `.chip--warn`, `.chip--danger`, `.chip--info`, `.chip--mono`.

### Card (`.card`)

`.card` — surface bg, line border, r-lg radius. Add inline padding/shadow as needed.

### Status dots (`.dot`)

`.dot--accent`, `.dot--success`, `.dot--warn`, `.dot--danger`, `.dot--idle`.
`.dot--pulse` — pulsing animation for live states.

### Text helpers

`.t-secondary` — `var(--ink-2)`
`.t-tertiary` — `var(--ink-3)`
`.t-mono` — mono font
`.t-num` — tabular nums

### Scrollbar

`.thin-scroll` — subtle 8px scrollbar on webkit.

### Eyebrow

`.eyebrow` — uppercase, tracked, tiny section heading. Use for panel titles.

## Layout System

### App Shell

Three-column layout:
- **Left sidebar:** `248px` fixed width, `var(--surface)` bg, `1px solid var(--line)` right border
- **Center chat:** `flex: 1`, `var(--bg)` bg
- **Right details:** `320px` fixed width, `var(--surface)` bg, `1px solid var(--line)` left border

All columns: `height: 100%`, `overflow: hidden`.

### Chat Column

The chat conversation uses a **centered content column** pattern:
```tsx
<div style={{ maxWidth: 768, width: "100%", margin: "0 auto" }}>
```

Both `MessageList` and `MessageInput` use this wrapper. If you add new chat-adjacent panels (thinking steps, suggested prompts, etc.), wrap them in the same 768px centered column.

### Message Alignment

Inside the centered column:
- **User messages:** `marginLeft: "auto"` to push to right side
- **Assistant/system messages:** default left alignment
- **Message bubbles:** `maxWidth: 640`, `borderRadius: 14px` (asymmetric — sharp corner points toward speaker)
  - User: `14px 14px 4px 14px`
  - Assistant: `14px 14px 14px 4px`

### Sidebar

- Header: `padding: "38px 16px 14px"` (38px top for traffic light clearance on macOS)
- Section labels: `.eyebrow`
- Active project item: `background: var(--accent-soft)`, `color: oklch(0.42 0.12 45)`, `fontWeight: 500`
- Inactive item: `background: transparent`, `color: var(--ink)`, `fontWeight: 400`
- Status dot before project name: active gets `.dot--accent`, inactive gets `.dot--idle`

## Icon System

**Never use MUI Material Icons.** Import from `src/renderer/components/shared/Icons.tsx`.

All icons are SVG stroke icons:
- `size` prop controls pixel dimensions
- `stroke` controls stroke width (default 1.6)
- `strokeColor` defaults to `currentColor` — inherits parent text color
- `fill` defaults to `none` (outline style)

Available icons: `IconPlus`, `IconSearch`, `IconSettings`, `IconFolder`, `IconSend`, `IconChevD`, `IconChevR`, `IconArrowL`, `IconCheck`, `IconX`, `IconDoc`, `IconAlert`, `IconShield`, `IconBolt`, `IconBrain`, `IconTerm`, `IconTrash`, `IconRefresh`, `IconLink`, `IconEdit`, `IconCpu`, `IconGlobe`, `IconBook`, `IconLogo`.

## MUI Integration Rules

MUI is a minimal skeleton. Only these components are kept: `Dialog`, `Select`, `MenuItem`.

**Rule 1:** Always override MUI paper/surface colors with CSS variables.
```tsx
slotProps={{ paper: { sx: {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-3)",
} }}}}
```

**Rule 2:** Menu dropdowns must match Scholar styling:
```tsx
MenuProps={{
  slotProps: {
    paper: {
      sx: {
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-2)",
        color: "var(--ink)",
      },
    },
  },
}}
```

**Rule 3:** Menu items must have explicit hover/selected colors:
```tsx
sx={{
  color: "var(--ink)",
  background: "transparent",
  "&:hover": { background: "var(--surface-2)" },
  "&.Mui-selected": { background: "var(--accent-soft)", color: "oklch(0.42 0.12 45)" },
  "&.Mui-selected:hover": { background: "var(--accent-soft)" },
}}
```

**Rule 4:** MuiOutlinedInput-notchedOutline border must use `var(--line-strong)` and hover/focus must use `var(--accent)`.

**Rule 5:** No `CssBaseline` — Scholar tokens set body background directly.

## Component Patterns

### Dialog / Modal Content

All dialogs follow the same structure:
```tsx
<Dialog slotProps={{ paper: { sx: paperSx } }}>
  <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
    <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
  </div>
  <div style={{ padding: "22px 26px", flex: 1, overflow: "auto" }}>{content}</div>
  <div style={{
    padding: "14px 22px",
    borderTop: "1px solid var(--line)",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  }}>
    <button className="btn btn--ghost">Cancel</button>
    <button className="btn btn--primary">Action</button>
  </div>
</Dialog>
```

### Status Bar

Status bars use a rounded pill with soft background:
```tsx
style={{
  borderRadius: 10,
  padding: "8px 12px",
  background: isErr ? "var(--danger-soft)" : "var(--accent-soft)",
  border: `1px solid ${isErr ? "oklch(0.82 0.07 25)" : "var(--accent-line)"}`,
}}
```

Include a `.dot` before the label. Add `.dot--pulse` for active/live states.

### Code / Pre blocks

```tsx
<pre
  className="thin-scroll"
  style={{
    padding: 12,
    background: "var(--surface-2)",
    borderRadius: "var(--r-md)",
    fontSize: 12,
    maxHeight: 200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }}
>
```

### Empty state

```tsx
<div style={{
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxWidth: "85%",
}}>
  <div style={{
    padding: "12px 16px",
    borderRadius: 14,
    background: "var(--bg)",
    border: "1px solid var(--line)",
  }}>
    <p style={{ margin: "0 0 8px", color: "var(--ink-2)" }}>...message...</p>
  </div>
</div>
```

## Anti-Patterns (Never Do These)

- **Never** import `@mui/icons-material` — use `Icons.tsx`.
- **Never** use `CssBaseline` from MUI — it overrides Scholar body background.
- **Never** hardcode colors (hex, oklch, rgb) in component code — always use CSS vars.
- **Never** use MUI default colors for Select/MenuItem/Dialog — always override with CSS vars.
- **Never** create new font sizes outside the token scale — use `var(--text-xs)` through `var(--text-2xl)`.
- **Never** add new accent colors — the single terracotta hue is the brand.
- **Never** use `box-shadow` for elevation on light mode — Scholar uses borders. Shadows are only for dark mode depth.
- **Never** create ad-hoc button styles — use `.btn` + modifier classes.
- **Never** set `data-theme` manually — always go through `ThemeContext`.

## Checklist for New Components

Before committing a new UI component, verify:

- [ ] All colors use CSS custom properties (no hex/rgb literals)
- [ ] Borders use `var(--line)` or `var(--line-strong)`
- [ ] Border radius uses `var(--r-sm|md|lg|xl)`
- [ ] Typography uses `var(--text-xs|sm|base|md|lg|xl|2xl)`
- [ ] Buttons use `.btn` + modifier classes
- [ ] Icons come from `Icons.tsx` (not MUI)
- [ ] MUI components override paper/surface colors with CSS vars
- [ ] Dark mode works (test with `data-theme="dark"`)
- [ ] Chat-adjacent content fits inside 768px centered column
- [ ] No new oklch literals introduced (all tokens are in `tokens.css`)
