import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ipc } from '../ipc';
import { RunsTab } from './RunsTab';
import { FeedDetail } from './FeedDetail';
import type { Feed, FeedDate, PipelineRun, Job, Paper, PaperStatus, FeedStepCount } from '@shared/types';
import type { PipelineSteps } from '@shared/enums';
import type { StepProgress } from '@shared/eventTypes';
import { Calendar } from './Calendar';

const ALL_STEPS: PipelineSteps[] = ['fetch', 'download', 'summarize', 'profile', 'score'];

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateString(str: string): FeedDate | null {
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return { year, month, day };
}

function dayOfWeek(str: string): string {
  const [y, m, d] = str.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];
}

type StepCountsMap = Map<number, Map<string, { completed: number; failed: number }>>;

function buildStepCountsMap(counts: FeedStepCount[]): StepCountsMap {
  const map: StepCountsMap = new Map();
  for (const c of counts) {
    if (!map.has(c.feedId)) map.set(c.feedId, new Map());
    const stepMap = map.get(c.feedId)!;
    const entry = stepMap.get(c.step) ?? { completed: 0, failed: 0 };
    if (c.status === 'completed') entry.completed = c.count;
    else if (c.status === 'failed') entry.failed = c.count;
    stepMap.set(c.step, entry);
  }
  return map;
}

