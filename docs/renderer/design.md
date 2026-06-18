# Design System

## Theme

Dark mode only. Everforest palette — warm, organic, forest-floor aesthetic. The app should feel like it belongs next to an Everforest-themed terminal.

### Colors

Derived from the Everforest color scheme. All defined as CSS custom properties in `index.css` `@theme` and referenced via Tailwind utility classes.

```
Backgrounds:
  Base:       #272e33  (dark forest green — main bg)
  Surface:    #2d353b  (panels, sidebars — one step lighter)
  Elevated:   #343f44  (expanded sections, overlays)

Text — warm cream hierarchy:
  Primary:    #d3c6aa  (main body text, titles)
  Secondary:  #9da9a0  (supporting text, descriptions)
  Tertiary:   #7a8478  (labels, section headers)
  Muted:      #5c6a72  (placeholder, disabled, hint text)

Accent — teal:
  Default:    #7fbbb3
  Hover:      #a7d4cd

Status:
  Success:    #a7c080  (sage green — completed, high score)
  Warning:    #dbbc7f  (warm gold — running, mid score)
  Error:      #e67e80  (soft coral — failed, dismissed)
  Inactive:   #5c6a72  (muted — pending, low score)

Category tags (arXiv subcategories):
  astro-ph.CO:  #d699b6  (dusty pink)
  astro-ph.GA:  #83c092  (medium green)
  astro-ph.HE:  #7fbbb3  (teal)
  astro-ph.IM:  #dbbc7f  (warm gold)
  Default:      #859289  (muted sage)

Borders:
  Divider:    #3d484d  (subtle, used everywhere)
```

### Tailwind Token Mapping

Components reference colors through Tailwind classes, never hardcoded hex:

```
text-text-primary, text-text-secondary, text-text-tertiary, text-text-muted
bg-bg-base, bg-bg-surface, bg-bg-elevated
text-accent, border-accent, text-accent-hover
text-score-high, text-score-mid, text-score-low
text-dismiss
bg-tag-ai, bg-tag-ml, bg-tag-nlp, bg-tag-cv, bg-tag-default
border-divider
```

If a new color is needed, add it to `index.css` `@theme` first. Never use inline hex values in components.

### Typography

- Sans: Inter (system fallback: system-ui, -apple-system, sans-serif)
- Monospace: for scores, metadata, data values, timestamps, step names, dates
- Font sizes: `text-xs` (11px), `text-sm` (14px), `text-lg` (18px titles)
- Section labels: `text-[11px] uppercase tracking-widest text-text-muted`

## Visual Patterns

### No Cards

Everything uses dividers (`border-divider`), not cards or filled containers. Maximize negative space. The only filled backgrounds are `bg-bg-surface` for sidebar panels and `bg-bg-elevated` for expanded/nested sections.

### Active Indicator

Selected items have a 2px teal bar on the left edge (`border-l-2 border-l-accent`). Non-active items at 40% opacity. Transition via `transition-opacity duration-100`.

### Noise Texture

Subtle SVG fractal noise overlay at 2% opacity across the entire viewport. Applied via `.noise::after` on the root `<div>`.

### Header

Sticky, glassmorphism: `backdrop-filter: blur(20px) saturate(1.2)`, semi-transparent bg matching base. Class: `header-blur`. Left side: app name ("Forage") in primary text. Right side: zone label in tertiary monospace.

### Depth via Background Steps

Three background levels create depth without borders or shadows:
- `bg-bg-base` — main content areas
- `bg-bg-surface` — sidebar panels, secondary areas
- `bg-bg-elevated` — expanded rows, overlays, popovers

## Interaction Patterns

### Reader (vim-first)

- `j/k` navigate, `Enter` open split view, `d` dismiss, `G/gg` bottom/top
- `c` calendar, `p` profile, `t` threshold, `x` dismissed, `s` rescore
- VimBar at bottom shows available actions
- Command mode via `:` (`:Feed`, `:ControlRoom`)

### Control Room (mouse-driven)

