import { useMemo } from 'react';
import type { Feed, Paper, PaperStatus } from '@shared/types';
import type { PipelineSteps } from '@shared/enums';

type FeedDetailProps = {
  feed: Feed;
  papers: Paper[];
  statuses: Map<number, PaperStatus>;
  onClose: () => void;
};

// `profile` is a global aggregate over all labeled papers and writes no
// per-paper status, so it isn't shown here. `score` is per-paper-per-feed.
const STEP_ORDER: PipelineSteps[] = ['fetch', 'download', 'summarize', 'score'];

const statusColors: Record<string, string> = {
  completed: 'text-score-high',
  failed: 'text-dismiss',
};

export function FeedDetail({ feed, papers, statuses, onClose }: FeedDetailProps) {
  // Compute summary from statuses
  const summary = useMemo(() => {
    const map = new Map<string, { completed: number; failed: number }>();
    for (const s of statuses.values()) {
      const entry = map.get(s.step) ?? { completed: 0, failed: 0 };
      if (s.status === 'completed') entry.completed++;
      else if (s.status === 'failed') entry.failed++;
      map.set(s.step, entry);
    }
    return STEP_ORDER
      .filter(step => map.has(step))
      .map(step => ({ step, ...map.get(step)! }));
  }, [statuses]);

  const totalFailed = useMemo(
    () => Array.from(statuses.values()).filter(s => s.status === 'failed').length,
    [statuses],
  );

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-[11px] uppercase tracking-widest text-text-muted">
          Feed
        </h3>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-secondary text-xs font-mono"
        >
          ← back
        </button>
      </div>

      {/* Summary bar */}
      <div className="mb-4 pb-3 border-b border-divider">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-sm font-mono">{feed.date}</span>
          <span className="text-text-muted text-sm font-mono">
            {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
          </span>
          {totalFailed > 0 && (
            <span className="text-dismiss text-sm font-mono">
              {totalFailed} failed
            </span>
          )}
        </div>
        {summary.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            {summary.map(s => (
              <span key={s.step} className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-text-muted">{s.step}</span>
                <span className="text-score-high">{s.completed}</span>
                {s.failed > 0 && (
                  <span className="text-dismiss">{s.failed} failed</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Paper list */}
      {papers.length === 0 ? (
        <p className="text-text-muted text-sm">No papers</p>
      ) : (
        <div>
          {papers.map((paper) => {
            const ps = statuses.get(paper.id);

            return (
              <div
                key={paper.id}
                className="py-2 border-b border-divider pl-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary text-sm truncate">{paper.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-text-muted text-xs font-mono">{paper.arxivId}</span>
                      <span className="text-text-muted text-xs">{paper.primaryCategory}</span>
                      {paper.sourceDetails?.sourceType && (
                        <span className="text-text-muted text-xs font-mono">
                          {paper.sourceDetails.sourceType} · {paper.sourceDetails.numberFiles} {paper.sourceDetails.numberFiles === 1 ? 'file' : 'files'}
                        </span>
                      )}
                    </div>
                  </div>
                  {ps && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-xs ${statusColors[ps.status] ?? 'text-text-muted'}`}>
                        {ps.status === 'failed' ? '✗' : '●'}
                      </span>
                      <span className="text-text-secondary text-xs font-mono">{ps.step}</span>
                    </div>
                  )}
                </div>
                {ps?.error && (
                  <div className="text-dismiss text-xs font-mono mt-1 truncate">
                    {ps.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
