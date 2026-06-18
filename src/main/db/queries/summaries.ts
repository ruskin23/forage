import { Sql, asJson } from '../index';
import { NewSummaryVersion, Paper, SummaryVersion } from '@shared/types';

export async function insertSummaryVersion(sql: Sql, version: NewSummaryVersion): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO summary_versions
      (paper_id, description, summary, model, prompt_version, usage_json, job_id)
    VALUES (
      ${version.paperId},
      ${version.description},
      ${version.summary},
      ${version.model},
      ${version.promptVersion},
      ${version.usageJson === null ? null : sql.json(asJson(version.usageJson))},
      ${version.jobId}
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function setActiveSummary(sql: Sql, paperId: number, versionId: number): Promise<void> {
  await sql`
    INSERT INTO active_summary (paper_id, version_id) VALUES (${paperId}, ${versionId})
    ON CONFLICT (paper_id) DO UPDATE SET version_id = EXCLUDED.version_id
  `;
}

export async function getActiveSummary(sql: Sql, paperId: number): Promise<SummaryVersion | undefined> {
  const rows = await sql<SummaryVersion[]>`
    SELECT
      sv.id, sv.paper_id, sv.description, sv.summary, sv.model,
      sv.prompt_version, sv.usage_json, sv.job_id, sv.created_at
    FROM active_summary a
    JOIN summary_versions sv ON sv.id = a.version_id
    WHERE a.paper_id = ${paperId}
  `;
  return rows[0];
}

// Active summaries for every paper in a feed. Joined to the renderer's Paper[]
// by paperId, mirroring getScoresByFeed.
export async function getActiveSummariesByFeed(sql: Sql, feedId: number): Promise<SummaryVersion[]> {
  return await sql<SummaryVersion[]>`
    SELECT
      sv.id, sv.paper_id, sv.description, sv.summary, sv.model,
      sv.prompt_version, sv.usage_json, sv.job_id, sv.created_at
    FROM active_summary a
    JOIN summary_versions sv ON sv.id = a.version_id
    JOIN papers p ON p.id = sv.paper_id
    WHERE p.feed_id = ${feedId}
  `;
}

// Papers ready for summarization: download completed, OR last summary attempt
// failed (we want to retry).
export async function getPapersToSummarize(sql: Sql, feedId: number): Promise<Paper[]> {
  return await sql<Paper[]>`
    SELECT
      p.id, p.feed_id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories,
      p.primary_category, p.published, p.pdf_url, p.source_details, p.created_at
    FROM papers p
    JOIN paper_progress pp ON pp.paper_id = p.id
    WHERE p.feed_id = ${feedId}
      AND (
        (pp.step = 'download' AND pp.status = 'completed')
        OR (pp.step = 'summarize' AND pp.status = 'failed')
      )
  `;
}
