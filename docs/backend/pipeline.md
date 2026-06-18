# Pipeline

## Flow

```
fetch → download → summarize → profile → score
```

| Step | What | Input | Output |
|------|------|-------|--------|
| **fetch** | Query arXiv API for new papers | date, category (astro-ph*) | Feed row + paper rows in DB |
| **download** | Download LaTeX source tarballs | Papers at step=fetch | Extracted source files on disk |
| **summarize** | AI-generate summary for each paper | Papers at step=download | Summary versions in DB |
| **profile** | Rebuild preference profile from interactions | Labeled papers (dismissed/liked) | New profile version |
| **score** | Score papers against profile | Summarized papers + active profile | Score per paper |

## Step Details

### Fetch
1. Orchestrator ensures feed row exists for the date (via `ensureFeed`)
2. Query arXiv API: `cat:astro-ph* AND submittedDate:[range]`
3. Parse Atom XML response
4. Update feed's `paper_count`
5. Load existing arxiv IDs for the feed (`getArxivIdsForFeed`) — filter out papers already in DB
6. Insert only new papers (plain INSERT, no OR IGNORE)
7. 30-second delay between paginated requests (arXiv rate limit)
8. For each new paper: upsert paper_progress (step=fetch, status=completed) + emit `paper:status` event
9. Re-running fetch on a feed with existing papers is safe — existing papers and their progress are untouched

### Download
1. Query `getStepStats` for existing download progress (completed/failed counts + total papers in feed)
2. Get papers at step=fetch, status=completed OR step=download, status=failed (retries)
3. Progress counter starts from existing stats (e.g. `5/76` not `1/72` on resume)
4. For each paper:
   - `downloadSource(arxivId, pdfUrl)` tries e-print first, falls back to PDF URL, returns `DownloadResult { buffer, sourceType }`
   - If buffer exists: `StorageService.saveSource()` routes to `saveTarball` (TAR), `saveSingleFile` (TEX/PDF)
   - Count files via `StorageService.listFiles()`, write `source_details` JSON to papers table
   - Upsert paper_progress: step=download, status=completed
   - On failure: step=download, status=failed, error=reason
   - Emit `paper:status` event with step progress counts
5. 5-second delay between downloads (arXiv ToU: min 3s). Delay is abortable on cancel.
6. Papers with no source (both e-print and PDF fail) still complete — `sourceType: null, numberFiles: 0`

#### Source type detection
- `downloadSource` inspects gzip magic bytes (`0x1f 0x8b`) to distinguish TAR from single TEX file
- If e-print fails, falls back to PDF URL from paper metadata
- Cancellation (`DOMException AbortError` from `fetch()`) re-thrown, not swallowed by fallback logic

### Summarize
1. Get papers via `getPapersToSummarize` — step=download/completed, OR step=summarize/failed (retries).
2. For each paper:
   - Read `papers.source_details` to determine `sourceType` (PDF / TEX / TAR / null).
   - Pick a mode: `single_tex` (one .tex ≤ 40KB), `directory` (multiple files / large .tex, uses tools), or `abstract_only` (no source / PDF / empty dir).
   - Call `runSummary(db, input, signal)` → `{description, summary, mode, usage}`.
   - Directory mode catches max-turns / provider errors and retries once in `abstract_only` mode (cheap fallback).
   - Insert into `summary_versions` with `usage_json`, point `active_summary` at it.
   - `StorageService.deleteSource(arxivId)` (download → summarize → delete).
   - Upsert paper_progress: step=summarize, status=completed.
3. Per-paper errors tracked in paper_progress.
4. Cancellation propagates as `DOMException AbortError` from the SDK's `run()`.

### Profile
1. Get all labeled papers via `getLabeledPapers` (across feeds, capped at 500 most recent).
   - Labels derived from `paper_status.status`: `dismissed` → dismissed; `liked`/`read` → liked.
2. If zero labeled papers → throw `NO_INPUT_ERROR`. Orchestrator marks the job `skipped`.
3. Get previous active profile (`getActiveProfile`) and `countProfileVersions` for calibration.
4. Call `runProfile(db, input, signal)`:
   - Tools `get_paper_details(arxiv_id)` and `get_category_stats()` are DB closures provided in the run context.
   - Tool-loop fallback: if the agent run exceeds `maxTurns: 12` or errors, retry once with no tools.
5. Insert into `profile_versions` (with `usage_json`), point `active_profile` (id=1) at it.

### Score
1. Get active profile. If none → throw `NO_INPUT_ERROR` (job skipped).
2. Get `getPapersToScore(feedId, activeProfileVersionId)`:
   - step=summarize/completed
   - paper_status not 'dismissed'
   - scores row missing OR scored against a stale profile version
3. For each paper:
   - Read active summary (`getActiveSummary`) — passed to the scorer for description context.
   - Call `runScore(db, input, signal)` → `{score, reasoning, usage}`.
   - Upsert into `scores` (UNIQUE on paper_id, replaces stale rows automatically).
   - Upsert paper_progress: step=score, status=completed.
4. Per-paper errors tracked in paper_progress.

## Event System

Pipeline steps emit events to the renderer via `EventEmitter` (IPC wrapper). All events are push-only (main → renderer). The renderer does not poll — all state updates come through events.

### paper:status
Sent for each paper as it progresses through a step. Payload: `PaperStatusPayload`
```ts
{
  paperStatus: PaperStatus,    // { paperId, step, status, error, updatedAt }
  stepProgress: StepProgress,  // { success, failed, total }
}
```

