import { Sql } from '../index';
import { Feed } from '@shared/types';

export async function ensureFeed(sql: Sql, date: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO feeds (date) VALUES (${date})
    ON CONFLICT (date) DO UPDATE SET date = EXCLUDED.date
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateFeedPaperCount(sql: Sql, feedId: number, paperCount: number): Promise<void> {
  await sql`UPDATE feeds SET paper_count = ${paperCount} WHERE id = ${feedId}`;
}

export async function getAllFeeds(sql: Sql): Promise<Feed[]> {
  return await sql<Feed[]>`
    SELECT id, date, paper_count, created_at FROM feeds ORDER BY date DESC
  `;
}

export async function getFeedByDate(sql: Sql, date: string): Promise<Feed | undefined> {
  const rows = await sql<Feed[]>`
    SELECT id, date, paper_count, created_at FROM feeds WHERE date = ${date}
  `;
  return rows[0];
}
