# Renderer Architecture & Coding Guidelines

Source of truth for all UI code in `src/renderer/`. Read before writing or modifying any renderer code.

## File Organization

```
renderer/
├── App.tsx              # Zone router, global providers
├── index.tsx            # React root (mount only)
├── index.css            # Tailwind v4 theme, global styles
├── ipc.ts               # Typed IPC wrapper (one function per channel)
├── components/          # Shared components (used by 2+ zones)
│   ├── VimBar.tsx
│   ├── Header.tsx
│   ├── Modal.tsx
│   ├── ScoreBadge.tsx
│   └── CategoryTag.tsx
├── reader/              # Reader zone
│   ├── Reader.tsx        # Zone root — owns view state transitions
│   ├── FeedView.tsx      # Full-width paper list
│   ├── SplitView.tsx     # Two-panel layout (feed + detail)
│   ├── FeedItem.tsx      # Single paper row in the feed list
│   └── PaperDetail.tsx   # Full paper detail panel
├── control/             # Control Room zone
│   ├── ControlRoom.tsx   # Zone root — mouse-driven; trigger bar + feeds + history
│   ├── Calendar.tsx      # Inline month calendar for date selection
│   ├── RunsTab.tsx       # Run history list (right panel)
│   └── FeedDetail.tsx    # Feed paper list with status (right panel, when feed selected)
├── hooks/               # Shared hooks
│   ├── useKeyMap.ts      # Register a keymap on the vim context stack
│   └── useIpc.ts         # Generic IPC fetch hook (loading, error, data)
└── stores/              # Zustand stores
    ├── vim.ts            # Vim mode, context stack, pending chord
    └── ui.ts             # Current zone, active modal
```

### Rules

- A component starts in its zone folder. Moves to `components/` only when a second zone needs it.
- If a zone exceeds ~8 files, it can have its own `components/` or `hooks/` subdirectory. Don't create these preemptively.
- No barrel files (`index.ts` re-exports). Always use direct imports: `import { FeedItem } from './reader/FeedItem'`.
- One component per file. Filename matches the export.
- Small helper components used only by one parent can live in the parent's file (e.g. a `FeedItemMeta` used only inside `FeedItem.tsx`). Extract to a separate file when it exceeds ~30 lines.

## Component Patterns

### Function components, named exports

```tsx
// Good
export function FeedItem({ paper, active, onSelect }: FeedItemProps) {
  return <div>...</div>;
}

// Bad — no default exports
export default function FeedItem() { ... }
```

### Props types co-located

Define the props type at the top of the same file, not in a shared types file.

```tsx
type FeedItemProps = {
  paper: Paper;
  active: boolean;
  onSelect: () => void;
};

export function FeedItem({ paper, active, onSelect }: FeedItemProps) { ... }
```

Use `type` not `interface` for props (consistency — interfaces are for shared data shapes in `shared/types.ts`).

### Component hierarchy

Zone roots own view state transitions. Inner components are pure/presentational where possible.

```
Reader (zone root — manages feed view vs split view vs focus mode)
├── FeedView (receives papers, selected index, handlers)
│   └── FeedItem (single paper row, presentational)
└── SplitView (receives papers, selected paper)
    ├── FeedItem (reused, narrowed)
    └── PaperDetail (selected paper content)
```

Zone roots subscribe to stores. Leaf components receive data via props. Don't reach into stores from deep components unless there's a clear performance reason (avoiding prop chains 4+ levels deep).

### Conditional rendering

Use early returns or `&&` for conditional rendering. Don't nest ternaries.

```tsx
// Good
if (loading) return <Spinner />;
if (error) return <ErrorMsg error={error} />;
return <FeedView papers={papers} />;

// Bad
return loading ? <Spinner /> : error ? <ErrorMsg /> : <FeedView />;
```

## State Management — Zustand

Three store categories. Each is a separate file in `stores/`.

### VimStore (`stores/vim.ts`)

Owns all vim navigation state. This is the most critical store.

```tsx
type KeyMap = Record<string, () => void>;

type VimHint = {
  key: string;        // display string, e.g. 'j/k'
  label: string;      // e.g. 'navigate'
};

type VimContext = {
  name: string;       // e.g. 'feed-view', 'split-view', 'runs-tab'
  keyMap: KeyMap;
  hints: VimHint[];   // shown in VimBar when this context is on top
};

type VimState = {
  mode: 'normal' | 'command';
  contextStack: VimContext[];    // top = active context
  pendingChord: string | null;   // for multi-key sequences

  // Actions
  pushContext: (ctx: VimContext) => void;
  popContext: () => void;
  setMode: (mode: 'normal' | 'command') => void;
  setPendingChord: (key: string | null) => void;
  dispatch: (key: string) => void;  // resolve key against top context
};
```

