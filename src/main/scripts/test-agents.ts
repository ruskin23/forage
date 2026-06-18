// End-to-end agent test against real arXiv data + OpenRouter, on a throwaway
// `forage_test` database that is dropped and recreated each run.
//
//   docker compose up -d                         # ensure postgres is up
//   npx tsx src/main/scripts/test-agents.ts
//
// Prints model + token usage per call so you can verify cost is sane.

import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

import { initDatabase, closeDatabase, Sql } from '../db';
import type { Migration } from '../db/migrations';
import { initOpenRouter } from '../agents/shared/config';
import { setStorageBasePathResolver } from '../agents/shared/storageSandbox';
import { runSummary } from '../agents/summaryAgent';
import { runProfile } from '../agents/profileBuilderAgent';
import { runScore } from '../agents/scoringAgent';
import { fetchFeed, downloadSource, DOWNLOAD_DELAY_MS } from '../sources/arxiv';
import { StorageService } from '../services/Storage';

import { ensureFeed, updateFeedPaperCount } from '../db/queries/feeds';
import { insertPaper, updatePaperSourceDetails } from '../db/queries/papers';
import { upsertPaperStatus } from '../db/queries/paperStatus';
import {
  insertSummaryVersion,
  setActiveSummary,
  getActiveSummary,
} from '../db/queries/summaries';
import {
  insertProfileVersion,
  setActiveProfile,
  countProfileVersions,
  getActiveProfile,
  getLabeledPapers,
  getPaperByArxivId,
  getCategoryStats,
} from '../db/queries/profiles';
import { upsertScore } from '../db/queries/scores';

import {
  AgentUsage,
  FeedDate,
  NewProfileVersion,
  NewScore,
  NewSummaryVersion,
  Paper,
  SourceDetails,
} from '@shared/types';

const PROJECT_ROOT = process.cwd();
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'agent-test');
const STORAGE_PATH = path.join(TMP_DIR, 'papers');
const MIGRATION_DIR = path.join(PROJECT_ROOT, 'src', 'main', 'db', 'migrations');
const TEST_DB_NAME = 'forage_test';

// Keep the test cheap. 4 papers gives a 2-2 dismissed/liked split.
const MAX_PAPERS = 4;

// Pick a recent weekday with arXiv submissions. Adjust if you re-run.
const TEST_DATE: FeedDate = { year: 2026, month: 4, day: 21 }; // Tuesday

function loadMigrationsFromFs(): Migration[] {
  return fs.readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file, i) => ({
      version: i + 1,
      name: file.replace(/\.sql$/, ''),
      sql: fs.readFileSync(path.join(MIGRATION_DIR, file), 'utf-8'),
    }));
}

