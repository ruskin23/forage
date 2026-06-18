---
name: forage-renderer
description: Use when editing any code in src/renderer/. Covers React patterns, Zustand store usage, IPC wrapping, vim keymap integration, Tailwind discipline, and component organization for the Forage UI.
---

# Forage Renderer Conventions

How to write UI code. Read this before editing anything in `src/renderer/`.

## Component rules

- **Functional components only.** No classes.
- **One component per file.** Filename matches component name (`PaperDetail.tsx` exports `PaperDetail`).
- **Components colocated by zone.** `reader/`, `control/`, `lab/`. Shared cross-zone components go in `components/`.
- **No prop drilling more than two levels.** If you'd pass a prop through three layers, lift to Zustand.
- **No default exports** for components — named exports only. Easier to grep, easier to rename.

## State

Three places state can live, in order of preference:

1. **Local `useState`** — component-private state (form input, expanded row).
2. **Zustand store** (`src/renderer/stores/`) — global UI state (vim mode, selected indices, modal open/closed).
3. **Server state via `useIpc`** — anything that comes from the main process.

Never use:

- **React Context for global state.** Zustand wins — no provider boilerplate, fewer re-render footguns.
- **`useEffect` for derived state.** If a value can be computed from props or state, compute it inline or with `useMemo`. The only valid `useEffect` cases are: side effects that touch DOM/window APIs, subscribing to IPC events, cleanup of subscriptions.
- **`useReducer`.** Zustand is already a reducer. Pick one.

## IPC

All IPC calls go through `src/renderer/ipc.ts`. Never call `window.electron.invoke` directly from a component.

```ts
// good — typed wrapper
const papers = await ipc.papers.feed(feedId);

// bad
const papers = await window.electron.invoke('papers:feed', feedId);
```

Pattern for IPC:

- Wrappers in `ipc.ts` are grouped by topic and one function per channel.
- Use `useIpc(call, deps)` for fetch-on-mount + refetch on dep change.
- Subscribe to push events (`paper:status`, `run:update`, `job:update`) via the hook in `useIpc`. Components should never call `window.electron.on` directly.

When a push event arrives, **patch local state in place** when possible — don't refetch the whole list for every event. Refetch only on lifecycle transitions (run completed, run failed).

## Vim integration

All keyboard navigation goes through `useKeyMap`. Never `addEventListener('keydown', ...)` in a component.

```ts
useKeyMap('reader:feed', {
  j: () => moveDown(),
  k: () => moveUp(),
  Enter: () => openSelected(),
});
```

Rules:

- One keymap per "context" (zone × panel × mode). The active keymap is determined by the vim store.
- Escape unwinding is hierarchical: the global handler closes modals/exits modes, individual keymaps handle view-level teardown (close detail panel, deselect). Don't blind-call `popContext()`.
- Don't bind keys that already mean something in vim (`gg`, `G`, `j/k`, `h/l`) to non-vim actions.
- Zone switching is commands only (`:Reader`, `:ControlRoom`, `:Lab`). Don't add keyboard shortcuts for it.

## Styling

- **Tailwind utility classes only.** No styled-components, no CSS modules, no inline `style={{}}` except for dynamic values that can't be expressed in Tailwind (computed widths, transforms with variables).
- **Use semantic theme tokens**, not raw colors. `bg-bg-base`, `bg-bg-surface`, `border-divider`, `text-fg-primary`, `text-accent` — defined in `src/renderer/index.css`. If you need a new color, add it to the theme, don't hardcode.
- **Monospace for data values.** Numbers, IDs, paths, code-like strings get `font-mono`. Prose stays in the default font.
- **No cards.** Dividers only — `border-b border-divider`.
- **Animations via Framer Motion.** Stagger lists, fade modals. Keep durations short (150–250ms). Don't animate everything; animate transitions that benefit from continuity.

## Hooks

- Custom hooks live in `src/renderer/hooks/`.
- Hooks return a tuple or object — pick one and stick with it per hook.
- Don't write a hook that wraps a single `useState`. Just use `useState`.

## Forms / inputs

- Controlled inputs only. `value` + `onChange`.
- No form libraries (react-hook-form, formik) unless a form gets actually complex. Forage's forms are short — plain state is fine.

## Re-renders

- Don't memoize prematurely. `React.memo`, `useMemo`, `useCallback` only when a profiler shows a real problem.
- Selectors in Zustand: pull only what the component needs (`useStore(s => s.selectedIndex)`), not the whole store.

## What "done" looks like for a renderer change

- No `useEffect` for derived state
- No raw `window.electron.*` calls
- No raw `addEventListener('keydown')`
- Tailwind tokens, no hardcoded hex
- Push events patch local state where possible
- Component is in the right zone directory, named export