Key concepts:
- **Context stack**: Entering a new view pushes a context. Esc pops it. This is the unwinding chain.
- **Pending chord**: For multi-key sequences. First key sets `pendingChord`, second key completes it (e.g. `g` then `g` → jump to top). Timeout (~500ms) clears pending.
- **Dispatch**: Checks `pendingChord` first (for chord completion), then looks up key in the top context's keyMap.

### UIStore (`stores/ui.ts`)

General UI state that doesn't belong to vim or data.

```tsx
type UIState = {
  zone: 'reader' | 'control';
  activeModal: string | null;     // 'calendar' | 'profile' | 'threshold' | 'dismissed' | null

  // Actions
  setZone: (zone: 'reader' | 'control') => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
};
```

### Data patterns

Data fetching does not need a Zustand store. Use custom hooks with `useIpc` (see Hooks section below). Data lives in component state via hooks, not in a global store.

If we later need cross-component data sharing (e.g. the same paper list accessed from multiple places), we can add a data store then. Not preemptively.

### Store rules

- Stores contain state and actions only. No side effects (IPC calls, timers) inside store actions.
- Components subscribe to specific slices: `const mode = useVimStore(s => s.mode)` — not `const store = useVimStore()`.
- Stores never import from components or hooks. Stores can import from other stores if needed.

## Keybinding System

### Architecture

```
window 'keydown' listener (single, in App.tsx or a top-level hook)
  → check mode (command mode? → route to VimBar)
  → check pendingChord (completing a multi-key sequence?)
  → look up key in top context's keyMap
  → call handler if found
```

### useKeyMap hook

Zones and views use `useKeyMap` to register their keys. It pushes a context on mount and pops on unmount.

```tsx
// In FeedView.tsx
useKeyMap('feed-view', {
  'j': () => moveDown(),
  'k': () => moveUp(),
  'Enter': () => openSplitView(),
  'd': () => dismissPaper(),
  's': () => starPaper(),
  'c': () => openModal('calendar'),
  'p': () => openModal('profile'),
  't': () => openModal('threshold'),
  'x': () => openModal('dismissed'),
});
```

The hook:

```tsx
function useKeyMap(name: string, keyMap: KeyMap, hints: VimHint[] = []) {
  const pushContext = useVimStore(s => s.pushContext);
  const popContext = useVimStore(s => s.popContext);

  useEffect(() => {
    pushContext({ name, keyMap, hints });
    return () => popContext();
  }, [name, keyMap, hints, pushContext, popContext]);
}
```

**Important**: Memoize keyMap and hints objects (via `useMemo`) to avoid pushing/popping on every render.

### VimBar hints

VimBar reads hints from the top context on the stack. Each view defines what hints to show alongside its keyMap. No static hint tables — hints are always context-sensitive.

### Escape unwinding

Escape is split between the global listener and individual keymaps:

**Global listener handles** (in order):
1. If in command mode → switch to normal mode
2. If a modal is open → close modal
3. Otherwise → dispatch `Escape` to the top context's keyMap

**Context keymaps handle** view-level unwinding (e.g. split view → feed view). Views that push a context bind `Escape` in their keyMap to do cleanup (reset view state, pop context). This lets each view control its own teardown logic rather than relying on a blind `popContext` from the global listener.

### Keys that should NOT be captured

Skip key handling when:
- The focused element is an `INPUT`, `TEXTAREA`, or `[contenteditable]`
- Exception: Escape should always work (to exit inputs/command mode)

## IPC Layer

### Typed wrapper (`ipc.ts`)

One function per IPC channel. All renderer-to-main communication goes through this file — both request/response (`invoke`) and push event listeners (`on`).

```tsx
const { invoke, on } = window.electron;

export const ipc = {
  // Request/response
  startPipeline: (steps, trigger, date) =>
    invoke('pipeline:start', steps, trigger, date) as Promise<void>,
  cancelPipeline: () =>
    invoke('pipeline:cancel') as Promise<void>,
  getPipelineRuns: () =>
    invoke('pipeline:runs') as Promise<PipelineRun[]>,
  getJobs: () =>
    invoke('job:runs') as Promise<Job[]>,
  getPapersByFeed: (feedId) =>
    invoke('papers:feed', feedId) as Promise<Paper[]>,
  getPaperStatuses: (feedId) =>
    invoke('papers:statuses', feedId) as Promise<PaperStatus[]>,
  getFeedStepCounts: () =>
    invoke('feed:step-counts') as Promise<FeedStepCount[]>,
  getFeeds: () =>
    invoke('feeds:all') as Promise<Feed[]>,

  // Push event listeners (main → renderer)
  onPaperStatus: (cb) =>
    on('paper:status', cb as (...args: unknown[]) => void),
  onRunUpdate: (cb) =>
    on('run:update', cb as (...args: unknown[]) => void),
  onJobUpdate: (cb) =>
    on('job:update', cb as (...args: unknown[]) => void),
};
```