// `CREATE DATABASE` cannot run inside a transaction or against the database
// it is creating. Connect to the postgres maintenance DB to do it, then
// reconnect to forage_test for the test.
async function recreateTestDatabase(baseUrl: string): Promise<string> {
  const adminUrl = baseUrl.replace(/\/[^/]+$/, '/postgres');
  const testUrl = baseUrl.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);

  const admin = postgres(adminUrl, { max: 1 });
  try {
    // Terminate any leftover connections so DROP doesn't block.
    await admin.unsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()
    `);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  return testUrl;
}

function totalTokens(usage: AgentUsage): string {
  return `${usage.inputTokens}+${usage.outputTokens}=${usage.totalTokens}`;
}

function abortNever(): AbortSignal {
  return new AbortController().signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set in .env at the project root.');
  }
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set in .env. Did you run `docker compose up -d`?');
  }

  const testUrl = await recreateTestDatabase(baseUrl);
  const sql: Sql = await initDatabase(loadMigrationsFromFs(), testUrl);

  fs.mkdirSync(STORAGE_PATH, { recursive: true });
  const storage = new StorageService(STORAGE_PATH);
  setStorageBasePathResolver(() => storage.getBasePath());
  initOpenRouter();

  console.log('=== forage agents · end-to-end test (postgres) ===');
  console.log('models:', {
    summary: process.env.OPENROUTER_MODEL_SUMMARY ?? 'openai/gpt-4o-mini (default)',
    profile: process.env.OPENROUTER_MODEL_PROFILE ?? 'openai/gpt-4o-mini (default)',
    score: process.env.OPENROUTER_MODEL_SCORE ?? 'openai/gpt-4o-mini (default)',
  });
  console.log('test date:', TEST_DATE);
  console.log('max papers:', MAX_PAPERS);
  console.log('database:', testUrl.replace(/:[^:@]+@/, ':***@'));

  try {
    // ---- 1. fetch ----
    console.log('\n[1/5] fetching from arXiv...');
    const { papers: fetched, totalResults } = await fetchFeed('astro-ph*', TEST_DATE, abortNever());
    console.log(`arXiv returned ${totalResults} total; using first ${MAX_PAPERS}`);
    if (fetched.length === 0) throw new Error('No papers returned for test date — pick another date.');

    const slice = fetched.slice(0, MAX_PAPERS);
    const dateStr = `${TEST_DATE.year}-${String(TEST_DATE.month).padStart(2, '0')}-${String(TEST_DATE.day).padStart(2, '0')}`;
    const feedId = await ensureFeed(sql, dateStr);
    await updateFeedPaperCount(sql, feedId, slice.length);

    const paperIds: number[] = [];
    for (const arxivPaper of slice) {
      const id = await insertPaper(sql, { ...arxivPaper, feedId });
      paperIds.push(id);
      await upsertPaperStatus(sql, {
        paperId: id,
        step: 'fetch',
        status: 'completed',
        error: null,
        updatedAt: new Date().toISOString(),
      });
      console.log(`  ${arxivPaper.arxivId} · ${arxivPaper.title.slice(0, 70)}`);
    }

    // ---- 2. download ----
    console.log('\n[2/5] downloading sources...');
    for (let i = 0; i < paperIds.length; i++) {
      if (i > 0) await sleep(DOWNLOAD_DELAY_MS);
      const paperId = paperIds[i];
      const rows = await sql<{ id: number; arxivId: string; pdfUrl: string | null }[]>`
        SELECT id, arxiv_id, pdf_url FROM papers WHERE id = ${paperId}
      `;
      const paperRow = rows[0];

      try {
        const { buffer, sourceType } = await downloadSource(paperRow.arxivId, paperRow.pdfUrl, abortNever());
        if (buffer && sourceType) await storage.saveSource(paperRow.arxivId, buffer, sourceType);
        const files = buffer ? storage.listFiles(paperRow.arxivId) : [];
        const sourceDetails: SourceDetails = { numberFiles: files.length, sourceType };
        await updatePaperSourceDetails(sql, paperRow.id, sourceDetails);

        await upsertPaperStatus(sql, {
          paperId: paperRow.id,
          step: 'download',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        });
        console.log(`  ${paperRow.arxivId} · ${sourceType ?? 'no-source'} · ${files.length} files`);
      } catch (err) {
        console.error(`  ${paperRow.arxivId} · download failed:`, err instanceof Error ? err.message : err);
        await upsertPaperStatus(sql, {
          paperId: paperRow.id,
          step: 'download',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // ---- 3. summarize ----
    console.log('\n[3/5] summarizing...');
    const totalSummaryUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    for (const paperId of paperIds) {
      const rows = await sql<Paper[]>`
        SELECT id, feed_id, arxiv_id, title, authors, abstract, categories,
               primary_category, published, pdf_url, source_details, created_at
        FROM papers WHERE id = ${paperId}
      `;
      const paper = rows[0];
      const sourceType = paper.sourceDetails?.sourceType ?? null;
      const paperRoot = storage.getSourcePath(paper.arxivId);

      try {
        const result = await runSummary(
          sql,
          { paper, fileContext: { arxivId: paper.arxivId }, sourceType, paperRoot },
          abortNever(),
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
          jobId: null,
        };
        const versionId = await insertSummaryVersion(sql, newVersion);
        await setActiveSummary(sql, paper.id, versionId);

        await upsertPaperStatus(sql, {
          paperId: paper.id,
          step: 'summarize',
          status: 'completed',
          error: null,
          updatedAt: new Date().toISOString(),
        });

        totalSummaryUsage.inputTokens += result.usage.inputTokens;
        totalSummaryUsage.outputTokens += result.usage.outputTokens;
        totalSummaryUsage.totalTokens += result.usage.totalTokens;

        console.log(`  ${paper.arxivId} · mode=${result.mode} · tokens=${totalTokens(result.usage)}`);
        console.log(`    description: ${result.description.slice(0, 140)}`);
      } catch (err) {
        console.error(`  ${paper.arxivId} · summarize failed:`, err instanceof Error ? err.message : err);
        await upsertPaperStatus(sql, {
          paperId: paper.id,
          step: 'summarize',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    console.log(`  summary totals: ${totalSummaryUsage.inputTokens}+${totalSummaryUsage.outputTokens}=${totalSummaryUsage.totalTokens}`);

    // ---- 4. label + profile ----
    console.log('\n[4/5] labeling 50/50 then building profile...');
    for (let i = 0; i < paperIds.length; i++) {
      const status = i % 2 === 0 ? 'liked' : 'dismissed';
      await sql`
        INSERT INTO paper_status (paper_id, status) VALUES (${paperIds[i]}, ${status})
        ON CONFLICT (paper_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `;
    }

    const labeled = await getLabeledPapers(sql);
    const previousProfile = await getActiveProfile(sql);
    const profileCount = await countProfileVersions(sql);

    const profileResult = await runProfile(
      sql,
      {
        papers: labeled,
        previousProfile,
        profileCount,
        fetchPaperDetails: (arxivId) => getPaperByArxivId(sql, arxivId),
        fetchCategoryStats: () => getCategoryStats(sql),
      },
      abortNever(),
    );

    const profileVersion: NewProfileVersion = {
      profileSummary: profileResult.profileSummary,
      interests: profileResult.interests,
      dismissalPatterns: profileResult.dismissalPatterns,
      categoryPreferences: profileResult.categoryPreferences,
      authorAffinity: profileResult.authorAffinity,
      dismissedPaperIds: labeled.filter((p) => p.label === 'dismissed').map((p) => p.paperId),
      keptPaperIds: labeled.filter((p) => p.label === 'liked').map((p) => p.paperId),
      model: profileResult.usage.model,
      paperCount: labeled.length,
      usageJson: {
        inputTokens: profileResult.usage.inputTokens,
        outputTokens: profileResult.usage.outputTokens,
        totalTokens: profileResult.usage.totalTokens,
      },
    };
    const profileVersionId = await insertProfileVersion(sql, profileVersion);
    await setActiveProfile(sql, profileVersionId);

    console.log(`  profile tokens=${totalTokens(profileResult.usage)}`);
    console.log(`  summary: ${profileResult.profileSummary.slice(0, 240)}`);
    console.log(`  interests: ${profileResult.interests.length} entries`);
    console.log(`  dismissal patterns: ${profileResult.dismissalPatterns.length} entries`);

    // ---- 5. score ----
    console.log('\n[5/5] scoring papers against profile...');
    const profile = await getActiveProfile(sql);
    if (!profile) throw new Error('Profile vanished after insert?');
    const totalScoreUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    for (const paperId of paperIds) {
      const rows = await sql<Paper[]>`
        SELECT id, feed_id, arxiv_id, title, authors, abstract, categories,
               primary_category, published, pdf_url, source_details, created_at
        FROM papers WHERE id = ${paperId}
      `;
      const paper = rows[0];
      const summary = (await getActiveSummary(sql, paper.id)) ?? null;

      try {
        const result = await runScore(sql, { paper, summary, profile }, abortNever());
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
        await upsertScore(sql, newScore);
        totalScoreUsage.inputTokens += result.usage.inputTokens;
        totalScoreUsage.outputTokens += result.usage.outputTokens;
        totalScoreUsage.totalTokens += result.usage.totalTokens;
        console.log(`  ${paper.arxivId} · ${result.score.toFixed(2)} · ${result.reasoning.slice(0, 100)}`);
      } catch (err) {
        console.error(`  ${paper.arxivId} · score failed:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`  score totals: ${totalScoreUsage.inputTokens}+${totalScoreUsage.outputTokens}=${totalScoreUsage.totalTokens}`);

    console.log('\n=== done ===');
    console.log('grand totals:', {
      summary: totalSummaryUsage,
      profile: { inputTokens: profileResult.usage.inputTokens, outputTokens: profileResult.usage.outputTokens, totalTokens: profileResult.usage.totalTokens },
      score: totalScoreUsage,
    });
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
