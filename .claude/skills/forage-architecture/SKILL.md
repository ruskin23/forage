---
name: forage-architecture
description: Use when designing a feature that spans layers, deciding where new code lives, or making any change that touches IPC channels, the event system, service composition, or pipeline step orchestration. Auto-fires on cross-cutting work in src/main/ipc/, src/main/services/, or any feature that bridges main and renderer.
---

# Forage Architecture

The map of how code is organized and how layers talk to each other. Read this before adding a new feature, a new pipeline step, a new IPC channel, or a new service.

## Layer rule

Code is organized into strict layers. Each layer can only call the layer directly below it.

```
Renderer (React + Zustand)
    │ window.electron.invoke / .on
    ▼
Preload (contextBridge)
    │
    ▼
IPC handlers (src/main/ipc/)
    │
    ▼
Services (src/main/services/)
    │
    ├──▶ Sources (src/main/sources/)      external APIs (arXiv)
    ├──▶ Queries (src/main/db/queries/)   raw SQL
    ├──▶ Agents  (src/main/agents/)       AI calls
    ├──▶ Storage (src/main/services/Storage.ts)
    └──▶ EventEmitter                     IPC push to renderer
```

Hard constraints:

- **Queries never import sources, services, agents, or storage.** Queries are pure SQL boundary.
- **Sources never import services or queries.** Sources are pure external-API boundary.
- **Agents never import services or queries directly.** They receive context via parameters or tools.
- **Services may call other services.** This is allowed. Use constructor injection (see backend skill).
- **IPC handlers stay thin.** Parse args, call one or two service methods, return. No business logic.

If a circular dep appears between two services, lift the shared logic into a third service or into the orchestrator. Never solve a circular import with `await import()`.

## Where new code goes

| What you're adding | Where |
|---|---|
| New external API (e.g., bioRxiv) | `src/main/sources/<name>.ts` |
| New table or schema change | New migration file `src/main/db/migrations/NNN_*.sql` |
| New SQL query | `src/main/db/queries/<table>.ts` |
| New AI agent | `src/main/agents/<name>Agent.ts` + prompt + tools |
| New pipeline step | Method on `PipelineService`, registered in `Orchestrator.orchestrateSteps` |
| New IPC channel | (1) Add row to `InvokeChannels` or `EventChannels` in `src/shared/ipcChannels.ts`. (2) Handler via `handle('channel', ...)` in `src/main/ipc/<topic>.ts`. (3) Wrapper in `src/renderer/ipc.ts`. (4) For events: payload type in `shared/eventTypes.ts`, emitter in `services/EventEmitter.ts`. |
| New zone (UI) | `src/renderer/<zone>/` directory + route in `App.tsx` |
| New shared type | `src/shared/types.ts` (full row) — see types-reuse rule below |

## Event flow direction

Events flow **main → renderer only**. There are exactly three event channels (defined in `shared/eventTypes.ts`):

- `paper:status` — per-paper progress within a step
- `run:update` — pipeline run lifecycle
- `job:update` — job lifecycle

Rules:

- The renderer never emits events. Local UI state lives in Zustand or component state.
- Adding a fourth channel is a deliberate decision — discuss before adding. Most "new event" needs are actually existing channels with richer payloads.
- The Orchestrator owns `run:update` and `job:update`. PipelineService owns `paper:status`. Don't cross these wires.
- Event payloads always include the full updated row (read it back from DB after writing). Do not send partials.

## Pipeline orchestration

A pipeline run = one row in `pipeline_runs`, N rows in `jobs` (one per step). The Orchestrator:

1. Calls `ensureFeed(date)` to get/create the feed
2. Checks the global "one running pipeline" constraint
3. Creates the `pipeline_run` row + N `job` rows (status `pending`)
4. For each step, in order: marks job `running`, calls the step method on PipelineService, marks job `completed` / `failed` / `skipped` / `cancelled`
5. Emits `run:update` and `job:update` at every state transition

Adding a new step:

1. Add method `runFooStep(date: FeedDate, signal: AbortSignal)` on `PipelineService`. Method must read its own input from DB, write its own output, emit `paper:status`, and respect cancellation.
2. Add `'foo'` to the `PipelineSteps` union in `shared/enums.ts`
3. Register in `Orchestrator.orchestrateSteps` step dispatch
4. If the step needs a UI toggle, add it to the Control Room trigger panel

Skip / cancel semantics:

- `skipped` — downstream step had no input (e.g., 0 papers from fetch). Mark the job `skipped`, do not run it.
- `cancelled` — user aborted the run. Remaining pending/running jobs become `cancelled`. Use `AbortSignal` to propagate.
- Distinguish abort errors from real errors. Use `isCancellation()` helper. Never swallow a non-cancel error.

## Cancellation

`AbortController` is created per run by the Orchestrator. The signal threads through:

1. PipelineService step method (last param)
2. Source-layer `fetch()` calls (passed to native fetch as `signal`)
3. `abortableSleep(ms, signal)` for any wait
4. Agent runs (`run(agent, input, { signal })`)
5. Manual `signal.throwIfAborted()` checks at loop boundaries

A function that does I/O **must** accept `AbortSignal` as its last parameter. No exceptions.

## Types-reuse rule

When you need to combine data, prefer fetching the pieces and joining client-side over creating a new combined type.

✅ Fetch `Paper[]` and `PaperStatus[]`, join by `paperId` in the component
❌ Create `PaperWithProgress` interface

New types in `shared/types.ts` only when they represent **genuinely new data** — e.g., an aggregate query result like `FeedStepCount`. Never for client-side joins.

## Settings & configuration

App config lives in the `settings` table (key/value, `key TEXT PRIMARY KEY, value TEXT`). Read via `getSetting(key)`, write via `setSetting(key, value)`. Use this for: API keys, model choices, threshold values, feature toggles. Don't introduce a config file or env-var system for app config — `settings` is the source of truth.

Secrets (OpenAI API key) live in `settings`, not in env vars. The user provides them via the UI. Never log secret values.
