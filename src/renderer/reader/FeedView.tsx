import { useEffect, useRef } from 'react';
import type { Paper, Score } from '@shared/types';
import type { PaperInteraction } from '@shared/enums';
import { FeedItem } from './FeedItem';

type FeedViewProps = {
  papers: Paper[];
  selectedIndex: number;
  scoreByPaper: Map<number, Score>;
  labelByPaper: Map<number, PaperInteraction>;
};

export function FeedView({ papers, selectedIndex, scoreByPaper, labelByPaper }: FeedViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (papers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm">No papers. Run a pipeline from <span className="text-text-tertiary font-mono">:ControlRoom</span></span>
      </div>
    );
  }

  return (
    <div ref={listRef} className="max-w-3xl mx-auto">
      {papers.map((paper, i) => (
        <div key={paper.id} ref={(el) => { if (el) itemRefs.current.set(i, el); }}>
          <FeedItem paper={paper} active={i === selectedIndex} score={scoreByPaper.get(paper.id)?.score ?? null} label={labelByPaper.get(paper.id) ?? null} />
        </div>
      ))}
    </div>
  );
}
