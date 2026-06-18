import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useKeyMap } from '../hooks/useKeyMap';
import { useIpc } from '../hooks/useIpc';
import { ipc } from '../ipc';
import { FeedView } from './FeedView';
import { SplitView } from './SplitView';
import type { Feed, Score, SummaryVersion } from '@shared/types';
import type { PaperInteraction } from '@shared/enums';

type ViewState = 'feed' | 'split';

export function Reader() {
  const [viewState, setViewState] = useState<ViewState>('feed');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fetch feeds, then papers for the latest feed
  const { data: feeds, error: feedsError } = useIpc(() => ipc.getFeeds(), []);
  // feeds are date-DESC; show the most recent one that actually has papers so an
  // empty fetch (0-paper day) doesn't shadow a populated earlier feed.
  const latestFeed: Feed | undefined =
    feeds?.find((f) => (f.paperCount ?? 0) > 0) ?? feeds?.[0];
  const { data: papers, loading, error: papersError } = useIpc(
    () => latestFeed ? ipc.getPapersByFeed(latestFeed.id) : Promise.resolve([]),
    [latestFeed?.id],
  );
  const { data: scores } = useIpc(
    () => latestFeed ? ipc.getScoresByFeed(latestFeed.id) : Promise.resolve([]),
    [latestFeed?.id],
  );
  const { data: summaries } = useIpc(
    () => latestFeed ? ipc.getSummariesByFeed(latestFeed.id) : Promise.resolve([]),
    [latestFeed?.id],
  );
  const loadError = feedsError ?? papersError;

  // User labels live in local state so keypresses can update them optimistically.
  const [labelByPaper, setLabelByPaper] = useState<Map<number, PaperInteraction>>(new Map());
  useEffect(() => {
    if (!latestFeed) { setLabelByPaper(new Map()); return; }
    ipc.getUserStatusesByFeed(latestFeed.id)
      .then((rows) => setLabelByPaper(new Map(rows.map((r) => [r.paperId, r.status]))))
      .catch(() => setLabelByPaper(new Map()));
  }, [latestFeed?.id]);

  const scoreByPaper = useMemo(() => {
    const m = new Map<number, Score>();
    for (const s of scores ?? []) m.set(s.paperId, s);
    return m;
  }, [scores]);

  const summaryByPaper = useMemo(() => {
    const m = new Map<number, SummaryVersion>();
    for (const s of summaries ?? []) m.set(s.paperId, s);
    return m;
  }, [summaries]);

  // Sort by relevance desc; unscored papers sink to the bottom.
  const paperList = useMemo(() => {
    return [...(papers ?? [])].sort((a, b) => {
      const sa = scoreByPaper.get(a.id)?.score ?? -1;
      const sb = scoreByPaper.get(b.id)?.score ?? -1;
      return sb - sa;
    });
  }, [papers, scoreByPaper]);

  const clampIndex = useCallback((next: number) => {
    if (paperList.length === 0) return 0;
    return Math.max(0, Math.min(next, paperList.length - 1));
  }, [paperList.length]);

  // Read selection through a ref so labeling doesn't rebuild the keymap on every
  // cursor move (which would churn the vim context stack).
  const selectedRef = useRef(selectedIndex);
  selectedRef.current = selectedIndex;

  const applyLabel = useCallback((status: PaperInteraction) => {
    const paper = paperList[selectedRef.current];
    if (!paper) return;
    setLabelByPaper((prev) => new Map(prev).set(paper.id, status));
    ipc.setPaperUserStatus(paper.id, status).catch(() => {});
  }, [paperList]);

  const feedKeyMap = useMemo(() => ({
    'j': () => setSelectedIndex((i) => clampIndex(i + 1)),
    'k': () => setSelectedIndex((i) => clampIndex(i - 1)),
    'G': () => setSelectedIndex(clampIndex(Infinity)),
    'gg': () => setSelectedIndex(0),
    's': () => applyLabel('liked'),
    'd': () => applyLabel('dismissed'),
    'u': () => applyLabel('unread'),
    'Enter': () => { if (paperList.length > 0) setViewState('split'); },
  }), [clampIndex, paperList.length, applyLabel]);

  const feedHints = useMemo(() => [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'open' },
    { key: 's/d', label: 'like/dismiss' },
    { key: ':', label: 'command' },
  ], []);

  const splitKeyMap = useMemo(() => ({
    'j': () => setSelectedIndex((i) => clampIndex(i + 1)),
    'k': () => setSelectedIndex((i) => clampIndex(i - 1)),
    'G': () => setSelectedIndex(clampIndex(Infinity)),
    'gg': () => setSelectedIndex(0),
    's': () => applyLabel('liked'),
    'd': () => applyLabel('dismissed'),
    'u': () => applyLabel('unread'),
    'Escape': () => setViewState('feed'),
  }), [clampIndex, applyLabel]);

  const splitHints = useMemo(() => [
    { key: 'j/k', label: 'navigate' },
    { key: 's/d', label: 'like/dismiss' },
    { key: 'Esc', label: 'back' },
    { key: ':', label: 'command' },
  ], []);

  useKeyMap(
    viewState === 'feed' ? 'feed-view' : 'split-view',
    viewState === 'feed' ? feedKeyMap : splitKeyMap,
    viewState === 'feed' ? feedHints : splitHints,
  );

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <span className="text-dismiss text-sm font-mono">Failed to load papers</span>
        <span className="text-text-muted text-xs font-mono">{loadError}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted text-sm">Loading...</span>
      </div>
    );
  }

  if (viewState === 'split') {
    return (
      <SplitView
        papers={paperList}
        selectedIndex={selectedIndex}
        scoreByPaper={scoreByPaper}
        summaryByPaper={summaryByPaper}
        labelByPaper={labelByPaper}
      />
    );
  }

  return (
    <FeedView
      papers={paperList}
      selectedIndex={selectedIndex}
      scoreByPaper={scoreByPaper}
      labelByPaper={labelByPaper}
    />
  );
}
