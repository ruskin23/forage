import { Sql, asJson } from '../index';
import { NewPaper, Paper, SourceDetails } from '@shared/types';

export async function insertPaper(sql: Sql, newPaper: NewPaper): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO papers
      (feed_id, arxiv_id, title, authors, abstract, categories, primary_category, published, pdf_url)
    VALUES (
      ${newPaper.feedId},
      ${newPaper.arxivId},
      ${newPaper.title},
      ${sql.json(asJson(newPaper.authors))},
      ${newPaper.abstract},
      ${sql.json(asJson(newPaper.categories))},
      ${newPaper.primaryCategory},
      ${newPaper.published},
      ${newPaper.pdfUrl}
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function getArxivIdsForFeed(sql: Sql, feedId: number): Promise<Set<string>> {
  const rows = await sql<{ arxivId: string }[]>`
    SELECT arxiv_id FROM papers WHERE feed_id = ${feedId}
  `;
  return new Set(rows.map((r) => r.arxivId));
}

export async function getPapersToDownload(sql: Sql, feedId: number): Promise<Paper[]> {
  return await sql<Paper[]>`
    SELECT
      p.id, p.feed_id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories,
      p.primary_category, p.published, p.pdf_url, p.source_details, p.created_at
    FROM papers p
    JOIN paper_progress pp ON pp.paper_id = p.id
    WHERE p.feed_id = ${feedId}
      AND (
        (pp.step = 'fetch' AND pp.status = 'completed')
        OR (pp.step = 'download' AND pp.status = 'failed')
      )
  `;
}

export async function getPapersByFeedId(sql: Sql, feedId: number): Promise<Paper[]> {
  return await sql<Paper[]>`
    SELECT
      p.id, p.feed_id, p.arxiv_id, p.title, p.authors, p.abstract, p.categories,
      p.primary_category, p.published, p.pdf_url, p.source_details, p.created_at
    FROM papers p WHERE p.feed_id = ${feedId}
  `;
}

export async function updatePaperSourceDetails(sql: Sql, paperId: number, sourceDetails: SourceDetails): Promise<void> {
  await sql`UPDATE papers SET source_details = ${sql.json(asJson(sourceDetails))} WHERE id = ${paperId}`;
}