export function ControlRoom() {
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  // Trigger state
  const [selectedSteps, setSelectedSteps] = useState<Set<PipelineSteps>>(
    new Set<PipelineSteps>(['fetch', 'download']),
  );
  const [dateStr, setDateStr] = useState(todayString);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Event-driven state
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [liveProgress, setLiveProgress] = useState<Map<string, StepProgress>>(new Map());
  const [cancelling, setCancelling] = useState(false);

  // Feed detail state
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [feedPapers, setFeedPapers] = useState<Paper[]>([]);
  const [feedStatuses, setFeedStatuses] = useState<Map<number, PaperStatus>>(new Map());
  const selectedFeedIdRef = useRef<number | null>(null);

  // Step counts for RunsTab
  const [feedStepCounts, setFeedStepCounts] = useState<StepCountsMap>(new Map());

  // User-visible error banner for IPC failures (load + start/cancel pipeline).
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    Promise.all([
      ipc.getPipelineRuns().then(setRuns),
      ipc.getJobs().then(setJobs),
      ipc.getFeeds().then(setFeeds),
      ipc.getFeedStepCounts().then(c => setFeedStepCounts(buildStepCountsMap(c))),
    ]).catch((e: Error) => setErrorBanner(`Failed to load: ${e.message}`));
  }, []);

  // Keep ref in sync for event handlers
  useEffect(() => { selectedFeedIdRef.current = selectedFeedId; }, [selectedFeedId]);

  // Fetch papers + statuses when a feed is selected
  useEffect(() => {
    if (selectedFeedId === null) {
      setFeedPapers([]);
      setFeedStatuses(new Map());
      return;
    }
    Promise.all([
      ipc.getPapersByFeed(selectedFeedId),
      ipc.getPaperStatuses(selectedFeedId),
    ]).then(([papers, statuses]) => {
      setFeedPapers(papers);
      const map = new Map<number, PaperStatus>();
      for (const s of statuses) map.set(s.paperId, s);
      setFeedStatuses(map);
    });
  }, [selectedFeedId]);

  // Event listeners
  useEffect(() => {
    const unsubRun = ipc.onRunUpdate(({ run }) => {
      setRuns(prev => {
        const idx = prev.findIndex(r => r.id === run.id);
        if (idx === -1) return [run, ...prev];
        const next = [...prev];
        next[idx] = run;
        return next;
      });
      // Refetch when a run completes (paper_count may have changed)
      if (run.status !== 'running') {
        ipc.getFeeds().then(setFeeds);
        ipc.getFeedStepCounts().then(c => setFeedStepCounts(buildStepCountsMap(c)));
        setLiveProgress(new Map());
        setCancelling(false);
        // Refresh feed detail if viewing this feed
        const currentFeedId = selectedFeedIdRef.current;
        if (currentFeedId !== null && run.feedId === currentFeedId) {
          Promise.all([
            ipc.getPapersByFeed(currentFeedId),
            ipc.getPaperStatuses(currentFeedId),
          ]).then(([papers, statuses]) => {
            setFeedPapers(papers);
            const map = new Map<number, PaperStatus>();
            for (const s of statuses) map.set(s.paperId, s);
            setFeedStatuses(map);
          });
        }
      }
    });

    const unsubJob = ipc.onJobUpdate(({ job }) => {
      setJobs(prev => {
        const idx = prev.findIndex(j => j.id === job.id);
        if (idx === -1) return [job, ...prev];
        const next = [...prev];
        next[idx] = job;
        return next;
      });
    });

    const unsubPaper = ipc.onPaperStatus(({ paperStatus, stepProgress }) => {
      setLiveProgress(prev => {
        const next = new Map(prev);
        next.set(paperStatus.step, stepProgress);
        return next;
      });
      // Live update feed detail statuses
      setFeedStatuses(prev => {
        if (prev.size === 0) return prev;
        if (!prev.has(paperStatus.paperId) && prev.size > 0) return prev;
        const next = new Map(prev);
        next.set(paperStatus.paperId, paperStatus);
        return next;
      });
    });

    return () => { unsubRun(); unsubJob(); unsubPaper(); };
  }, []);

  // Escape closes the calendar, then the feed detail. Standard overlay-close
  // convention — not vim navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (calendarOpen) { setCalendarOpen(false); return; }
      if (selectedFeedId !== null) setSelectedFeedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calendarOpen, selectedFeedId]);

  const runsList = useMemo(
    () => [...runs].sort((a, b) => b.id - a.id),
    [runs],
  );
  const feedsList = useMemo(
    () => [...feeds].sort((a, b) => b.date.localeCompare(a.date)),
    [feeds],
  );
  const jobsList = jobs;

  const feedsById = useMemo(() => {
    const map = new Map<number, Feed>();
    for (const feed of feedsList) map.set(feed.id, feed);
    return map;
  }, [feedsList]);

  const feedDates = useMemo(() => new Set(feedsList.map((f) => f.date)), [feedsList]);

  const hasRunningRuns = runsList.some((r) => r.status === 'running');

  const toggleStep = (step: PipelineSteps) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  };

  const handleRun = useCallback(() => {
    const steps = Array.from(selectedSteps);
    const feedDate = parseDateString(dateStr);
    if (!feedDate || steps.length === 0 || hasRunningRuns) return;

    setErrorBanner(null);
    ipc.startPipeline(steps, 'manual', feedDate)
      .catch((e: Error) => setErrorBanner(`Failed to start pipeline: ${e.message}`));
  }, [selectedSteps, dateStr, hasRunningRuns]);

  const handleCancel = useCallback(() => {
    if (!hasRunningRuns || cancelling) return;
    setCancelling(true);
    ipc.cancelPipeline().catch((e: Error) => {
      setCancelling(false);
      setErrorBanner(`Failed to cancel pipeline: ${e.message}`);
    });
  }, [hasRunningRuns, cancelling]);

  const handleDateSelect = useCallback((date: string) => {
    setDateStr(date);
    setCalendarOpen(false);
  }, []);

  const toggleFeed = (feedId: number) => {
    setSelectedFeedId((prev) => (prev === feedId ? null : feedId));
  };

  const noSteps = selectedSteps.size === 0;
  const invalidDate = !parseDateString(dateStr);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {errorBanner && (
        <div className="flex items-start justify-between gap-3 border-b border-divider bg-bg-elevated px-4 py-2 text-sm font-mono">
          <span className="text-dismiss">{errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-text-muted hover:text-text-secondary text-xs shrink-0"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Trigger bar — date + pipeline flow + run */}
      <div className="border-b border-divider bg-bg-surface px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] uppercase tracking-widest text-text-muted">New run</h3>
          <div className="flex items-center gap-3">
            {/* Date picker */}
            <div className="relative">
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                className="flex items-center gap-2 text-sm font-mono rounded-md border border-divider px-3 py-1.5 hover:bg-bg-elevated transition-colors"
              >
                <span className="text-text-primary">{dateStr}</span>
                <span className="text-text-muted text-[10px]">{dayOfWeek(dateStr)}</span>
                <span className="text-text-muted text-[10px]">{calendarOpen ? '▴' : '▾'}</span>
              </button>
              {calendarOpen && (
                <div className="absolute right-0 mt-2 z-50 rounded-md border border-divider bg-bg-elevated p-3 shadow-lg">
                  <Calendar
                    selectedDate={dateStr}
                    onSelect={handleDateSelect}
                    feedDates={feedDates}
                  />
                </div>
              )}
            </div>

            {/* Run / cancel */}
            {hasRunningRuns ? (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className={`text-sm font-mono rounded-md border px-4 py-1.5 transition-colors ${
                  cancelling
                    ? 'text-text-muted border-divider cursor-not-allowed'
                    : 'text-dismiss border-dismiss/40 bg-dismiss/10 hover:bg-dismiss/20'
                }`}
              >
                {cancelling ? 'cancelling…' : 'cancel ✕'}
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={noSteps || invalidDate}
                className="text-sm font-mono rounded-md border border-accent/40 bg-accent/10 text-accent px-4 py-1.5 hover:bg-accent/20 disabled:text-text-muted disabled:border-divider disabled:bg-transparent disabled:cursor-not-allowed transition-colors"
              >
                run →
              </button>
            )}
          </div>
        </div>

        {/* Pipeline flow */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {ALL_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <button
                onClick={() => toggleStep(step)}
                className={[
                  'font-mono text-sm rounded-full border px-3 py-1 transition-colors',
                  selectedSteps.has(step)
                    ? 'text-accent border-accent/40 bg-accent/10'
                    : 'text-text-muted border-divider hover:text-text-tertiary hover:border-text-muted',
                ].join(' ')}
              >
                {selectedSteps.has(step) ? '● ' : '○ '}{step}
              </button>
              {i < ALL_STEPS.length - 1 && (
                <span className="text-text-muted text-xs">→</span>
              )}
            </div>
          ))}
          {noSteps && (
            <span className="text-text-muted text-xs ml-2">select at least one step</span>
          )}
        </div>
      </div>

      {/* Body — feeds + history/detail */}
      <div className="flex flex-1 min-h-0">
        {/* Feeds list */}
        <div className="w-56 shrink-0 border-r border-divider bg-bg-surface overflow-y-auto p-5">
          <h3 className="text-[11px] uppercase tracking-widest mb-3 text-text-muted">
            Feeds
          </h3>
          {feedsList.length === 0 ? (
            <p className="text-text-muted text-sm">No feeds yet</p>
          ) : (
            <div>
              {feedsList.map((feed) => (
                <div
                  key={feed.id}
                  onClick={() => toggleFeed(feed.id)}
                  className={`flex justify-between font-mono cursor-pointer py-1.5 px-2 rounded-sm transition-colors ${
                    selectedFeedId === feed.id ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'
                  }`}
                >
                  <span className={`text-sm ${selectedFeedId === feed.id ? 'text-accent' : 'text-text-secondary'}`}>
                    {feed.date}
                  </span>
                  <span className="text-text-muted text-xs">
                    {feed.paperCount !== null ? feed.paperCount : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel — run history or feed detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedFeedId !== null && feedsById.has(selectedFeedId) ? (
            <FeedDetail
              feed={feedsById.get(selectedFeedId)!}
              papers={feedPapers}
              statuses={feedStatuses}
              onClose={() => setSelectedFeedId(null)}
            />
          ) : (
            <RunsTab
              runs={runsList}
              jobs={jobsList}
              feedsById={feedsById}
              expandedRunId={expandedRunId}
              onToggleExpand={(runId) => setExpandedRunId((prev) => (prev === runId ? null : runId))}
              liveProgress={liveProgress}
              feedStepCounts={feedStepCounts}
            />
          )}
        </div>
      </div>
    </div>
  );
}
