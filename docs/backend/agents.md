# AI Agents

Three agents, all using the OpenAI Agents SDK with structured output via Zod.

## Provider

All agents talk to OpenRouter, which is OpenAI-compatible. Configured at app startup in `src/main/index.ts` via `initOpenRouter()`:

- `setDefaultOpenAIClient(client)` — `OpenAI` SDK pointing at `https://openrouter.ai/api/v1`
- `setOpenAIAPI('chat_completions')` — OpenRouter does not implement the OpenAI Responses API
- `setTracingDisabled(true)` — tracing posts to OpenAI with an OpenAI key, which we don't have

`OPENROUTER_API_KEY` is loaded from `.env` at the project root by `dotenv`. Per-agent model is resolved in this order at call time (see `agents/shared/config.ts`):

1. `settings` table key (`model.summary` / `model.profile` / `model.score`)
2. Env override (`OPENROUTER_MODEL_SUMMARY` / `..._PROFILE` / `..._SCORE`)
3. Default: `openai/gpt-4o-mini` (cheap, reliable tool + structured output)

## Layout

```
src/main/agents/
├── summaryAgent.ts             # one file per agent
├── profileBuilderAgent.ts
├── scoringAgent.ts
├── prompts/
│   ├── summary.ts              # system + user-prompt builders, no inline strings in agent files
│   ├── profileBuilder.ts
│   └── scoring.ts
├── tools/
│   ├── listFiles.ts            # one tool per file
│   ├── readFile.ts
│   ├── getPaperDetails.ts
│   └── getCategoryStats.ts
└── shared/
    ├── config.ts               # OpenRouter wiring, model resolver
    ├── outputSchemas.ts        # Zod schemas for structured outputs
    ├── runContexts.ts          # per-agent RunContext types (each carries the run's AbortSignal)
    ├── storageSandbox.ts       # base-path resolver + safeJoin for file tools
    └── usage.ts                # captureUsage helper for AgentUsage extraction
```

## Run-context conventions

The SDK's `RunContext` does not surface the run's `AbortSignal` to tools, so each agent's typed run context (`SummaryRunContext`, `ProfileRunContext`) carries `signal: AbortSignal`. Tools call `ctx.context.signal.throwIfAborted()` at I/O boundaries.

`runSummary`, `runProfile`, `runScore` each take `(db, input, signal)` where `signal` is the orchestrator's per-run abort signal. They return `output + usage` (see `AgentUsage` in `src/shared/types.ts`).

## Summarizer

**Purpose**: short description + detailed markdown summary of a paper.

**Output (Zod)**: `{ description: string, summary: string }`

### Modes

| Mode | When | Tools | Max turns |
|------|------|-------|-----------|
| `single_tex` | Source dir contains exactly one .tex ≤ 40KB | None (embedded in user prompt) | 3 |
| `directory` | Multiple files or large .tex | `list_files`, `read_file` | 12 |
| `abstract_only` | No source / PDF-only / empty dir | None | 3 |

PDF text extraction is **not** implemented in v1 — `sourceType === 'PDF'` falls back to `abstract_only`.

### Fallback

Directory mode catches max-turns or provider errors and retries the same paper in `abstract_only` mode (one extra small call). Cancellation (`DOMException AbortError`) is rethrown, not swallowed. The user always gets a summary as long as the paper has at least an abstract.

### Tool sandbox

`list_files` and `read_file` resolve paths via `agents/shared/storageSandbox.ts`. The base path is set once at app startup from the `StorageService`. Both tools clamp paths to the per-paper directory and reject `..` escapes / absolute paths. Readable extensions: `.tex .txt .bib .bbl .cls .sty .md .bst`. Truncation: 50,000 chars per file.

## Profile Builder

**Purpose**: build a preference profile from labeled papers (dismissed vs. liked/read).

