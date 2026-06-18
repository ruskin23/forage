import { Sql } from '../index';
import { NewPipelineRun, PipelineRun } from '@shared/types';
import { PipelineStatus } from '@shared/enums';

export async function insertPipelineRun(sql: Sql, newPipelineRun: NewPipelineRun): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO pipeline_runs (feed_id, trigger, status, steps_queued)
    VALUES (
      ${newPipelineRun.feedId},
      ${newPipelineRun.trigger},
      ${newPipelineRun.status},
      ${newPipelineRun.stepsQueued}
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function getAnyRunningRun(sql: Sql): Promise<PipelineRun | undefined> {
  const rows = await sql<PipelineRun[]>`
    SELECT id, feed_id, trigger, status, steps_queued, steps_completed, started_at, completed_at
    FROM pipeline_runs WHERE status = 'running' LIMIT 1
  `;
  return rows[0];
}

export async function updatePipelineRunStatus(sql: Sql, runId: number, status: PipelineStatus): Promise<void> {
  await sql`UPDATE pipeline_runs SET status = ${status}, completed_at = now() WHERE id = ${runId}`;
}

export async function updatePipelineRunStepsCompleted(sql: Sql, runId: number, stepsCompleted: string): Promise<void> {
  await sql`UPDATE pipeline_runs SET steps_completed = ${stepsCompleted} WHERE id = ${runId}`;
}

export async function getRunById(sql: Sql, runId: number): Promise<PipelineRun> {
  const rows = await sql<PipelineRun[]>`
    SELECT id, feed_id, trigger, status, steps_queued, steps_completed, started_at, completed_at
    FROM pipeline_runs WHERE id = ${runId}
  `;
  return rows[0];
}

export async function getAllPipelineRuns(sql: Sql): Promise<PipelineRun[]> {
  return await sql<PipelineRun[]>`
    SELECT id, feed_id, trigger, status, steps_queued, steps_completed, started_at, completed_at
    FROM pipeline_runs ORDER BY started_at DESC
  `;
}
