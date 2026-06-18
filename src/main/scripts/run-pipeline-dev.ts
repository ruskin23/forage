// One-off: run the real pipeline end-to-end against the DEV `forage` database
// so the results show up in the app's Reader. Mirrors the production pipeline's
// working parts (fetchFeed, downloadSource, storage, runSummary/Profile/Score,
// real queries) but coordinated by this script instead of the Orchestrator.
//
// Deliberately small footprint for arXiv safety: a narrow subcategory and a hard
// paper cap, so we make ~1 API call + a handful of /e-print downloads.
//
//   docker compose up -d
//   npx tsx src/main/scripts/run-pipeline-dev.ts

import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

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
import { insertSummaryVersion, setActiveSummary, getActiveSummary } from '../db/queries/summaries';
import {
  insertProfileVersion,
  setActiveProfile,
  countProfileVersions,
  getActiveProfile,
  getLabeledPapers,
  getPaperByArxivId,
  getCategoryStats,
} from '../db/queries/profiles';
import { upsertScore, getPapersToScore } from '../db/queries/scores';

import {
  FeedDate,
  NewProfileVersion,
  NewScore,
  NewSummaryVersion,
  Paper,
  SourceDetails,
} from '@shared/types';

const PROJECT_ROOT = process.cwd();
const STORAGE_PATH = path.join(PROJECT_ROOT, 'tmp', 'dev-run', 'papers');
const MIGRATION_DIR = path.join(PROJECT_ROOT, 'src', 'main', 'db', 'migrations');

// --- knobs ---
const CATEGORY = 'astro-ph.EP';                       // small subcategory
const TEST_DATE: FeedDate = { year: 2026, month: 5, day: 29 }; // Friday
const MAX_PAPERS = 8;                                 // hard cap on /e-print hits

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

