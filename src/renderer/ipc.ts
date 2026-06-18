import type { FeedDate } from '@shared/types';
import type { PaperStatusPayload, RunUpdatePayload, JobUpdatePayload } from '@shared/eventTypes';
import type { PipelineSteps, PipelineTrigger, PaperInteraction } from '@shared/enums';

const { invoke, on } = window.electron;

export const ipc = {
  startPipeline: (steps: PipelineSteps[], trigger: PipelineTrigger, date: FeedDate) =>
    invoke('pipeline:start', steps, trigger, date),

  cancelPipeline: () => invoke('pipeline:cancel'),

  getPipelineRuns: () => invoke('pipeline:runs'),

  getJobs: () => invoke('job:runs'),

  getPapersByFeed: (feedId: number) => invoke('papers:feed', feedId),

  getPaperStatuses: (feedId: number) => invoke('papers:statuses', feedId),

  getScoresByFeed: (feedId: number) => invoke('scores:feed', feedId),

  getSummariesByFeed: (feedId: number) => invoke('summaries:feed', feedId),

  setPaperUserStatus: (paperId: number, status: PaperInteraction) => invoke('paper:set-status', paperId, status),

  getUserStatusesByFeed: (feedId: number) => invoke('paper:user-statuses', feedId),

  getFeedStepCounts: () => invoke('feed:step-counts'),

  getFeeds: () => invoke('feeds:all'),

  onPaperStatus: (cb: (payload: PaperStatusPayload) => void) => on('paper:status', cb),

  onRunUpdate: (cb: (payload: RunUpdatePayload) => void) => on('run:update', cb),

  onJobUpdate: (cb: (payload: JobUpdatePayload) => void) => on('job:update', cb),
};
