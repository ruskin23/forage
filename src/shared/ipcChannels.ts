import type { Feed, FeedDate, Paper, PaperStatus, PaperUserStatus, PipelineRun, Job, FeedStepCount, Score, SummaryVersion } from './types';
import type { PaperStatusPayload, RunUpdatePayload, JobUpdatePayload } from './eventTypes';
import type { PipelineSteps, PipelineTrigger, PaperInteraction } from './enums';

// Single source of truth for IPC contract. Both main and renderer import from here.
// Adding a channel = adding a row to one of these maps.

export type InvokeChannels = {
  'pipeline:start': { args: [steps: PipelineSteps[], trigger: PipelineTrigger, date: FeedDate]; result: void };
  'pipeline:cancel': { args: []; result: void };
  'pipeline:runs': { args: []; result: PipelineRun[] };
  'job:runs': { args: []; result: Job[] };
  'papers:feed': { args: [feedId: number]; result: Paper[] };
  'papers:statuses': { args: [feedId: number]; result: PaperStatus[] };
  'scores:feed': { args: [feedId: number]; result: Score[] };
  'summaries:feed': { args: [feedId: number]; result: SummaryVersion[] };
  'paper:set-status': { args: [paperId: number, status: PaperInteraction]; result: void };
  'paper:user-statuses': { args: [feedId: number]; result: PaperUserStatus[] };
  'feed:step-counts': { args: []; result: FeedStepCount[] };
  'feeds:all': { args: []; result: Feed[] };
};

export type EventChannels = {
  'paper:status': PaperStatusPayload;
  'run:update': RunUpdatePayload;
  'job:update': JobUpdatePayload;
};

export type InvokeChannel = keyof InvokeChannels;
export type EventChannel = keyof EventChannels;