function abortNever(): AbortSignal {
  return new AbortController().signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dateStr(d: FeedDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

async function main() {
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set in .env');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set in .env (docker compose up -d?)');

  const sql: Sql = await initDatabase(loadMigrationsFromFs(), dbUrl);
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
  const storage = new StorageService(STORAGE_PATH);
  setStorageBasePathResolver(() => storage.getBasePath());
  initOpenRouter();

  console.log('=== forage · dev pipeline run ===');
  console.log('db:', dbUrl.replace(/:[^:@]+@/, ':***@'));
  console.log('category:', CATEGORY, '· date:', dateStr(TEST_DATE), '· cap:', MAX_PAPERS);

  try {
    // ---- 1. fetch ----
    console.log('\n[1/5] fetch...');
    const { papers: fetched, totalResults } = await fetchFeed(CATEGORY, TEST_DATE, abortNever());
    console.log(`  arXiv totalResults=${totalResults}; using first ${Math.min(MAX_PAPERS, fetched.length)}`);
    if (fetched.length === 0) throw new Error('No papers for this date/category — pick another.');

    const slice = fetched.slice(0, MAX_PAPERS);
    const feedId = await ensureFeed(sql, dateStr(TEST_DATE));
    await updateFeedPaperCount(sql, feedId, slice.length);

    const paperIds: number[] = [];
    for (const ap of slice) {
      const id = await insertPaper(sql, { ...ap, feedId });
      paperIds.push(id);
      await upsertPaperStatus(sql, { paperId: id, step: 'fetch', status: 'completed', error: null, updatedAt: new Date().toISOString() });
      console.log(`  + ${ap.arxivId} · ${ap.title.slice(0, 64)}`);
    }

    // ---- 2. download ----
    console.log('\n[2/5] download (5s spacing)...');
    for (let i = 0; i < paperIds.length; i++) {
      if (i > 0) await sleep(DOWNLOAD_DELAY_MS);
      const rows = await sql<{ id: number; arxivId: string; pdfUrl: string | null }[]>`
        SELECT id, arxiv_id, pdf_url FROM papers WHERE id = ${paperIds[i]}
      `;
      const p = rows[0];
      try {
        const { buffer, sourceType } = await downloadSource(p.arxivId, p.pdfUrl, abortNever());
        if (buffer && sourceType) await storage.saveSource(p.arxivId, buffer, sourceType);
        const files = buffer ? storage.listFiles(p.arxivId) : [];
        const details: SourceDetails = { numberFiles: files.length, sourceType };
        await updatePaperSourceDetails(sql, p.id, details);
        await upsertPaperStatus(sql, { paperId: p.id, step: 'download', status: 'completed', error: null, updatedAt: new Date().toISOString() });
        console.log(`  ${p.arxivId} · ${sourceType ?? 'no-source'} · ${files.length} files`);
      } catch (err) {
        await upsertPaperStatus(sql, { paperId: p.id, step: 'download', status: 'failed', error: err instanceof Error ? err.message : String(err), updatedAt: new Date().toISOString() });
        console.error(`  ${p.arxivId} · download failed:`, err instanceof Error ? err.message : err);
      }
    }

    // ---- 3. summarize ----
    console.log('\n[3/5] summarize...');
    for (const paperId of paperIds) {
      const rows = await sql<Paper[]>`
        SELECT id, feed_id, arxiv_id, title, authors, abstract, categories,
               primary_category, published, pdf_url, source_details, created_at
        FROM papers WHERE id = ${paperId}
      `;
      const paper = rows[0];
      const sourceType = paper.sourceDetails?.sourceType ?? null;
      try {
        const result = await runSummary(sql, { paper, fileContext: { arxivId: paper.arxivId }, sourceType, paperRoot: storage.getSourcePath(paper.arxivId) }, abortNever());
        const v: NewSummaryVersion = {
          paperId: paper.id,
          description: result.description,
          summary: result.summary,
          model: result.usage.model,
          promptVersion: 'v1',
          usageJson: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, mode: result.mode },
          jobId: null,
        };
        const versionId = await insertSummaryVersion(sql, v);
        await setActiveSummary(sql, paper.id, versionId);
        await upsertPaperStatus(sql, { paperId: paper.id, step: 'summarize', status: 'completed', error: null, updatedAt: new Date().toISOString() });
        console.log(`  ${paper.arxivId} · mode=${result.mode} · ${result.description.slice(0, 90)}`);
      } catch (err) {
        await upsertPaperStatus(sql, { paperId: paper.id, step: 'summarize', status: 'failed', error: err instanceof Error ? err.message : String(err), updatedAt: new Date().toISOString() });
        console.error(`  ${paper.arxivId} · summarize failed:`, err instanceof Error ? err.message : err);
      }
    }

    // ---- 4. label a few, then build profile ----
    console.log('\n[4/5] label (2 liked / 2 dismissed) + profile...');
    const labels: Array<'liked' | 'dismissed'> = ['liked', 'liked', 'dismissed', 'dismissed'];
    for (let i = 0; i < labels.length && i < paperIds.length; i++) {
      await sql`
        INSERT INTO paper_status (paper_id, status) VALUES (${paperIds[i]}, ${labels[i]})
        ON CONFLICT (paper_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `;
    }

    const labeled = await getLabeledPapers(sql);
    const profileResult = await runProfile(
      sql,
      {
        papers: labeled,
        previousProfile: await getActiveProfile(sql),
        profileCount: await countProfileVersions(sql),
        fetchPaperDetails: (arxivId) => getPaperByArxivId(sql, arxivId),
        fetchCategoryStats: () => getCategoryStats(sql),
      },
      abortNever(),
    );
    const pv: NewProfileVersion = {
      profileSummary: profileResult.profileSummary,
      interests: profileResult.interests,
      dismissalPatterns: profileResult.dismissalPatterns,
      categoryPreferences: profileResult.categoryPreferences,
      authorAffinity: profileResult.authorAffinity,
      dismissedPaperIds: labeled.filter((p) => p.label === 'dismissed').map((p) => p.paperId),
      keptPaperIds: labeled.filter((p) => p.label === 'liked').map((p) => p.paperId),
      model: profileResult.usage.model,
      paperCount: labeled.length,
      usageJson: { inputTokens: profileResult.usage.inputTokens, outputTokens: profileResult.usage.outputTokens, totalTokens: profileResult.usage.totalTokens },
    };
    const profileVersionId = await insertProfileVersion(sql, pv);
    await setActiveProfile(sql, profileVersionId);
    console.log(`  profile built · ${profileResult.interests.length} interests · ${profileResult.profileSummary.slice(0, 120)}`);

    // ---- 5. score (real query: non-dismissed, summarized papers) ----
    console.log('\n[5/5] score...');
    const profile = await getActiveProfile(sql);
    if (!profile) throw new Error('No active profile after insert?');
    const toScore = await getPapersToScore(sql, feedId, profile.id);
    console.log(`  scoring ${toScore.length} papers`);
    for (const paper of toScore) {
      const summary = (await getActiveSummary(sql, paper.id)) ?? null;
      try {
        const result = await runScore(sql, { paper, summary, profile }, abortNever());
        const ns: NewScore = {
          paperId: paper.id,
          profileVersionId: profile.id,
          score: result.score,
          reasoning: result.reasoning,
          model: result.usage.model,
          usageJson: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens },
        };
        await upsertScore(sql, ns);
        await upsertPaperStatus(sql, { paperId: paper.id, step: 'score', status: 'completed', error: null, updatedAt: new Date().toISOString() });
        console.log(`  ${paper.arxivId} · ${result.score.toFixed(2)} · ${result.reasoning.slice(0, 80)}`);
      } catch (err) {
        console.error(`  ${paper.arxivId} · score failed:`, err instanceof Error ? err.message : err);
      }
    }

    console.log('\n=== done. Open the app → Reader to see scored, sorted papers. ===');
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
