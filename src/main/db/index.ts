import postgres from 'postgres';
import type { Migration } from './migrations';

// `postgres.camel` flips column names both ways: snake_case in SQL ↔ camelCase
// in JS. SELECTs return camelCased keys; insert helpers translate camelCase
// JS keys to snake_case columns.
type CustomTypes = {
  bigint: number;
  timestamptz: string;
};

export type Sql = postgres.Sql<CustomTypes>;

// Cast at the jsonb-write boundary. Our typed interfaces (ProfileEntry[],
// UsageRecord, SourceDetails, ...) are valid JSON but don't satisfy
// postgres-js's structural `JSONValue` type. This boundary cast is
// explicitly allowed by the project rules.
export function asJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

let sql: Sql | null = null;

interface MigrationRow {
  version: number;
}

export async function initDatabase(
  migrations: Migration[],
  connectionString?: string,
): Promise<Sql> {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Add it to .env at the project root.');

  const client = postgres(url, {
    transform: postgres.camel,
    onnotice: () => undefined,
    // Coerce BIGINT (oid 20) → JS number. Forage is single-user; ids will not
    // exceed Number.MAX_SAFE_INTEGER.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (n: number | bigint) => String(n),
        parse: (s: string) => Number(s),
      },
      // Return TIMESTAMPTZ (1184) and TIMESTAMP (1114) as ISO strings, not
      // Date objects. Matches the on-the-wire shape used elsewhere.
      timestamptz: {
        to: 1184,
        from: [1184, 1114],
        serialize: (v: string | Date) => (v instanceof Date ? v.toISOString() : v),
        parse: (s: string) => new Date(s).toISOString(),
      },
    },
  });

  await runMigrations(client, migrations);
  sql = client;
  return client;
}

export function getDatabase(): Sql {
  if (!sql) throw new Error('Database not initialized — call initDatabase() first.');
  return sql;
}

export async function closeDatabase(): Promise<void> {
  if (!sql) return;
  await sql.end({ timeout: 5 });
  sql = null;
}

async function runMigrations(client: Sql, migrations: Migration[]): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS _forage_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await client<MigrationRow[]>`SELECT version FROM _forage_migrations`;
  const appliedVersions = new Set(applied.map((row) => row.version));

  for (const m of migrations) {
    if (appliedVersions.has(m.version)) continue;

    await client.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO _forage_migrations (version, name) VALUES (${m.version}, ${m.name})`;
    });
  }
}
