---
name: forage-agents
description: Use when editing src/main/agents/ or working on AI features (summarizer, profile builder, scorer) or the Lab zone. Covers OpenAI Agents SDK patterns, prompt organization, tool design, structured outputs via Zod, AbortSignal threading, and run observability.
---

# Forage Agents Conventions

How to write AI agents using `@openai/agents`. Read this before editing anything in `src/main/agents/` or `src/renderer/lab/`.

## File layout

```
src/main/agents/
├── summaryAgent.ts          # one file per agent — Agent definition + run function
├── profileBuilderAgent.ts
├── scoringAgent.ts
├── prompts/
│   ├── summary.ts           # exported string constants — interpolatable
│   ├── profileBuilder.ts
│   └── scoring.ts
├── tools/
│   ├── readFile.ts          # one tool per file, named export
│   └── grepFile.ts
└── shared/
    ├── runAgent.ts          # wrapper: handles signal, logs, persists run
    └── outputSchemas.ts     # Zod schemas for structured outputs
```

Rules:

- **One agent per file.** Filename `<name>Agent.ts`, exports `<name>Agent` (the `Agent` instance) and `run<Name>(...)` (the run function used by the pipeline).
- **One tool per file.** Tool files export a single named tool. Tools are reusable across agents.
- **Prompts in `.ts` files, not `.md`.** Reasons: type-safe interpolation, lives next to the code, single import path, Vite bundles cleanly, easier diffs.

## Prompt files

Prompts are exported as either constants or builder functions:

```ts
// agents/prompts/summary.ts
export const SUMMARY_SYSTEM_PROMPT = `You are a research summarizer...`;

export function buildSummaryUserPrompt(args: { title: string; abstract: string }): string {
  return `Title: ${args.title}\n\nAbstract: ${args.abstract}\n\nPlease summarize...`;
}
```

Rules:

- **Constants in SCREAMING_SNAKE_CASE** for top-level prompts.
- **Builder functions** when the prompt has runtime variables. Take a typed object, return a string.
- **No string concatenation in the agent file itself.** All prompt assembly happens in `prompts/`.
- **Don't store prompts in the DB** for v1. They're code, they version with the codebase.

## Agent definition

```ts
import { Agent, run } from '@openai/agents';
import { SUMMARY_SYSTEM_PROMPT } from './prompts/summary';
import { readFileTool } from './tools/readFile';
import { SummaryOutputSchema } from './shared/outputSchemas';

export const summaryAgent = new Agent({
  name: 'Summarizer',
  instructions: SUMMARY_SYSTEM_PROMPT,
  model: 'gpt-4o-mini',  // pulled from settings, see below
  tools: [readFileTool, grepFileTool],
  outputType: SummaryOutputSchema,
});
```

Rules:

- **`outputType` (Zod schema) is required** when the agent returns structured data. Never parse free text into structured data.
- **Model is configurable via `settings`** — read `getSetting('model.summary')` at call time, not at module load. Falls back to a sensible default.
- **`name` matches the agent's role**, used for logging/observability.

## Tool definition

```ts
// agents/tools/readFile.ts
import { tool } from '@openai/agents';
import { z } from 'zod';

export const readFileTool = tool({
  name: 'read_file',
  description: 'Read the full contents of a file from the paper source directory.',
  parameters: z.object({
    path: z.string().describe('Relative path within the paper source directory.'),
  }),
  async execute({ path }, ctx) {
    // ctx contains the AgentFileContext — the directory the agent is allowed to read
    // ...
  },
});
```

Rules:

- **`parameters` is a Zod schema.** No raw JSON schemas.
- **`description` is for the LLM**, not the human. Write it like a docstring the model will read.
- **Tools must be sandboxed.** A `read_file` tool must clamp paths to the agent's allowed directory. Never let a tool escape via `..` or absolute paths.
- **Tools accept `ctx`** to receive per-run context (paper id, file directory, signal). Don't store state on the tool module.

## Run function

Each agent has a `run<Name>` function that's the **only** entry point the pipeline uses:

```ts
export async function runSummary(
  paperId: number,
  fileContext: AgentFileContext,
  signal: AbortSignal,
): Promise<SummaryResult> {
  const userPrompt = buildSummaryUserPrompt({ title, abstract });
  const result = await run(summaryAgent, userPrompt, {
    context: { paperId, fileContext },
    signal,
  });
  return result.finalOutput;  // typed via outputType
}
```

Rules:

- **`signal: AbortSignal` is the last parameter.** Always passed to `run()`.
- **`context` is typed.** Define one type per agent (e.g., `SummaryRunContext`) so tools can read it.
- **Returns the typed output**, not the raw `result` object.

## Persistence and observability

Every agent run gets logged to `lab_runs` (or the equivalent table for the agent type):

- Input prompt / context
- Output (structured or text)
- Token usage (prompt + completion + total)
- Cost estimate (tokens × model price)
- Duration ms
- Error if it failed
- Model used

This lets the Lab zone replay, compare, and analyze runs. Don't skip this — it's the entire point of having a Lab.

The `runAgent` wrapper in `shared/runAgent.ts` should encapsulate this so individual agent run functions don't repeat the bookkeeping.

## Cancellation

- **Pass `signal` to `run()`** — the SDK handles aborting in-flight LLM calls.
- **Tools should `signal.throwIfAborted()`** at boundaries (before reading a large file, before grep).
- **A cancelled run should not be persisted as completed.** Mark it cancelled in `lab_runs`.

## Cost discipline

- **Default to small models** (`gpt-4o-mini`, `gpt-4.1-mini`). Promote to larger only when measured to be necessary.
- **Cap input size.** A 100k-token paper isn't free. Truncate, summarize-first, or use tools to navigate the file rather than dumping it into context.
- **Show cost in the UI.** Total spend per run, per day. Users running this on their own dime want to see what it's costing.

## Settings keys

- `openai.apiKey` — the user's OpenAI API key (required)
- `model.summary` / `model.profile` / `model.score` — model per agent
- `agents.maxRetries` — bounded retry count for transient errors

Read at call time via `getSetting(key)`. The OpenAI client is constructed per-run (cheap) using the key from settings — don't cache it across settings changes.

## What "done" looks like for an agent

- Prompt in `prompts/<name>.ts`, not inline
- `outputType` (Zod) if the output is structured
- Tools (if any) in their own files, paths sandboxed
- `signal` threaded everywhere
- Run is persisted to `lab_runs` (or equivalent) with token usage and cost
- Model and key come from `settings`, not env or hardcoded
- Tested at least once via the Lab zone before the pipeline runs it on a feed
