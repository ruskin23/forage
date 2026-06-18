import type { Paper, Score, SummaryVersion } from '@shared/types';
import { ScoreBadge } from './ScoreBadge';

type PaperDetailProps = {
  paper: Paper;
  summary: SummaryVersion | null;
  score: Score | null;
};

export function PaperDetail({ paper, summary, score }: PaperDetailProps) {
  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-start gap-3">
        <h2 className="text-text-primary text-lg leading-snug flex-1">{paper.title}</h2>
        <ScoreBadge score={score?.score ?? null} />
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {paper.categories.map((cat) => (
          <span key={cat} className="bg-tag-default text-bg-base px-1.5 py-0.5 rounded font-mono uppercase text-[10px]">
            {cat}
          </span>
        ))}
      </div>

      <p className="text-text-secondary text-xs mt-2 font-mono">{paper.authors.join(', ')}</p>

      {paper.published && (
        <p className="text-text-muted text-xs mt-1 font-mono">{paper.published}</p>
      )}

      {summary && (
        <div className="border-t border-divider mt-4 pt-4">
          <h4 className="text-text-tertiary text-xs uppercase tracking-wider mb-2">AI Summary</h4>
          <p className="text-text-primary text-sm leading-relaxed font-medium">{summary.description}</p>
          <p className="text-text-secondary text-sm leading-relaxed mt-2 whitespace-pre-line">{summary.summary}</p>
        </div>
      )}

      {score?.reasoning && (
        <div className="border-t border-divider mt-4 pt-4">
          <h4 className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Relevance</h4>
          <p className="text-text-secondary text-sm leading-relaxed">{score.reasoning}</p>
        </div>
      )}

      <div className="border-t border-divider mt-4 pt-4">
        <h4 className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Abstract</h4>
        <p className="text-text-secondary text-sm leading-relaxed">{paper.abstract}</p>
      </div>

      {paper.pdfUrl && (
        <div className="border-t border-divider mt-4 pt-4">
          <h4 className="text-text-tertiary text-xs uppercase tracking-wider mb-2">Links</h4>
          <span className="text-accent text-sm font-mono">{paper.arxivId}</span>
        </div>
      )}
    </div>
  );
}
