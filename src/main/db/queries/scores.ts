import { Sql, asJson } from '../index';
import { NewScore, Paper, Score } from '@shared/types';

export async function upsertScore(sql: Sql, score: NewScore): Promise<void> {
  await sql`
    INSERT INTO scores
      (paper_id, profile_version_id, score, reasoning, model, usage_json)
    VALUES (
      ${score.paperId},
      ${score.profileVersionId},
      ${score.score},
      ${score.reasoning},
      ${score.model},
      ${score.usageJson === null ? null : sql.json(asJson(score.usageJson))}
    )
    ON CONFLICT (paper_id) DO UPDATE SET
      profile_version_id = EXCLUDED.profile_version_id,
      score = EXCLUDED.score,
      reasoning = EXCLUDED.reasoning,
      model = EXCLUDED.model,
      usage_json = EXCLUDED.usage_json,
      scored_at = now()
  `;
}

export async function getScoreForPaper(sql: Sql, paperId: number): Promise<Score | null> {
  const rows = await sql<Score[]>`
    SELECT id, paper_id, profile_version_id, score, reasoning, model, usage_json, scored_at
    FROM scores WHERE paper_id = ${paperId}
  `;
  return rows[0] ?? null;
}

// All scores for papers in a feed. Joined to the renderer's Paper[] by paperId.
export async function getScoresByFeed(sql: Sql, feedId: number): Promise<Score[]> {
  return await sql<Score[]>`
    SELECT s.id, s.paper_id, s.profile_version_id, s.score, s.reasoning, s.model, s.usage_json, s.scored_at
    FROM scores s
    JOIN papers p ON p.id = s.paper_id
    WHERE p.feed_id = ${feedId}
  `;
}

// Papers ready to score: summarized, not user-dismissed, and either missing a
// score or scored against a stale profile version.
export async function getPapersToScore(
  sql: Sql,
  feedId: number,
  activeProfileVersionId: number,
): Promise<Paper[]> {
  return await sql<Paper[]>`
    SELECT
      p.id, p.feed_id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories,
      p.primary_category, p.published, p.pdf_url, p.source_details, p.created_at
    FROM papers p
    JOIN paper_progress pp ON pp.paper_id = p.id
    LEFT JOIN paper_status ps ON ps.paper_id = p.id
    LEFT JOIN scores s ON s.paper_id = p.id
    WHERE p.feed_id = ${feedId}
      AND pp.step = 'summarize' AND pp.status = 'completed'
      AND (ps.status IS NULL OR ps.status != 'dismissed')
      AND (s.profile_version_id IS NULL OR s.profile_version_id != ${activeProfileVersionId})
  `;
}
