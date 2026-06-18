# Database Schema

Postgres 16 (single-user, no auth in v1). Source of truth is `src/main/db/migrations/` (currently a single `001_initial.sql`).

The dev DB lives in the `docker-compose.yml` container; connection string is in `.env` as `DATABASE_URL` (defaults to `postgres://forage:forage@localhost:5433/forage`).

## Conventions

- IDs: `BIGSERIAL PRIMARY KEY`, returned to JS as `number` (the postgres-js client coerces BIGINT via a custom type).
- Timestamps: `TIMESTAMPTZ NOT NULL DEFAULT now()`, returned to JS as ISO strings (also via a custom type).
- JSON-shaped fields: `jsonb` columns. Returned as parsed JS objects/arrays. Written via `${sql.json(asJson(value))}` — `asJson` is the explicit DB-boundary cast.
- Enum-like fields: `TEXT` with a `CHECK (col IN (...))` constraint, matching the unions in `src/shared/enums.ts`.
- Column names are snake_case in SQL, camelCase in JS — `postgres.camel` transform flips them both ways.

## Tables

### feeds
One row per fetch date. Papers belong to a feed.
```sql
CREATE TABLE feeds (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,                  -- YYYY-MM-DD
  paper_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### papers
```sql
CREATE TABLE papers (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES feeds(id),
  arxiv_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  authors jsonb NOT NULL,                     -- string[]
  abstract TEXT,
  categories jsonb NOT NULL,                  -- string[]
  primary_category TEXT NOT NULL,
  published TEXT,                             -- YYYY-MM-DD
  pdf_url TEXT,
  source_details jsonb,                       -- { numberFiles, sourceType }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_papers_feed_id ON papers(feed_id);
```

### paper_status
User interaction state per paper.
```sql
CREATE TABLE paper_status (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  status TEXT NOT NULL CHECK (status IN ('dismissed', 'liked', 'read', 'unread')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### paper_progress
Per-paper pipeline step tracking. One row per paper, overwritten as it advances.
```sql
CREATE TABLE paper_progress (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  step TEXT NOT NULL CHECK (step IN ('fetch', 'download', 'summarize', 'profile', 'score')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
`profile` is a global step (no per-paper rows). `score` rows replace the prior `summarize` row when a paper advances.

### pipeline_runs
```sql
CREATE TABLE pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES feeds(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  steps_queued TEXT NOT NULL,
  steps_completed TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

### jobs
```sql
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES pipeline_runs(id),
  type TEXT NOT NULL CHECK (type IN ('fetch', 'download', 'summarize', 'profile', 'score')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_run_id ON jobs(run_id);
```

### summary_versions
Append-only summary history.
```sql
CREATE TABLE summary_versions (
  id BIGSERIAL PRIMARY KEY,
  paper_id BIGINT NOT NULL REFERENCES papers(id),
  description TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  usage_json jsonb,                            -- { inputTokens, outputTokens, totalTokens, mode }
  job_id BIGINT REFERENCES jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_summary_versions_paper_id ON summary_versions(paper_id);
```

### active_summary
```sql
CREATE TABLE active_summary (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  version_id BIGINT NOT NULL REFERENCES summary_versions(id)
);
```

### profile_versions
Append-only profile history. Single user — no user_id.
```sql
CREATE TABLE profile_versions (
  id BIGSERIAL PRIMARY KEY,
  profile_summary TEXT,
  interests jsonb,                            -- ProfileEntry[]
  dismissal_patterns jsonb,
  category_preferences jsonb,
  author_affinity jsonb,
  dismissed_paper_ids jsonb,                  -- bigint[]
  kept_paper_ids jsonb,
  model TEXT,
  paper_count INTEGER,
  usage_json jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### active_profile
Single-row table holding the active profile id (id = 1).
```sql
CREATE TABLE active_profile (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version_id BIGINT NOT NULL REFERENCES profile_versions(id)
);
```

### scores
```sql
CREATE TABLE scores (
  id BIGSERIAL PRIMARY KEY,
  paper_id BIGINT NOT NULL UNIQUE REFERENCES papers(id),
  profile_version_id BIGINT NOT NULL REFERENCES profile_versions(id),
  score REAL NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
  reasoning TEXT,
  model TEXT,
  usage_json jsonb,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_score ON scores(score DESC);
```
Upserts on `paper_id` — re-scoring after a profile rebuild replaces the row.

### lab_runs
Reserved for the Lab zone (ad-hoc agent runs). Pipeline runs persist directly to the version/score tables.
```sql
CREATE TABLE lab_runs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  paper_id BIGINT REFERENCES papers(id),
  model TEXT,
  prompt_version TEXT,
  config_json jsonb,
  output_json jsonb NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### settings
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### _forage_migrations
Bookkeeping for `runMigrations`. Each row records an applied migration version.
```sql
CREATE TABLE _forage_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Key relationships

```
pipeline_runs → feed_id → feeds → papers
pipeline_runs → jobs (via run_id)
papers → paper_progress (pipeline step tracking)
papers → paper_status (user interaction)
```

Constraint: only one `pipeline_runs` row with `status = 'running'` should exist (orchestrator enforces in code).

## Versioning pattern

Two-table pattern for summaries and profiles:
- **Versions table**: append-only history. Never update, always insert.
- **Pointer table**: `active_summary` (per paper) / `active_profile` (single row, id=1) — `version_id` points to the active version.
- **Promote**: update pointer's `version_id` to an existing version (no rewrite of the version row itself).

## Staleness detection

`scores.profile_version_id` tracks which profile version produced each score. After a profile rebuild, `getPapersToScore` automatically re-selects papers whose score points to a stale profile version.

## V1 simplifications

- No `sources` table — v1 is arXiv-only. `feeds` is the top-level grouping (one per date).
- `arxiv_id` instead of generic `external_id`.
- No `source_id` on pipeline_runs or jobs.
- Paper source file path is deterministic (`<userData>/papers/<arxivId>/`), not stored in DB.