- Pipeline writes to DB (`upsertPaperStatus`) and emits to UI in the same loop
- `StepProgress` counts initialized from `getStepStats` (DB query) so counters resume correctly
- Renderer uses these events for live progress display (e.g. "download 12/76, 1 failed")

### run:update
Sent when a pipeline run is created or its status changes. Payload: `RunUpdatePayload`
```ts
{
  run: PipelineRun   // full row read back from DB after write
}
```

Emitted on: run created (status=running), steps_completed updated, run completed/failed/cancelled.

### job:update
Sent when a job is created or its status changes. Payload: `JobUpdatePayload`
```ts
{
  job: Job   // full row read back from DB after write
}
```

Emitted on: job created (status=pending), job started (running), job completed/failed/skipped/cancelled.

### Event flow
```
PipelineService (owns paper-level progress)
  → upsertPaperStatus (DB write)
  → EventEmitter.paperStatus (IPC push to renderer)

PipelineOrchestrator (owns job/run lifecycle)
  → insertPipelineRun / updatePipelineRunStatus (DB write)
  → EventEmitter.runUpdate (IPC push — full PipelineRun from getRunById)
  → insertJob / updateJobStatus (DB write)
  → EventEmitter.jobUpdate (IPC push — full Job from getJobById)
```

## Cancellation

Pipeline runs can be cancelled mid-execution via `pipeline:cancel` IPC channel.

### Mechanism
- Orchestrator holds a `currentAbortController` per active run
- `cancel()` calls `abortController.abort()`
- Pipeline step methods receive the `AbortSignal` and check it between iterations
- The signal is also passed to `fetch()` calls and sleep delays for immediate interruption
- On abort: in-flight HTTP requests abort, sleep timers clear, loops exit

### Abort propagation
1. `AbortSignal` checked at top of each loop iteration (fetch papers, download papers)
2. `abortableSleep()` — clears timer immediately on abort instead of waiting
3. `downloadSource()` passes signal to `fetch()` — aborts HTTP request mid-flight
4. `isCancellation()` helper distinguishes abort errors from real per-paper failures

### Status flow on cancel
1. Currently running job → `failed` with error "cancelled by user"
2. Remaining pending jobs → `cancelled`
3. Pipeline run → `cancelled`
4. Events emitted for each status change
5. Papers already processed keep their progress — nothing is rolled back

### Statuses
- `JobStatus`: `pending | running | completed | failed | skipped | cancelled`
- `PipelineStatus`: `running | completed | failed | cancelled`
- `skipped` = step had nothing to act on. Two sources:
  - Fetch returned 0 papers → all downstream jobs marked skipped.
  - A profile/score step throws `NO_INPUT_ERROR` (no labeled papers / no active profile). Orchestrator catches and marks `skipped` without aborting the run.
- `cancelled` = job never ran because the run was cancelled.

## Architecture

```
PipelineOrchestrator (orchestration, job/run management, cancellation)
  → ensureFeed (create feed before run)
  → constraint check (no running pipeline globally)
  → AbortController (one per run, exposed via cancel())
  → PipelineService (step business logic)
    → sources/arxiv.ts     (fetchFeed, downloadSource — accepts AbortSignal, returns DownloadResult)
    → services/Storage.ts  (saveSource → saveTarball/saveSingleFile, listFiles, readFile, deleteSource)
    → db/queries/          (upsertPaperStatus, getStepStats, getArxivIdsForFeed, etc.)
    → EventEmitter         (IPC push — paper:status events)
  → EventEmitter           (IPC push — run:update, job:update events)
  → db/queries/            (getRunById, getJobById — read back for event payloads)
```

### Orchestrator
- Accepts `EventEmitter` in constructor (same pattern as PipelineService)
- Ensures feed exists for the date
- Checks no pipeline is already running (global constraint)
- Creates pipeline_run and job records, emitting events after each DB write
- Loops through steps sequentially, passing `AbortSignal` to each
- After fetch, checks feed paper count — if 0, marks remaining jobs as "skipped"
- On cancellation: marks interrupted job as failed, remaining jobs as cancelled, run as cancelled
- On failure: writes error message to jobs.error column, marks run as failed
- Step methods don't know about jobs — clean separation

### EventEmitter
- IPC-only wrapper — no DB operations
- Takes `BrowserWindow`, sends events via `webContents.send`
- Methods: `paperStatus()`, `runUpdate()`, `jobUpdate()`
- Injected into both PipelineService and PipelineOrchestrator at construction

### IPC Channels

Request/response (renderer → main):
- `pipeline:start` — trigger a run (steps, trigger, date)
- `pipeline:cancel` — cancel the active run
- `pipeline:runs` — get all pipeline runs
- `job:runs` — get all jobs
- `papers:feed` — get papers by feed ID
- `papers:statuses` — get paper_progress rows for a feed (`PaperStatus[]`)
- `feed:step-counts` — get aggregate step counts for all feeds (`FeedStepCount[]` — grouped by feedId, step, status)
- `feeds:all` — get all feeds

Push events (main → renderer):
- `paper:status` — per-paper progress during a step
- `run:update` — pipeline run created or status changed
- `job:update` — job created or status changed

## Storage

Paper source files at `<userData>/papers/<arxivId>/`. Path is deterministic — not stored in DB. Download → summarize → delete (transient).

## Scheduling (Desktop App)

- **When app is open**: in-app scheduler (configurable interval)
- **Manual**: "run now" button in the Control Room
- **Background**: optional OS-level scheduled task (future)
