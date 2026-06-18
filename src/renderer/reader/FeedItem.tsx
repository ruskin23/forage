import type { Paper } from '@shared/types';
import type { PaperInteraction } from '@shared/enums';
import { ScoreBadge } from './ScoreBadge';

type FeedItemProps = {
  paper: Paper;
  active: boolean;
  compact?: boolean;
  score: number | null;
  label: PaperInteraction | null;
};

const categoryColors: Record<string, string> = {
  'astro-ph.CO': 'bg-tag-ai',
  'astro-ph.GA': 'bg-tag-ml',
  'astro-ph.HE': 'bg-tag-nlp',
  'astro-ph.IM': 'bg-tag-cv',
  'astro-ph.EP': 'bg-tag-default',
  'astro-ph.SR': 'bg-tag-default',
};

function getCategoryColor(category: string): string {
  return categoryColors[category] ?? 'bg-tag-default';
}

function truncateAuthors(authors: string[]): string {
  if (authors.length <= 2) return authors.join(', ');
  return `${authors[0]}, ${authors[1]} +${authors.length - 2}`;
}

export function FeedItem({ paper, active, compact, score, label }: FeedItemProps) {
  const dismissed = label === 'dismissed';
  const itemClass = [
    'px-4 py-3 border-b border-divider transition-opacity duration-100',
    active ? 'opacity-100 border-l-2 border-l-accent' : 'opacity-45',
    active && 'pl-3.5',
  ].filter(Boolean).join(' ');

  const titleClass = [
    'text-text-primary text-sm leading-snug flex-1',
    dismissed && 'line-through text-text-muted',
  ].filter(Boolean).join(' ');

  return (
    <div className={itemClass}>
      <div className="flex items-start gap-2">
        {label === 'liked' && <span className="text-accent text-xs leading-snug" title="liked">♥</span>}
        {dismissed && <span className="text-dismiss text-xs leading-snug" title="dismissed">✗</span>}
        <h3 className={titleClass}>{paper.title}</h3>
        <ScoreBadge score={score} />
      </div>
      {!compact && paper.abstract && (
        <p className="text-text-tertiary text-xs mt-1 line-clamp-2">{paper.abstract}</p>
      )}
      <div className="flex items-center gap-3 mt-1.5 text-xs">
        <span className={`${getCategoryColor(paper.primaryCategory)} text-bg-base px-1.5 py-0.5 rounded font-mono uppercase text-[10px]`}>
          {paper.primaryCategory}
        </span>
        <span className="text-text-muted font-mono">{truncateAuthors(paper.authors)}</span>
      </div>
    </div>
  );
}
