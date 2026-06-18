import { Sql, asJson } from '../index';
import { LabeledPaper, NewProfileVersion, Paper, ProfileVersion, CategoryStat } from '@shared/types';

export async function insertProfileVersion(sql: Sql, version: NewProfileVersion): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO profile_versions (
      profile_summary, interests, dismissal_patterns, category_preferences, author_affinity,
      dismissed_paper_ids, kept_paper_ids, model, paper_count, usage_json
    ) VALUES (
      ${version.profileSummary},
      ${sql.json(asJson(version.interests))},
      ${sql.json(asJson(version.dismissalPatterns))},
      ${sql.json(asJson(version.categoryPreferences))},
      ${sql.json(asJson(version.authorAffinity))},
      ${sql.json(asJson(version.dismissedPaperIds))},
      ${sql.json(asJson(version.keptPaperIds))},
      ${version.model},
      ${version.paperCount},
      ${version.usageJson === null ? null : sql.json(asJson(version.usageJson))}
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function setActiveProfile(sql: Sql, versionId: number): Promise<void> {
  await sql`
    INSERT INTO active_profile (id, version_id) VALUES (1, ${versionId})
    ON CONFLICT (id) DO UPDATE SET version_id = EXCLUDED.version_id
  `;
}

export async function getActiveProfile(sql: Sql): Promise<ProfileVersion | null> {
  const rows = await sql<ProfileVersion[]>`
    SELECT
      pv.id, pv.profile_summary, pv.interests, pv.dismissal_patterns,
      pv.category_preferences, pv.author_affinity, pv.dismissed_paper_ids,
      pv.kept_paper_ids, pv.model, pv.paper_count, pv.usage_json, pv.created_at
    FROM active_profile a
    JOIN profile_versions pv ON pv.id = a.version_id
  `;
  return rows[0] ?? null;
}

export async function countProfileVersions(sql: Sql): Promise<number> {
  const rows = await sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM profile_versions`;
  return rows[0].c;
}

// Labeled papers across all feeds. dismissed → 'dismissed'; liked/read → 'liked'.
// Bounded so a long history doesn't blow context.
export async function getLabeledPapers(sql: Sql, limit = 500): Promise<LabeledPaper[]> {
  return await sql<LabeledPaper[]>`
    SELECT
      p.id AS paper_id,
      p.arxiv_id,
      p.title,
      p.primary_category,
      p.published,
      CASE WHEN ps.status = 'dismissed' THEN 'dismissed' ELSE 'liked' END AS label
    FROM papers p
    JOIN paper_status ps ON ps.paper_id = p.id
    WHERE ps.status IN ('dismissed', 'liked', 'read')
    ORDER BY ps.updated_at DESC
    LIMIT ${limit}
  `;
}

export async function getPaperByArxivId(sql: Sql, arxivId: string): Promise<Paper | null> {
  const rows = await sql<Paper[]>`
    SELECT
      p.id, p.feed_id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories,
      p.primary_category, p.published, p.pdf_url, p.source_details, p.created_at
    FROM papers p WHERE p.arxiv_id = ${arxivId}
  `;
  return rows[0] ?? null;
}

export async function getCategoryStats(sql: Sql): Promise<CategoryStat[]> {
  const rows = await sql<{ category: string; total: number; dismissed: number; kept: number }[]>`
    SELECT
      p.primary_category AS category,
      COUNT(*)::int AS total,
      SUM(CASE WHEN ps.status = 'dismissed' THEN 1 ELSE 0 END)::int AS dismissed,
      SUM(CASE WHEN ps.status IN ('liked', 'read') THEN 1 ELSE 0 END)::int AS kept
    FROM papers p
    JOIN paper_status ps ON ps.paper_id = p.id
    WHERE ps.status IN ('dismissed', 'liked', 'read')
    GROUP BY p.primary_category
    ORDER BY total DESC
  `;
  return rows.map((r) => ({
    ...r,
    dismissRate: r.total > 0 ? r.dismissed / r.total : 0,
  }));
}
