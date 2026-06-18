-- 001_initial.sql
-- Full schema for Forage v0.1 on Postgres 16.
--
-- Notes:
--   * jsonb is used for everything that was a TEXT-with-JSON column on SQLite.
--   * timestamptz with default now() replaces SQLite's `(datetime('now'))` strings.
--   * Enum-like fields are kept as TEXT so they line up with src/shared/enums.ts
--     unions; CHECK constraints document the allowed values.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE feeds (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,                  -- YYYY-MM-DD
  paper_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  source_details jsonb,                       -- { numberFiles, sourceType: 'PDF'|'TEX'|'TAR'|null }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_papers_feed_id ON papers(feed_id);

CREATE TABLE paper_status (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  status TEXT NOT NULL CHECK (status IN ('dismissed', 'liked', 'read', 'unread')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paper_progress (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  step TEXT NOT NULL CHECK (step IN ('fetch', 'download', 'summarize', 'profile', 'score')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES feeds(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  steps_queued TEXT NOT NULL,                 -- comma-separated for parity with v0.1 wire format
  steps_completed TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES pipeline_runs(id),
  type TEXT NOT NULL CHECK (type IN ('fetch', 'download', 'summarize', 'profile', 'score')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_run_id ON jobs(run_id);

CREATE TABLE summary_versions (
  id BIGSERIAL PRIMARY KEY,
  paper_id BIGINT NOT NULL REFERENCES papers(id),
  description TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  usage_json jsonb,                           -- { inputTokens, outputTokens, totalTokens, mode }
  job_id BIGINT REFERENCES jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_summary_versions_paper_id ON summary_versions(paper_id);

CREATE TABLE active_summary (
  paper_id BIGINT PRIMARY KEY REFERENCES papers(id),
  version_id BIGINT NOT NULL REFERENCES summary_versions(id)
);

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

CREATE TABLE active_profile (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version_id BIGINT NOT NULL REFERENCES profile_versions(id)
);

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
