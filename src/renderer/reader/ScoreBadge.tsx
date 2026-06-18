type ScoreBadgeProps = {
  score: number | null;
};

type Tier = 'high' | 'mid' | 'low';

function tier(score: number): Tier {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'mid';
  return 'low';
}

const tierClass: Record<Tier, string> = {
  high: 'text-score-high border-score-high',
  mid: 'text-score-mid border-score-mid',
  low: 'text-score-low border-score-low',
};

// Relevance score 0.0–1.0 shown as an integer 0–100, color-coded by tier.
// Null = not yet scored.
export function ScoreBadge({ score }: ScoreBadgeProps) {
  if (score === null) {
    return <span className="font-mono text-[10px] text-text-muted">—</span>;
  }

  return (
    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${tierClass[tier(score)]}`}>
      {Math.round(score * 100)}
    </span>
  );
}
