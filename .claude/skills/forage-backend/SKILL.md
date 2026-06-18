---
name: forage-backend
description: Use when editing TypeScript code in src/main/ outside src/main/db/ and src/main/agents/. Covers TS style, async/cancellation patterns, error handling, service composition, and type discipline for the Electron main process.
---

# Forage Backend Conventions

How to write TypeScript in the main process. Read this before editing anything in `src/main/services/`, `src/main/sources/`, `src/main/ipc/`, or top-level main code.

## Type discipline

- **No `any`.** If you reach for `any`, the answer is almost always to type the data properly or use `unknown` + a narrowing function.
- **No `as` casts** outside two boundaries:
  1. DB rows → typed interface (snake_case → camelCase mapping in the query function)
  2. `JSON.parse()` results
  Anywhere else, use a type annotation (`const x: Foo = ...`) or proper narrowing (`x instanceof HTMLElement`, etc). The IPC bridge is fully typed via `src/shared/ipcChannels.ts` — no casts needed.
- **Prefer `Omit` / `Pick`** for derived types: `type NewPaper = Omit<Paper, 'id' | 'createdAt'>`. Don't duplicate field lists.
- **Types live in `shared/types.ts`.** Never declare a domain interface inside a service file.

## Async + cancellation

Any function that does I/O (network, DB write that loops, file system, agent run) takes `signal: AbortSignal` as its **last parameter**. No exceptions.

```ts
// good
async function downloadSource(arxivId: string, signal: AbortSignal): Promise<DownloadResult> { ... }

// bad — no signal
async function downloadSource(arxivId: string): Promise<DownloadResult> { ... }

// bad — signal not last
async function downloadSource(signal: AbortSignal, arxivId: string): Promise<DownloadResult> { ... }
```

Inside such a function:

- Pass `signal` to every `fetch()` call.
- Use `abortableSleep(ms, signal)` instead of `setTimeout`.
- Call `signal.throwIfAborted()` at the top of each loop iteration that does work.
- Pass `signal` to any nested call that accepts one.

When catching errors that may be cancellations, use `isCancellation(err)` to distinguish. Re-throw cancellations. Handle real errors.

```ts
try {
  await doWork(signal);
} catch (err) {
  if (isCancellation(err)) throw err;
  // real error — log, mark job failed, etc.
}
```

## Error handling

- **Errors propagate.** Don't swallow them with empty catches.
- **Translate at boundaries.** IPC handlers are the boundary — they catch errors from services and either return an error result or let it surface as a rejected invoke.
- **Job-level errors** go on `jobs.error`. **Paper-level errors** go on `paper_progress.error`. Don't mix.
- **No silent fallbacks** that hide failure. The download fallback (e-print → PDF) is fine because both are valid outcomes; a fallback that turns a 500 into a fake-success is not.

## Service composition

Services are classes. Dependencies come in via the constructor — never construct a service inside another service.

```ts
// good
class PipelineService {
  constructor(
    private db: Database,
    private storage: StorageService,
    private events: EventEmitter,
  ) {}
}

// bad
class PipelineService {
  private storage = new StorageService();  // hidden dep, untestable
}
```

Wiring happens once in `src/main/index.ts`. If two services need each other, the dependency probably belongs in a third service or in the Orchestrator. Don't use `await import()` to break a cycle.

## IPC handlers

Handlers in `src/main/ipc/<topic>.ts` register channels via `ipcMain.handle`. Rules:

- Channel names use `topic:action` format: `pipeline:start`, `papers:feed`, `feed:step-counts`.
- Handlers parse args, call one or two service methods, return. No SQL, no business logic.
- Every handler has a typed wrapper in `src/renderer/ipc.ts` — adding a channel without a wrapper is incomplete.
- Errors thrown from a handler reject the renderer's `invoke()`. Don't catch and return `{ ok: false }` — let it throw.

## Logging

- Use `console.log` / `console.error` for now. A real logger can come later if needed.
- Log at boundaries: start of a pipeline run, agent invocation, IPC error. Don't log inside tight loops.
- **Never log secrets.** API keys, full request bodies that may contain keys.

## Imports

- Use the `@shared` alias for shared types and enums: `import { Paper } from '@shared/types'`.
- Use relative imports within a layer (`./EventEmitter`, `../db/queries/papers`).
- Group imports: external, then `@shared`, then relative. No enforced ordering tool — just be consistent.

## File organization

- One service per file, named the same as the class.
- One source per file in `src/main/sources/<name>.ts`, exporting the functions (not a class — sources are stateless).
- Query files in `src/main/db/queries/<table>.ts` — see the database skill.

## What "done" looks like for a backend change

- Types are in `shared/types.ts` if they're shared
- Function signatures take `AbortSignal` last where applicable
- No `any`, no out-of-boundary `as`
- Errors propagate or are handled at a sensible boundary
- IPC handler has a renderer wrapper
- If it touches state the renderer cares about, the right event fires
