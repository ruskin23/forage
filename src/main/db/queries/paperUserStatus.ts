import { Sql } from '../index';
import { PaperUserStatus } from '@shared/types';
import { PaperInteraction } from '@shared/enums';

// User-set label for a paper (liked / dismissed / read / unread). Distinct from
// paper_progress, which tracks pipeline steps. 'unread' effectively clears a label.
export async function setPaperUserStatus(sql: Sql, paperId: number, status: PaperInteraction): Promise<void> {
  await sql`
    INSERT INTO paper_status (paper_id, status) VALUES (${paperId}, ${status})
    ON CONFLICT (paper_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
  `;
}

export async function getPaperUserStatusesByFeed(sql: Sql, feedId: number): Promise<PaperUserStatus[]> {
  return await sql<PaperUserStatus[]>`
    SELECT ps.paper_id, ps.status, ps.updated_at
    FROM paper_status ps
    JOIN papers p ON p.id = ps.paper_id
    WHERE p.feed_id = ${feedId}
  `;
}
