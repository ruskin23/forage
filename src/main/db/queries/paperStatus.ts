import { Sql } from '../index';
import { PaperStatus, FeedStepCount } from '@shared/types';
import { PipelineSteps } from '@shared/enums';
import { StepProgress } from '@shared/eventTypes';

export async function upsertPaperStatus(sql: Sql, progress: PaperStatus): Promise<void> {
  await sql`
    INSERT INTO paper_progress (paper_id, step, status, error, updated_at)
    VALUES (${progress.paperId}, ${progress.step}, ${progress.status}, ${progress.error}, ${progress.updatedAt})
    ON CONFLICT (paper_id) DO UPDATE SET
      step = EXCLUDED.step,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getStepStats(sql: Sql, feedId: number, step: PipelineSteps): Promise<StepProgress> {
  const rows = await sql<{ success: number; failed: number; total: number }[]>`
    SELECT
      COUNT(CASE WHEN pp.step = ${step} AND pp.status = 'completed' THEN 1 END)::int AS success,
      COUNT(CASE WHEN pp.step = ${step} AND pp.status = 'failed' THEN 1 END)::int AS failed,
      (SELECT COUNT(*)::int FROM papers WHERE feed_id = ${feedId}) AS total
    FROM papers p
    LEFT JOIN paper_progress pp ON pp.paper_id = p.id
    WHERE p.feed_id = ${feedId}
  `;
  return rows[0];
}

export async function getPaperStatusesByFeed(sql: Sql, feedId: number): Promise<PaperStatus[]> {
  return await sql<PaperStatus[]>`
    SELECT pp.paper_id, pp.step, pp.status, pp.error, pp.updated_at
    FROM paper_progress pp
    JOIN papers p ON p.id = pp.paper_id
    WHERE p.feed_id = ${feedId}
  `;
}

export async function getAllFeedStepCounts(sql: Sql): Promise<FeedStepCount[]> {
  return await sql<FeedStepCount[]>`
    SELECT
      p.feed_id, pp.step, pp.status, COUNT(*)::int AS count
    FROM papers p
    JOIN paper_progress pp ON pp.paper_id = p.id
    GROUP BY p.feed_id, pp.step, pp.status
  `;
}
