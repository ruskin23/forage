import type { PipelineRun, Job, Feed } from '@shared/types';
import type { StepProgress } from '@shared/eventTypes';

type StepCountsMap = Map<number, Map<string, { completed: number; failed: number }>>;

type RunsTabProps = {
  runs: PipelineRun[];
  jobs: Job[];
  feedsById: Map<number, Feed>;
  expandedRunId: number | null;
  onToggleExpand: (runId: number) => void;
  liveProgress: Map<string, StepProgress>;
  feedStepCounts: StepCountsMap;
};

const statusColors: Record<string, string> = {
  running: 'text-accent',
  completed: 'text-score-high',
  failed: 'text-dismiss',
  pending: 'text-text-muted',
  skipped: 'text-text-tertiary',
  cancelled: 'text-text-muted',
};

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatProgress(progress: StepProgress): string {
  const parts = [`${progress.success}/${progress.total}`];
  if (progress.failed > 0) parts.push(`${progress.failed} failed`);
  return parts.join(', ');
}

export function RunsTab({ runs, jobs, feedsById, expandedRunId, onToggleExpand, liveProgress, feedStepCounts }: RunsTabProps) {
  // Group jobs by runId
  const jobsByRun = new Map<number, Job[]>();
  for (const job of jobs) {
    if (job.runId === null) continue;
    const list = jobsByRun.get(job.runId) ?? [];
    list.push(job);
    jobsByRun.set(job.runId, list);
  }

  return (
    <div className="p-5">
      <h3 className="text-[11px] uppercase tracking-widest mb-4 text-text-muted">
        History
      </h3>

      {runs.length === 0 ? (
        <p className="text-text-muted text-sm">No runs yet</p>
      ) : (
        <div>
          {runs.map((run) => {
            const feed = feedsById.get(run.feedId);
            const feedDate = feed?.date;
            const paperCount = feed?.paperCount;
            const runJobs = jobsByRun.get(run.id) ?? [];
            const isExpanded = expandedRunId === run.id;
            const isRunning = run.status === 'running';
            const stepCounts = feedStepCounts.get(run.feedId);
            let totalFailed = 0;
            if (stepCounts) for (const c of stepCounts.values()) totalFailed += c.failed;

            return (
              <div key={run.id}>
                <div
                  onClick={() => onToggleExpand(run.id)}
                  className={[
                    'py-3 border-b border-divider cursor-pointer pl-5 transition-colors hover:bg-bg-surface',
                    isExpanded ? 'border-l-2 border-l-accent pl-4' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {feedDate && (
                        <span className="text-text-primary text-sm font-mono">{feedDate}</span>
                      )}
                      {run.status !== 'completed' && (
                        <span className={`text-xs font-mono ${statusColors[run.status]}`}>
                          {run.status}
                        </span>
                      )}
                      {paperCount !== undefined && paperCount !== null && (
                        <span className="text-xs font-mono">
                          <span className={paperCount === 0 ? 'text-text-muted' : 'text-text-secondary'}>
                            {paperCount} {paperCount === 1 ? 'paper' : 'papers'}
                          </span>
                          {totalFailed > 0 && !isRunning && (
                            <span className="text-dismiss ml-1.5">· {totalFailed} failed</span>
                          )}
                        </span>
                      )}
                    </div>
                    <span className="text-text-muted text-xs font-mono">{formatTime(run.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    {runJobs.map((job) => {
                      const progress = isRunning && job.status === 'running'
                        ? liveProgress.get(job.type)
                        : null;

                      return (
                        <span key={job.id} className="flex items-center gap-1.5">
                          <span className={`text-xs ${statusColors[job.status]}`}>●</span>
                          <span className={`text-xs font-mono ${job.status === 'skipped' || job.status === 'cancelled' ? 'text-text-muted' : 'text-text-secondary'}`}>
                            {job.type}
                          </span>
                          {progress && (
                            <span className="text-xs font-mono text-accent">
                              {formatProgress(progress)}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Expanded job list */}
                {isExpanded && (
                  <div className="border-b border-divider bg-bg-surface">
                    {runJobs.length === 0 ? (
                      <div className="px-5 py-2 pl-9 text-text-muted text-xs">No jobs</div>
                    ) : (
                      runJobs.map((job) => (
                        <div
                          key={job.id}
                          className="px-5 py-2 pl-9 flex items-center justify-between border-b border-divider last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`text-xs ${statusColors[job.status]}`}>●</span>
                            <span className="text-text-secondary text-xs font-mono">{job.type}</span>
                          </div>
                          <span className="text-text-muted text-xs font-mono">
                            {formatTime(job.startedAt)}
                            {job.completedAt && ` → ${formatTime(job.completedAt)}`}
                          </span>
                        </div>
                      ))
                    )}
                    {runJobs.some((j) => j.error) && (
                      <div className="px-5 py-2 pl-9">
                        {runJobs
                          .filter((j) => j.error)
                          .map((j) => (
                            <div key={j.id} className="text-dismiss text-xs font-mono mb-1">
                              {j.type}: {j.error}
                            </div>
                          ))}
                      </div>
                    )}
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
