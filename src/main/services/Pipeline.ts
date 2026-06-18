import { FeedDate, NewPaper, PaperStatus, SourceDetails, NewSummaryVersion, NewProfileVersion, NewScore } from "@shared/types";
import { Sql } from "../db";
import { StorageService } from "./Storage";
import { downloadSource, fetchFeed, DOWNLOAD_DELAY_MS } from "../sources/arxiv";
import { getFeedByDate, updateFeedPaperCount } from "../db/queries/feeds";
import { getArxivIdsForFeed, getPapersToDownload, insertPaper, updatePaperSourceDetails } from "../db/queries/papers";
import { upsertPaperStatus, getStepStats } from "../db/queries/paperStatus";
import { getPapersToSummarize, insertSummaryVersion, setActiveSummary, getActiveSummary } from "../db/queries/summaries";
import {
  insertProfileVersion,
  setActiveProfile,
  getActiveProfile,
  countProfileVersions,
  getLabeledPapers,
  getPaperByArxivId,
  getCategoryStats,
} from "../db/queries/profiles";
import { upsertScore, getPapersToScore } from "../db/queries/scores";
import { EventEmitter } from "./EventEmitter";
import { abortableSleep, isCancellation } from "./cancellation";
import { runSummary } from "../agents/summaryAgent";
import { runProfile } from "../agents/profileBuilderAgent";
import { runScore } from "../agents/scoringAgent";

// Empty-input sentinel: profile/score steps throw this when there's nothing to
// process so the orchestrator can mark the job as "skipped" rather than failed.
export const NO_INPUT_ERROR = 'no_input';