`as` is acceptable here — this is the external API boundary (preload bridge has no type info). These are the only `as` casts allowed in renderer code.

### Event listeners

Event listeners are also defined in `ipc.ts` (alongside invoke wrappers). Zone roots subscribe to events directly in `useEffect` with cleanup:

```tsx
useEffect(() => {
  const unsubRun = ipc.onRunUpdate(({ run }) => { /* update state */ });
  const unsubJob = ipc.onJobUpdate(({ job }) => { /* update state */ });
  const unsubPaper = ipc.onPaperStatus(({ paperStatus, stepProgress }) => { /* update state */ });
  return () => { unsubRun(); unsubJob(); unsubPaper(); };
}, []);
```

### Rules

- Components never call `window.electron.invoke` or `window.electron.on` directly. Always go through `ipc.ts`.
- For data fetching, use `useIpc` hook or direct `ipc.*` calls in zone roots.
- For event subscriptions, zone roots subscribe in `useEffect` and manage state locally. No polling — all updates are event-driven.

## Hooks

### useIpc — generic data fetching

A reusable hook for IPC calls that manages loading/error/data state.

```tsx
function useIpc<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetcher()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, deps);

  return { data, loading, error };
}
```

### Domain hooks

Wrap `useIpc` for specific data needs:

```tsx
function usePapers(feedId: number) {
  return useIpc(() => ipc.getPapersByFeed(feedId), [feedId]);
}

function usePipelineRuns() {
  return useIpc(() => ipc.getPipelineRuns(), []);
}
```

### Hook rules

- Prefix with `use`.
- Keep hooks focused — one concern per hook.
- Hooks live in `hooks/` if shared, or in the zone folder if zone-specific.
- Event listener hooks (for main→renderer push) use `useEffect` with cleanup (return the unsubscribe function).

## Styling

### Tailwind inline, no abstractions

```tsx
// Good — utility classes inline
<div className="flex items-center gap-2 border-b border-divider py-3">

// Bad — don't extract to CSS classes unless it's a truly global pattern
<div className="feed-item-row">
```

### Conditional classes

Use template literals or a simple helper. No `classnames`/`clsx` library needed unless combinations get unwieldy.

```tsx
// Simple conditional
<div className={`px-3 py-2 ${active ? 'opacity-100' : 'opacity-45'}`}>

// If it gets complex (3+ conditionals), extract to a variable
const itemClass = [
  'px-3 py-2 border-b border-divider',
  active && 'opacity-100 border-l-2 border-l-accent',
  !active && 'opacity-40',
  dismissed && 'line-through text-text-muted',
].filter(Boolean).join(' ');
```

### Theme tokens

Use the CSS custom properties defined in `index.css` via Tailwind classes:

- Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-muted`
- Background: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`
- Accent: `text-accent`, `border-accent`
- Borders: `border-divider`
- Scores: `text-score-high`, `text-score-mid`, `text-score-low`
- Error: `text-dismiss`
- Tags: `bg-tag-ai`, `bg-tag-ml`, `bg-tag-nlp`, `bg-tag-cv`, `bg-tag-default`

Don't hardcode hex values in components. If a new color is needed, add it to `index.css` `@theme` first.

### Animation

Use Framer Motion for transitions. Standard patterns:

```tsx
// Modal enter/exit
<motion.div
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.96 }}
  transition={{ duration: 0.15 }}
>
```

Use `AnimatePresence` for exit animations. Keep transitions short (0.1s-0.2s) — the app should feel snappy.

## TypeScript Conventions

- Use `type` for props, local types, unions. Use `interface` only for shared data shapes (those go in `shared/types.ts`).
- No `as` casts except at the IPC boundary (`ipc.ts`). Use type annotations (`: Type`) everywhere else.
- No `any`. Use `unknown` if the type is truly unknown, then narrow.
- Prefer `Omit`/`Pick` to build derived types rather than redefining fields.
- No enums. Union types only (consistent with `shared/enums.ts`).

## Anti-patterns

Things to actively avoid:

- **Prop drilling 4+ levels** — if data needs to pass through 4 components, the intermediate ones probably shouldn't exist, or the data should come from a store.
- **`useEffect` for derived state** — if a value can be computed from existing state/props, compute it inline. Don't `useEffect` → `setState`.
- **Keys in component bodies** — key handlers go in `useKeyMap`, not in `useEffect` + `addEventListener` inside random components.
- **Inline IPC calls** — always go through hooks → ipc.ts → preload.
- **Spreading props** — don't `{...rest}` unless building a generic wrapper component. Be explicit about what a component accepts.
- **Over-abstracting early** — three similar `<div>` blocks are better than a premature `<FlexRow variant="paper">` abstraction. Extract when there's a clear third use case with identical structure.
