// Function types

import { JobStatus, JobType, PaperInteraction, PipelineStatus, PipelineSteps, PipelineTrigger, SourceType } from "@shared/enums";

export type StepFn = (date: FeedDate, signal: AbortSignal, jobId: number | null) => Promise<void>;

// Common

export interface FeedDate {
  year: number;
  month: number;
  day: number;
}

// --- Feeds ---

export interface Feed {
  id: number;
  date: string;
  paperCount: number | null;
  createdAt: string;
}


// --- Papers ---
//
// Note on jsonb fields: Postgres returns parsed values, so `authors` /
// `categories` are real `string[]` and `sourceDetails` is a real object.
// On insert, the queries layer wraps them in `sql.json(...)` to send as jsonb.

export interface Paper {
  id: number;
  feedId: number;
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
  primaryCategory: string;
  published: string | null;
  pdfUrl: string | null;
  sourceDetails: SourceDetails | null;
  createdAt: string;
}

export type NewPaper = Omit<Paper, 'id' | 'createdAt' | 'sourceDetails'>;

export interface SourceDetails {
  numberFiles: number;
  sourceType: SourceType | null;
}

export interface DownloadResult {
  buffer: Buffer | null;
  sourceType: SourceType | null;
}

// --- arXiv API ---

export interface ArxivEntry {
  id: string;
  title?: string;
  summary?: string;
  published?: string;
  primary_category?: { '@_term': string };
  author: ArxivAuthor | ArxivAuthor[];
  category: ArxivCategory | ArxivCategory[];
  link: ArxivLink | ArxivLink[];
}

export interface ArxivAuthor { name: string }
export interface ArxivCategory { '@_term': string }
export interface ArxivLink { '@_href': string; '@_title'?: string }

export interface PaperStatus {
  paperId: number;
  step: PipelineSteps;
  status: 'completed' | 'failed';
  error: string | null;
  updatedAt: string;
}

export interface FeedStepCount {
  feedId: number;
  step: string;
  status: string;
  count: number;
}

// User interaction
export interface PaperUserStatus {
  paperId: number;
  status: PaperInteraction;
  updatedAt: string;
}

// --- Pipeline ---

export interface PipelineRun {
  id: number;
  feedId: number;
  trigger: PipelineTrigger;
  status: PipelineStatus;
  stepsQueued: string;
  stepsCompleted: string;
  startedAt: string;
  completedAt: string | null;
}

export type NewPipelineRun = Pick<PipelineRun, 'feedId' | 'trigger' | 'stepsQueued' | 'status'>

export interface Job {
  id: number;
  runId: number | null;
  type: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export type NewJob = Pick<Job, 'runId' | 'type' | 'status'>

// --- Agent usage ---

export interface AgentUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Persisted alongside summary/profile/score rows. The summarizer also writes `mode`.
export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  mode?: string;
}

// --- Summaries ---

export interface SummaryVersion {
  id: number;
  paperId: number;
  description: string;
  summary: string;
  model: string;
  promptVersion: string;
  usageJson: UsageRecord | null;
  jobId: number | null;
  createdAt: string;
}

// --- Profile ---

export interface ProfileVersion {
  id: number;
  profileSummary: string | null;
  interests: ProfileEntry[] | null;
  dismissalPatterns: ProfileEntry[] | null;
  categoryPreferences: ProfileEntry[] | null;
  authorAffinity: ProfileEntry[] | null;
  dismissedPaperIds: number[] | null;
  keptPaperIds: number[] | null;
  model: string | null;
  paperCount: number | null;
  usageJson: UsageRecord | null;
  createdAt: string;
}

export interface ProfileEntry {
  content: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceNote: string;
}

// --- Scores ---

export interface Score {
  id: number;
  paperId: number;
  profileVersionId: number;
  score: number;          // 0.0 - 1.0
  reasoning: string | null;
  model: string | null;
  usageJson: UsageRecord | null;
  scoredAt: string;
}


// --- Agent Types ---

// Sandbox info for tools that read paper source files.
// `arxivId` identifies the paper directory inside StorageService basePath;
// tools resolve relative paths against this and reject any escape attempts.
export interface AgentFileContext {
  arxivId: string;
}

export type SummarizeMode = 'single_tex' | 'directory' | 'abstract_only';

export interface SummaryResult {
  description: string;
  summary: string;
}

export interface ScoreResult {
  score: number;
  reasoning: string;
}

export interface ProfileResult {
  profileSummary: string;
  interests: ProfileEntry[];
  dismissalPatterns: ProfileEntry[];
  categoryPreferences: ProfileEntry[];
  authorAffinity: ProfileEntry[];
}

export interface CategoryStat {
  category: string;
  total: number;
  dismissed: number;
  kept: number;
  dismissRate: number;
}

export interface NewSummaryVersion {
  paperId: number;
  description: string;
  summary: string;
  model: string;
  promptVersion: string;
  usageJson: UsageRecord | null;
  jobId: number | null;
}

export interface NewProfileVersion {
  profileSummary: string;
  interests: ProfileEntry[];
  dismissalPatterns: ProfileEntry[];
  categoryPreferences: ProfileEntry[];
  authorAffinity: ProfileEntry[];
  dismissedPaperIds: number[];
  keptPaperIds: number[];
  model: string;
  paperCount: number;
  usageJson: UsageRecord | null;
}

export interface NewScore {
  paperId: number;
  profileVersionId: number;
  score: number;
  reasoning: string | null;
  model: string;
  usageJson: UsageRecord | null;
}

export interface LabeledPaper {
  paperId: number;
  arxivId: string;
  title: string;
  primaryCategory: string;
  published: string | null;
  label: 'dismissed' | 'liked';
}