export function buildFeedDate(date: FeedDate) {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

export class PipelineService {
  private sql: Sql;
  private storageService: StorageService;
  private eventEmitter: EventEmitter;

  constructor(sql: Sql, storageService: StorageService, eventEmitter: EventEmitter) {
    this.sql = sql;
    this.storageService = storageService;
    this.eventEmitter = eventEmitter;
  }

  async runFetchStep(category: string, date: FeedDate, signal: AbortSignal): Promise<void> {
    const feedDate = buildFeedDate(date);
    const feed = await getFeedByDate(this.sql, feedDate);
    if (!feed) throw new Error(`No feed found for date ${feedDate}`);

    const { papers, totalResults } = await fetchFeed(category, date, signal);
    await updateFeedPaperCount(this.sql, feed.id, totalResults);

    if (totalResults) {
      const existingIds = await getArxivIdsForFeed(this.sql, feed.id);
      const newPapers = papers.filter((p) => !existingIds.has(p.arxivId));

      let success = 0;
      const failed = 0;
      const total = newPapers.length;

      for (const arxivPaper of newPapers) {
        if (signal.aborted) throw new Error('cancelled');

        const newPaper: NewPaper = { ...arxivPaper, feedId: feed.id };
        const paperId = await insertPaper(this.sql, newPaper);

        const paperStatus: PaperStatus = {
          paperId,
          step: 'fetch',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        };

        success++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      }
    }
  }

  async runDownloadStep(date: FeedDate, signal: AbortSignal): Promise<void> {
    const feedDate = buildFeedDate(date);
    const feed = await getFeedByDate(this.sql, feedDate);
    if (!feed) throw new Error(`No feed found for date ${feedDate}`);
    const papers = await getPapersToDownload(this.sql, feed.id);

    const stats = await getStepStats(this.sql, feed.id, 'download');
    let success = stats.success;
    let failed = stats.failed;
    const total = stats.total;

    for (let i = 0; i < papers.length; i++) {
      if (signal.aborted) throw new Error('cancelled');

      const paper = papers[i];

      // arXiv ToU: max 1 request per 3s. Wait between downloads (not before first).
      if (i > 0) {
        await abortableSleep(DOWNLOAD_DELAY_MS, signal);
      }

      try {
        const { buffer, sourceType } = await downloadSource(paper.arxivId, paper.pdfUrl, signal);

        if (buffer && sourceType) {
          await this.storageService.saveSource(paper.arxivId, buffer, sourceType);
        }

        const files = buffer ? this.storageService.listFiles(paper.arxivId) : [];
        const sourceDetails: SourceDetails = { numberFiles: files.length, sourceType };
        await updatePaperSourceDetails(this.sql, paper.id, sourceDetails);

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'download',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        };

        success++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      } catch (err) {
        if (isCancellation(err)) throw new Error('cancelled');

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'download',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        };

        failed++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      }
    }
  }

  async runSummarizeStep(date: FeedDate, signal: AbortSignal, jobId: number | null): Promise<void> {
    const feedDate = buildFeedDate(date);
    const feed = await getFeedByDate(this.sql, feedDate);
    if (!feed) throw new Error(`No feed found for date ${feedDate}`);
    const papers = await getPapersToSummarize(this.sql, feed.id);

    const stats = await getStepStats(this.sql, feed.id, 'summarize');
    let success = stats.success;
    let failed = stats.failed;
    const total = stats.total;

    for (const paper of papers) {
      if (signal.aborted) throw new Error('cancelled');

      const sourceType = paper.sourceDetails?.sourceType ?? null;
      const paperRoot = this.storageService.getSourcePath(paper.arxivId);

      try {
        const result = await runSummary(
          this.sql,
          {
            paper,
            fileContext: { arxivId: paper.arxivId },
            sourceType,
            paperRoot,
          },
          signal,
        );

        const newVersion: NewSummaryVersion = {
          paperId: paper.id,
          description: result.description,
          summary: result.summary,
          model: result.usage.model,
          promptVersion: 'v1',
          usageJson: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
            mode: result.mode,
          },
          jobId,
        };

        const versionId = await insertSummaryVersion(this.sql, newVersion);
        await setActiveSummary(this.sql, paper.id, versionId);

        // Download → summarize → delete: source files are transient.
        try {
          this.storageService.deleteSource(paper.arxivId);
        } catch {
          // Best-effort cleanup. Don't let a leftover dir fail the paper.
        }

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'summarize',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        };

        success++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      } catch (err) {
        if (isCancellation(err)) throw new Error('cancelled');

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'summarize',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        };

        failed++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      }
    }
  }

  async runProfileStep(_date: FeedDate, signal: AbortSignal, _jobId: number | null): Promise<void> {
    if (signal.aborted) throw new Error('cancelled');

    const labeled = await getLabeledPapers(this.sql);
    if (labeled.length === 0) {
      throw new Error(NO_INPUT_ERROR);
    }

    const previousProfile = await getActiveProfile(this.sql);
    const profileCount = await countProfileVersions(this.sql);

    const result = await runProfile(
      this.sql,
      {
        papers: labeled,
        previousProfile,
        profileCount,
        fetchPaperDetails: (arxivId) => getPaperByArxivId(this.sql, arxivId),
        fetchCategoryStats: () => getCategoryStats(this.sql),
      },
      signal,
    );

    const dismissedIds = labeled.filter((p) => p.label === 'dismissed').map((p) => p.paperId);
    const keptIds = labeled.filter((p) => p.label === 'liked').map((p) => p.paperId);

    const newVersion: NewProfileVersion = {
      profileSummary: result.profileSummary,
      interests: result.interests,
      dismissalPatterns: result.dismissalPatterns,
      categoryPreferences: result.categoryPreferences,
      authorAffinity: result.authorAffinity,
      dismissedPaperIds: dismissedIds,
      keptPaperIds: keptIds,
      model: result.usage.model,
      paperCount: labeled.length,
      usageJson: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };

    const versionId = await insertProfileVersion(this.sql, newVersion);
    await setActiveProfile(this.sql, versionId);
  }

  async runScoreStep(date: FeedDate, signal: AbortSignal, _jobId: number | null): Promise<void> {
    if (signal.aborted) throw new Error('cancelled');

    const profile = await getActiveProfile(this.sql);
    if (!profile) throw new Error(NO_INPUT_ERROR);

    const feedDate = buildFeedDate(date);
    const feed = await getFeedByDate(this.sql, feedDate);
    if (!feed) throw new Error(`No feed found for date ${feedDate}`);

    const papers = await getPapersToScore(this.sql, feed.id, profile.id);
    if (papers.length === 0) throw new Error(NO_INPUT_ERROR);

    let success = 0;
    let failed = 0;
    const total = papers.length;

    for (const paper of papers) {
      if (signal.aborted) throw new Error('cancelled');

      const summary = (await getActiveSummary(this.sql, paper.id)) ?? null;

      try {
        const result = await runScore(this.sql, { paper, summary, profile }, signal);

        const newScore: NewScore = {
          paperId: paper.id,
          profileVersionId: profile.id,
          score: result.score,
          reasoning: result.reasoning,
          model: result.usage.model,
          usageJson: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          },
        };

        await upsertScore(this.sql, newScore);

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'score',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        };

        success++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      } catch (err) {
        if (isCancellation(err)) throw new Error('cancelled');

        const paperStatus: PaperStatus = {
          paperId: paper.id,
          step: 'score',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        };

        failed++;
        await upsertPaperStatus(this.sql, paperStatus);
        this.eventEmitter.paperStatus(paperStatus, { success, failed, total });
      }
    }
  }
}
