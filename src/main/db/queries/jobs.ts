import { Sql } from '../index';
import { Job, NewJob } from '@shared/types';
import { JobStatus } from '@shared/enums';

export async function insertJob(sql: Sql, newJob: NewJob): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO jobs (run_id, type, status)
    VALUES (${newJob.runId}, ${newJob.type}, ${newJob.status})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateJobStatus(sql: Sql, jobId: number, status: JobStatus, error?: string): Promise<void> {
  if (status === 'running') {
    await sql`UPDATE jobs SET status = ${status}, started_at = now() WHERE id = ${jobId}`;
  } else if (error) {
    await sql`UPDATE jobs SET status = ${status}, completed_at = now(), error = ${error} WHERE id = ${jobId}`;
  } else {
    await sql`UPDATE jobs SET status = ${status}, completed_at = now() WHERE id = ${jobId}`;
  }
}

export async function getJobById(sql: Sql, jobId: number): Promise<Job> {
  const rows = await sql<Job[]>`
    SELECT id, run_id, type, status, started_at, completed_at, error, created_at
    FROM jobs WHERE id = ${jobId}
  `;
  return rows[0];
}

export async function getAllJobs(sql: Sql): Promise<Job[]> {
  return await sql<Job[]>`
    SELECT id, run_id, type, status, started_at, completed_at, error, created_at
    FROM jobs ORDER BY started_at DESC NULLS LAST
  `;
}
