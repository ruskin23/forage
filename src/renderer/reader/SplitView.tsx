import type { Paper, Score, SummaryVersion } from '@shared/types';
import type { PaperInteraction } from '@shared/enums';
import { FeedItem } from './FeedItem';
import { PaperDetail } from './PaperDetail';
import { useEffect, useRef } from 'react';

type SplitViewProps = {
  papers: Paper[];
  selectedIndex: number;
  scoreByPaper: Map<number, Score>;
  summaryByPaper: Map<number, SummaryVersion>;
  labelByPaper: Map<number, PaperInteraction>;
};

export function SplitView({ papers, selectedIndex, scoreByPaper, summaryByPaper, labelByPaper }: SplitViewProps) {
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const selectedPaper = papers[selectedIndex];

  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!selectedPaper) return null;

  return (
    <div className="flex h-[calc(100vh-5rem)]">
      <div className="w-80 shrink-0 border-r border-divider overflow-y-auto">
        {papers.map((paper, i) => (
          <div key={paper.id} ref={(el) => { if (el) itemRefs.current.set(i, el); }}>
            <FeedItem paper={paper} active={i === selectedIndex} compact score={scoreByPaper.get(paper.id)?.score ?? null} label={labelByPaper.get(paper.id) ?? null} />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <PaperDetail
          paper={selectedPaper}
          summary={summaryByPaper.get(selectedPaper.id) ?? null}
          score={scoreByPaper.get(selectedPaper.id) ?? null}
        />
      </div>
    </div>
  );
}
