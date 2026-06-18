# Forage

Desktop app for foraging knowledge — research papers (arXiv for v1), AI summaries, preference profiles, relevance scoring. Open source. Single-user, BYO OpenAI key.

## Tech stack

- **Runtime**: Electron (Electron Forge + Vite plugin)
- **Language**: TypeScript everywhere — main, preload, renderer, shared
- **UI**: React + Tailwind v4 + Zustand
- **DB**: Postgres 16 via `postgres` (Porsager) — async tagged-template SQL, no ORM. Local dev uses the Postgres container in `docker-compose.yml`.
- **AI**: `@openai/agents` + Zod
- **Build/package**: Electron Forge

## Where to find things

- **Conventions and architecture** live in `.claude/skills/`. Each skill auto-fires when relevant code is touched:
  - `forage-architecture` — layering, IPC, events, pipeline orchestration
  - `forage-backend` — main process TS style, async/cancellation, services
  - `forage-renderer` — React, Zustand, vim, Tailwind
  - `forage-database` — migrations, queries, JSON columns
  - `forage-agents` — OpenAI Agents SDK, prompts, tools
- **Reference docs** in `docs/` — schema, pipeline flow, agent specs, design system, vim keybindings. Start at `docs/index.md`.
- **All shared types** in `src/shared/types.ts`. All enums/unions in `src/shared/enums.ts`. Event payloads in `src/shared/eventTypes.ts`.

## Source layout (one-liner)

```
src/main/      — Electron main process (db, services, sources, agents, ipc)
src/preload/   — contextBridge
src/renderer/  — React UI (reader/, control/, lab/, components/, stores/, hooks/)
src/shared/    — types, enums, event payload types
docs/          — living reference docs
.claude/       — skills, settings
```

Pattern: **`ipc/ → services/ → (queries | sources | agents | storage)`**. See `forage-architecture` for full layering rules.

## Hard rules

- **Discussion-first.** Outline the plan, confirm, then implement. Don't jump to edits.
- **No lint suppression.** Fix the underlying issue, never `eslint-disable`.
- **No `any`. No `as`** outside DB rows and `JSON.parse` results.
- **Raw SQL only.** No ORM, no query builders. SQL lives in `db/queries/<table>.ts`.
- **Types reuse over reinvention.** Fetch pieces and join client-side; new combined types only for genuinely new shapes.
- **AbortSignal as last param** on any I/O function. Always thread cancellation.
- **Docs are living documents.** If implementation diverges from docs, update the docs as part of the change.
- **Don't write docs unless asked.** When asked, update existing files; only create new ones for new subsystems.

## Git

- **Branch**: `master` (default), feature branches as `feature/<name>`
- **Commits**: single-line conventional commits (`feat: add summary agent`, `fix: cancel race in pipeline`)
- **No AI mentions** in commit messages — no `Co-Authored-By` trailers, no "generated with" footers

## Critical gotchas

- **Preload file naming**: must be `preload.ts`, not `index.ts`. Main and preload both output to `.vite/build/` — same name = collision.
- **Postgres must be running**: `docker compose up -d` before `npm start`. Connection string lives in `.env` as `DATABASE_URL` (default port `5433` to avoid collision with a host Postgres on `5432`).
- **arXiv category**: must use `astro-ph*` (with wildcard) to match all subcategories. Bare `astro-ph` returns 0 results.
- **Migrations**: production imports SQL via `?raw` in `db/migrations.ts` (Vite-only). Test scripts (tsx) load SQL via `fs` and pass an own migration list to `initDatabase()`. `db/index.ts` does not import any migration files itself.
- **jsonb writes** go through `${sql.json(asJson(value))}` — `asJson()` casts our typed interfaces to postgres-js's structural `JSONValue`. This is the explicit DB-boundary cast.