**Output (Zod)**:
```
{
  profile_summary: string,
  interests: ProfileEntry[],
  dismissal_patterns: ProfileEntry[],
  category_preferences: ProfileEntry[],
  author_affinity: ProfileEntry[],
}
ProfileEntry = { content, confidence: 'high'|'medium'|'low', evidence_note }
```

### Tools

- `get_paper_details(arxiv_id)` — DB closure returning title, authors, categories, abstract for one paper. Used selectively.
- `get_category_stats()` — DB closure returning dismiss/keep ratios per primary category.

### Calibration (by `profileCount`)

- `0`: first profile — conservative, prefer "low" / "medium".
- `1–4`: moderate confidence where patterns are clear.
- `5+`: full confidence for established patterns.

### Incremental

If `previousProfile` exists, it's serialized into the user prompt with the instruction to "build on it incrementally — confirm existing patterns, revise contradictions, add new patterns."

### Fallback

If the run exceeds `maxTurns: 12` (or hits any provider error), the agent retries with no tools — labels-only — at `maxTurns: 3`. This guarantees a profile is always produced when there is at least one labeled paper.

### Empty input

If there are zero labeled papers, the orchestrator marks the job `skipped` (via `NO_INPUT_ERROR` sentinel) rather than running the agent.

## Scorer

**Purpose**: score a paper against the active profile.

**Output (Zod)**: `{ score: number (0..1), reasoning: string }`

**Tools**: none. Pure LLM, `maxTurns: 3`.

### Selection

`getPapersToScore(feedId, activeProfileVersionId)` returns papers where:
- `paper_progress.step = 'summarize'` and `status = 'completed'`
- `paper_status.status` is null or anything but `'dismissed'`
- `scores.profile_version_id` is null or stale (different from the active profile)

So the score step is idempotent across re-runs and automatically rescores after a profile rebuild.

### Empty input

If there is no active profile, or no papers to score, the orchestrator marks the job `skipped`.

## Persistence

All three agents stamp the model + token usage on the row they write:

| Agent | Versioned table | Active pointer | Usage column |
|-------|-----------------|----------------|--------------|
| Summarizer | `summary_versions` | `active_summary` | `usage_json` |
| Profile builder | `profile_versions` | `active_profile` | `usage_json` (added in migration 003) |
| Scorer | `scores` (upsert) | n/a — keyed by paper | `usage_json` (added in migration 003) |

`usage_json` is `{ inputTokens, outputTokens, totalTokens, ... }` (the summarizer also records `mode`).

`lab_runs` is reserved for the Lab zone (ad-hoc agent runs); pipeline-driven runs persist directly to the tables above and skip `lab_runs`.

## Cancellation

- Pipeline `AbortSignal` → `runSummary/Profile/Score(_, _, signal)` → `run(agent, ..., { signal })` — the SDK aborts in-flight LLM calls.
- Tools call `ctx.context.signal.throwIfAborted()` at file/DB I/O boundaries.
- `DOMException AbortError` is rethrown by the per-agent fallback paths so cancellation is never swallowed.

## Cost discipline

- Default model `openai/gpt-4o-mini` ≈ $0.15/M in, $0.60/M out.
- 4-paper end-to-end run (fetch → score) measured at ~$0.01 total.
- The largest cost contributor is summarizer `directory` mode when the model reads several .tex files (≈45k input tokens for a typical paper). Tightening the prompt + falling back to `abstract_only` keeps this bounded.
- Override per-agent model via the env (`OPENROUTER_MODEL_SUMMARY=...`) to experiment with cheaper models.

## Test rig

`src/main/scripts/test-agents.ts` runs the full agent pipeline against real arXiv data + OpenRouter:

```
docker compose up -d                 # ensure postgres is running
npx tsx src/main/scripts/test-agents.ts
```

It connects to the postgres container, drops & recreates a `forage_test` database alongside the dev `forage` database, runs the full migrations into it, fetches a configurable number of papers from a configurable date, and reports per-call token usage so you can verify cost.

The dev database (`forage`) is **never touched** by the test — only `forage_test` is wiped.
