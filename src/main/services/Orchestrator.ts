import { FeedDate, NewPipelineRun, NewJob, StepFn } from "@shared/types";
import { PipelineSteps, PipelineTrigger } from "@shared/enums";
import { Sql } from "../db";
import { insertPipelineRun, updatePipelineRunStatus, updatePipelineRunStepsCompleted, getAnyRunningRun, getRunById } from "../db/queries/pipeline";
import { insertJob, updateJobStatus, getJobById } from "../db/queries/jobs";
import { ensureFeed, getFeedByDate } from "../db/queries/feeds";
import { PipelineService, NO_INPUT_ERROR } from "./Pipeline";
import { buildFeedDate } from "./Pipeline";
import { EventEmitter } from "./EventEmitter";

export class PipelineOrchestrator {
  private sql: Sql;
  private pipelineService: PipelineService;
  private eventEmitter: EventEmitter;
  private stepMap: Record<PipelineSteps, StepFn>;
  private abortController: AbortController | null = null;

  constructor(sql: Sql, pipelineService: PipelineService, eventEmitter: EventEmitter) {
    this.sql = sql;
    this.pipelineService = pipelineService;
    this.eventEmitter = eventEmitter;
    this.stepMap = {
      fetch: (date, signal) => this.pipelineService.runFetchStep('astro-ph*', date, signal),
      download: (date, signal) => this.pipelineService.runDownloadStep(date, signal),
      summarize: (date, signal, jobId) => this.pipelineService.runSummarizeStep(date, signal, jobId),
      profile: (date, signal, jobId) => this.pipelineService.runProfileStep(date, signal, jobId),
      score: (date, signal, jobId) => this.pipelineService.runScoreStep(date, signal, jobId),
    };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  async orchestrateSteps(steps: Array<PipelineSteps>, trigger: PipelineTrigger, date: FeedDate): Promise<void> {
    const feedDate = buildFeedDate(date);
    const feedId = await ensureFeed(this.sql, feedDate);

    const runningRun = await getAnyRunningRun(this.sql);
    if (runningRun) throw new Error(`Pipeline run ${runningRun.id} is already in progress`);

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const newPipelineRun: NewPipelineRun = {
      feedId,
      trigger,
      status: 'running',
      stepsQueued: steps.join(','),
    };

    const runId = await insertPipelineRun(this.sql, newPipelineRun);
    this.eventEmitter.runUpdate(await getRunById(this.sql, runId));

    const completedSteps: string[] = [];
    let failed = false;
    let cancelled = false;
    let skipRemaining = false;

    for (const step of steps) {
      const newJob: NewJob = { runId, type: step, status: 'pending' };
      const jobId = await insertJob(this.sql, newJob);
      this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));

      if (skipRemaining) {
        await updateJobStatus(this.sql, jobId, 'skipped');
        this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));
        continue;
      }

      if (cancelled) {
        await updateJobStatus(this.sql, jobId, 'cancelled');
        this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));
        continue;
      }

      const stepFn = this.stepMap[step];

      await updateJobStatus(this.sql, jobId, 'running');
      this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));

      try {
        await stepFn(date, signal, jobId);
        await updateJobStatus(this.sql, jobId, 'completed');
        this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));

        completedSteps.push(step);
        await updatePipelineRunStepsCompleted(this.sql, runId, completedSteps.join(','));
        this.eventEmitter.runUpdate(await getRunById(this.sql, runId));

        // After fetch, skip downstream if no papers
        if (step === 'fetch') {
          const feed = await getFeedByDate(this.sql, feedDate);
          if (feed && feed.paperCount === 0) {
            skipRemaining = true;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === 'cancelled') {
          await updateJobStatus(this.sql, jobId, 'cancelled');
          this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));
          cancelled = true;
        } else if (message === NO_INPUT_ERROR) {
          // Step had nothing to act on (e.g. profile with no labeled papers,
          // score with no active profile). Mark skipped, keep going.
          await updateJobStatus(this.sql, jobId, 'skipped');
          this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));
        } else {
          await updateJobStatus(this.sql, jobId, 'failed', message);
          this.eventEmitter.jobUpdate(await getJobById(this.sql, jobId));
          failed = true;
          break;
        }
      }
    }

    const finalStatus = cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
    await updatePipelineRunStatus(this.sql, runId, finalStatus);
    this.eventEmitter.runUpdate(await getRunById(this.sql, runId));
    this.abortController = null;
  }
}
