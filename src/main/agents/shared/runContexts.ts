import { AgentFileContext, CategoryStat, Paper } from '@shared/types';

// The SDK's RunContext does not surface the run's AbortSignal to tools, so we
// pipe it through our typed run context. Tools call `ctx.context.signal.throwIfAborted()`
// at I/O boundaries.

export interface SummaryRunContext {
  paperId: number;
  fileContext: AgentFileContext;
  signal: AbortSignal;
}

export interface ProfileRunContext {
  fetchPaperDetails: (arxivId: string) => Promise<Paper | null>;
  fetchCategoryStats: () => Promise<CategoryStat[]>;
  signal: AbortSignal;
}

// Scorer is pure LLM — no per-run state needed.
export type ScoreRunContext = Record<string, never>;
