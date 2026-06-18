import { Sql } from "../db";
import { PipelineOrchestrator } from "../services/Orchestrator";
import { getAllPipelineRuns } from "../db/queries/pipeline";
import { getAllJobs } from "../db/queries/jobs";
import { getPapersByFeedId } from "../db/queries/papers";
import { getPaperStatusesByFeed, getAllFeedStepCounts } from "../db/queries/paperStatus";
import { getScoresByFeed } from "../db/queries/scores";
import { getActiveSummariesByFeed } from "../db/queries/summaries";
import { setPaperUserStatus, getPaperUserStatusesByFeed } from "../db/queries/paperUserStatus";
import { getAllFeeds } from "../db/queries/feeds";
import { handle } from "./handle";

export function registerPipelineHandlers(sql: Sql, orchestrator: PipelineOrchestrator) {
  handle('pipeline:start', async (_event, steps, trigger, date) => {
    await orchestrator.orchestrateSteps(steps, trigger, date);
  });
  handle('pipeline:cancel', () => {
    orchestrator.cancel();
  });
  handle('pipeline:runs', () => getAllPipelineRuns(sql));
  handle('job:runs', () => getAllJobs(sql));
  handle('papers:feed', (_event, feedId) => getPapersByFeedId(sql, feedId));
  handle('papers:statuses', (_event, feedId) => getPaperStatusesByFeed(sql, feedId));
  handle('scores:feed', (_event, feedId) => getScoresByFeed(sql, feedId));
  handle('summaries:feed', (_event, feedId) => getActiveSummariesByFeed(sql, feedId));
  handle('paper:set-status', (_event, paperId, status) => setPaperUserStatus(sql, paperId, status));
  handle('paper:user-statuses', (_event, feedId) => getPaperUserStatusesByFeed(sql, feedId));
  handle('feed:step-counts', () => getAllFeedStepCounts(sql));
  handle('feeds:all', () => getAllFeeds(sql));
}