- No vim — all interaction is click. (Vim is Reader-only.)
- **Trigger bar** (top, full-width): date picker + the five steps as toggle pills in a left-to-right pipeline flow (`● fetch → ● download → ○ summarize → ○ profile → ○ score`, click to toggle) + a `run →` button. The run button is disabled with a "select at least one step" hint when nothing is selected; it becomes `cancel ✕` while a run is active (idempotent — disabled while waiting).
- **Below**: feeds list (left, click to open detail) + run history / feed detail (right).
- `Escape` closes the calendar dropdown, then the feed detail (component-handled, not vim).
- Run history shows live progress from events: per-step progress counters (e.g. "download 12/76, 1 failed") update in real-time next to running job dots. Click a run row to expand its job timestamps and error messages.
- Date selection: calendar dropdown (`Calendar.tsx`) from the date button — Monday-start, weekends dimmed as "no arXiv", feed dates dotted, future dates disabled. Click a day to select.

## Animation

Using Framer Motion:
- Page transitions: 0.2s opacity fade
- Feed items: staggered entry (0.04s delay per item), slide-left on dismiss
- Modals: scale(0.96 to 1) + fade, 0.15s
- Custom easing: [0.25, 0.46, 0.45, 0.94]

## Layout

### Structure

- **Header**: Sticky top, `header-blur`. Height: `h-10`. Border bottom: `border-divider`.
- **VimBar**: Fixed bottom bar, `h-8`. Reader only — context-sensitive key hints + command mode via `:`. Hidden in the Control Room.
- **Zone switching**: Header tabs (**Reader** / **Control Room**), shown in both zones. `:Feed` / `:ControlRoom` commands also work in the Reader.
- **Content area**: Between header and VimBar. Height: `h-[calc(100vh-5rem)]` (minus header + VimBar + bottom padding).

### Zone: Reader

Three view states, unwound with Escape:

1. **Feed view** (default): Centered column (`max-w-3xl mx-auto`), full-height paper list. Each item: title, truncated abstract, category tag pill, author list. Vim-navigated.
2. **Split view** (Enter on a paper): Left panel (w-80, paper list in compact mode) + right panel (full paper detail — abstract, summary, authors, categories, links).
3. **Focus mode** (not yet built): Active panel goes full-screen.

### Zone: Control Room

Mouse-driven. Full-width **trigger bar** on top, **feeds + history/detail** below.

- **Trigger bar** (`bg-bg-surface`, border-bottom): "New run" — a date picker button (opens a calendar dropdown), the five steps as toggle pills in a left-to-right pipeline flow, and a `run →` / `cancel ✕` button (disabled with a "select at least one step" hint when no step is selected).
- **Feeds** (left, w-56, `bg-bg-surface`): date + paper count rows. Click opens feed detail in the right panel (selected feed highlighted in accent); click again toggles off.
- **Right panel** (flex-1, `bg-bg-base`): Shows either **RunsTab** (default) or **FeedDetail** (when a feed is selected).
  - **RunsTab**: Run history. Each row: date, paper count with failure aggregate ("76 papers · 3 failed"), time, per-step colored status dots. Click a row to expand its jobs in `bg-bg-elevated`.
  - **FeedDetail**: Summary bar (date, paper count, total failed, per-step completed/failed breakdown) with a **← back** button. Below: paper list — title, arxivId, category, step status dot (● completed / ✗ failed), error for failed papers. Summary updates live via `paper:status` events. **← back** or `Escape` closes.

## Modals

Calendar (`c`), profile (`p`), threshold (`t`), dismissed papers (`x`) — all open as centered modals over the current zone. Animation: scale(0.96 to 1) + opacity fade, 0.15s. Escape to close.

## Components

### ScoreBadge

Monospace, 2 decimal places (0.00 format). Color by threshold:
- `text-score-high` (#a7c080, sage green): score >= 0.8
- `text-score-mid` (#dbbc7f, warm gold): score 0.6–0.8
- `text-score-low` (#5c6a72, muted): score < 0.6

### CategoryTag

Small pill with semantic color based on arXiv category. `text-bg-base` text on colored background. Uppercase monospace, `text-[10px]`.

### VimBar

Fixed bottom bar. Background: `bg-bg-base`, border top: `border-divider`. Shows context-sensitive key hints from the top vim context. In command mode: shows `:` prompt with accent-colored colon.

### FeedItem

Title + truncated abstract (2 lines) + meta row (category tag, authors). Active item: full opacity + teal indicator bar. Inactive: 40% opacity. Compact mode (for split view): title + meta only, no abstract.
