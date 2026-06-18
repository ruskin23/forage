---
name: forage-database
description: Use when editing src/main/db/ — adding migrations, writing queries, modifying schema, or working with jsonb columns. Covers Postgres setup, migration discipline, async query function shape, snake-to-camel mapping, and jsonb handling.
---

# Forage Database Conventions

How to evolve the schema and write queries. Read this before editing anything in `src/main/db/`.

## The DB is Postgres 16, talked to via `postgres` (Porsager)

- Local dev runs Postgres in the container defined by `docker-compose.yml`. Bring it up before `npm start` or running scripts: `docker compose up -d`.
- Connection string lives in `.env` as `DATABASE_URL` (default: `postgres://forage:forage@localhost:5433/forage`). Mapped to host port `5433` so it doesn't collide with a native Postgres on `5432`.
- Client is `postgres` from npm (Porsager) — async tagged-template SQL, no ORM, no query builder.
- Connection is configured once in `src/main/db/index.ts` with two important transforms:
  - `transform: postgres.camel` — flips column names both ways (snake_case in SQL ↔ camelCase in JS).
  - Custom types coerce `BIGINT` → `number` and `TIMESTAMPTZ` → ISO string at the wire.

## Migration discipline

Migrations are SQL files in `src/main/db/migrations/NNN_description.sql`, registered in `src/main/db/migrations.ts`.

Hard rules:

- **Never edit a shipped migration.** Once a migration runs on any machine (yours, a tester's), it's frozen. Schema changes go in a new migration file.
- **Numbering is sequential.** `001`, `002`, `003`. No gaps, no reordering.
- **Filename describes the change.** `003_add_score_threshold.sql`, not `003_misc.sql`.
- **Production migrations are imported as `?raw` strings** in `src/main/db/migrations.ts` (Vite embeds them at build). When you add a migration, add the import + register it in the `PROD_MIGRATIONS` array.
- **Test scripts (tsx) load migrations via `fs`** because `?raw` is a Vite-only import. `src/main/scripts/test-agents.ts` builds its own migration list from `fs.readdirSync(MIGRATION_DIR)` and passes it to `initDatabase()`.
- **`db/index.ts` does not import any migration files itself.** It takes the migrations list as a function argument.
- **`runMigrations` wraps each migration in `client.begin()`** — if the SQL fails partway, the transaction rolls back. Don't add explicit `BEGIN;` / `COMMIT;` to the SQL files.
- **No data migrations that depend on app code.** Only SQL. If you need a backfill driven by TS, add a one-shot script in `src/main/scripts/` and run it manually.

When schema changes affect existing types in `shared/types.ts`, update the type in the same change. Don't let DB and TS drift.

## Query files

Queries live in `src/main/db/queries/<table>.ts`. One file per primary table (or per closely related cluster — `paperStatus.ts`, `pipeline.ts`).

Each query is an exported `async` function:

```ts
import { Sql } from '../index';
import { Paper } from '@shared/types';

export async function getPaperById(sql: Sql, id: number): Promise<Paper | undefined> {
  const rows = await sql<Paper[]>`
    SELECT id, feed_id, arxiv_id, title, authors, abstract, categories,
           primary_category, published, pdf_url, source_details, created_at
    FROM papers WHERE id = ${id}
  `;
  return rows[0];
}
```

Conventions:

- **First arg is always `sql: Sql`.** Import the type from `'../index'`. Don't store sql on a class — pass it.
- **All queries are `async`.** Return `Promise<T>`.
- **Tagged templates only.** `sql\`SELECT ... ${value}\`` interpolates `${value}` as a parameterized bind, not string concat. Use `sql.unsafe(...)` only for migrations / DDL where parameterization isn't applicable.
- **Return narrow types**, not `any`. `Paper | undefined`, `Paper[]`, `number`. Postgres-js typing: `await sql<RowType[]>\`...\`` is the typed form.
- **No manual snake → camel mapping** — the `postgres.camel` transform handles it. Write SELECTs with snake_case columns and let results come back camelCased.
- **Naming:** verbs by intent — `getXById`, `listXByY`, `insertX`, `updateX`, `upsertX`, `deleteX`, `countXByY`. Avoid generic names like `findX` or `fetchX`.

## Inserts and returning ids

Use `RETURNING id` and grab the first row:

```ts
const rows = await sql<{ id: number }[]>`
  INSERT INTO papers (feed_id, arxiv_id, title, ...)
  VALUES (${newPaper.feedId}, ${newPaper.arxivId}, ${newPaper.title}, ...)
  RETURNING id
`;
return rows[0].id;
```

For multi-column inserts where every field comes from a single object, you can also use `${sql(obj, 'fieldA', 'fieldB', ...)}` — the helper translates camelCase keys to snake_case columns. Pick whichever reads cleaner per query.

## Upserts

Use `INSERT ... ON CONFLICT (col) DO UPDATE SET ... = EXCLUDED.col`:

```ts
await sql`
  INSERT INTO paper_progress (paper_id, step, status, error, updated_at)
  VALUES (${p.paperId}, ${p.step}, ${p.status}, ${p.error}, ${p.updatedAt})
  ON CONFLICT (paper_id) DO UPDATE SET
    step = EXCLUDED.step,
    status = EXCLUDED.status,
    error = EXCLUDED.error,
    updated_at = EXCLUDED.updated_at
`;
```

## jsonb columns

Use `jsonb` (not `json`) for any structured field — better operators, indexable, deduplicated storage.

Reads: postgres-js parses `jsonb` automatically. A column declared `jsonb` comes back as a parsed JS array/object. Type it accordingly in the row type.

Writes: wrap the value with `sql.json(asJson(value))`. `asJson` is exported from `db/index.ts` — it casts the typed JS value to postgres-js's structural `JSONValue`. Without `asJson` you'll get a TS error: our typed interfaces don't have an index signature, postgres-js's `JSONValue` does.

```ts
import { Sql, asJson } from '../index';

await sql`UPDATE papers SET source_details = ${sql.json(asJson(sourceDetails))} WHERE id = ${id}`;
```

For nullable jsonb fields, branch on null:

```ts
${version.usageJson === null ? null : sql.json(asJson(version.usageJson))}
```

You can query into jsonb (`source_details->>'sourceType'`, `interests @> '[{"confidence": "high"}]'`) when you need to. Promote frequently-filtered fields to columns if they become hot paths.

## Timestamps

Stored as `TIMESTAMPTZ NOT NULL DEFAULT now()`. Returned to JS as ISO strings (the connection has a custom type for `1184` / `1114` that calls `new Date(s).toISOString()`).

When you write a timestamp from JS, pass an ISO string — `new Date().toISOString()`.

## Ids

`BIGSERIAL PRIMARY KEY` for everything. Returned to JS as `number` thanks to a custom BIGINT type on the connection. Forage is single-user; ids will not exceed `Number.MAX_SAFE_INTEGER`.

## Indexes

- Foreign-key columns get an index. Postgres doesn't auto-index FKs.
- Add an index when a query filters or orders on a column at scale. Don't add speculatively — every index slows writes.
- Indexes go in the same migration that adds the column.
- jsonb has GIN index support; reach for it only if you actually query into a jsonb column.

## Constraints

- `FOREIGN KEY ... REFERENCES other(id)`. Add `ON DELETE CASCADE` where the child has no meaning without the parent.
- `CHECK` constraints for enum-like TEXT columns (`status TEXT CHECK (status IN ('pending', 'running', ...))`). Keep the CHECK list in sync with the TS union in `shared/enums.ts`.
- `NOT NULL` aggressively. Nullable columns should be a deliberate choice.

## Counters and progress

The `paper_progress` table is per-paper × per-step. Aggregates (how many papers completed step X for feed Y) are computed via a single query, not by counting from a service. See `getStepStats`, `getAllFeedStepCounts`. If you find yourself counting in TS, write the SQL.

## Don't

- **Don't use an ORM or query builder.** Tagged templates only.
- **Don't write SQL outside `db/queries/`.** Services, sources, agents, IPC handlers must call a query function. The migration runner in `db/index.ts` is the one exception — it bootstraps the query layer itself.
- **Don't store dates as numbers** unless there's a measured perf reason.
- **Don't add nullable columns to "support v2".** Add them when v2 needs them.

## What "done" looks like for a database change

- New migration file, sequentially numbered, registered in `db/migrations.ts`
- Types in `shared/types.ts` reflect the schema (with `jsonb` columns typed as their parsed shape, not strings)
- jsonb writes use `sql.json(asJson(...))`
- Indexes added if a new query filters on a non-PK column
- `CHECK` constraint matches the TS union, if applicable
- No SQL leaked outside `db/queries/`
- Both prod (`PROD_MIGRATIONS`) and the test rig find the new migration
