import { Agent, run } from '@openai/agents';
import path from 'node:path';
import fs from 'node:fs';
import { Sql } from '../db';
import {
  SUMMARY_SYSTEM_PROMPT_WITH_FILES,
  SUMMARY_SYSTEM_PROMPT_ABSTRACT_ONLY,
  buildSummaryUserPrompt,
} from './prompts/summary';
import { listFilesTool } from './tools/listFiles';
import { readFileTool } from './tools/readFile';
import { SummaryOutputSchema } from './shared/outputSchemas';
import { SummaryRunContext } from './shared/runContexts';
import { captureUsage } from './shared/usage';
import { getModelForAgent } from './shared/config';
import { Paper, AgentFileContext, SummaryResult, AgentUsage, SummarizeMode } from '@shared/types';
import { SourceType } from '@shared/enums';

// Threshold for single-file embedding. Larger papers go to directory mode.
const EMBED_BYTE_LIMIT = 40_000;

export interface SummarizerInput {
  paper: Paper;
  fileContext: AgentFileContext;
  sourceType: SourceType | null;
  paperRoot: string;
}

export interface SummarizerOutput extends SummaryResult {
  mode: SummarizeMode;
  usage: AgentUsage;
}

export async function runSummary(
  sql: Sql,
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerOutput> {
  const mode = chooseMode(input);
  const model = await getModelForAgent(sql, 'summary');
  const authors = input.paper.authors;
  const context: SummaryRunContext = {
    paperId: input.paper.id,
    fileContext: input.fileContext,
    signal,
  };

  if (mode === 'abstract_only') {
    const agent = new Agent({
      name: 'Summarizer',
      instructions: SUMMARY_SYSTEM_PROMPT_ABSTRACT_ONLY,
      model,
      outputType: SummaryOutputSchema,
    });

    const userPrompt = buildSummaryUserPrompt({
      title: input.paper.title,
      authors,
      primaryCategory: input.paper.primaryCategory,
      abstract: input.paper.abstract,
    });

    const result = await run(agent, userPrompt, { context, signal, maxTurns: 3 });
    if (!result.finalOutput) throw new Error('Summarizer finished without a final output.');
    return { ...result.finalOutput, mode, usage: captureUsage(model, result.state.usage) };
  }

  if (mode === 'single_tex') {
    const texPath = findSingleTex(input.paperRoot);
    const embeddedTex = texPath ? fs.readFileSync(texPath, 'utf-8') : '';

    const agent = new Agent({
      name: 'Summarizer',
      instructions: SUMMARY_SYSTEM_PROMPT_ABSTRACT_ONLY,
      model,
      outputType: SummaryOutputSchema,
    });

    const userPrompt = buildSummaryUserPrompt({
      title: input.paper.title,
      authors,
      primaryCategory: input.paper.primaryCategory,
      abstract: input.paper.abstract,
      embeddedTex,
    });

    const result = await run(agent, userPrompt, { context, signal, maxTurns: 3 });
    if (!result.finalOutput) throw new Error('Summarizer finished without a final output.');
    return { ...result.finalOutput, mode, usage: captureUsage(model, result.state.usage) };
  }

  // directory mode — agent uses list_files / read_file to navigate the source tree.
  const agent = new Agent({
    name: 'Summarizer',
    instructions: SUMMARY_SYSTEM_PROMPT_WITH_FILES,
    model,
    tools: [listFilesTool, readFileTool],
    outputType: SummaryOutputSchema,
  });

  const userPrompt = buildSummaryUserPrompt({
    title: input.paper.title,
    authors,
    primaryCategory: input.paper.primaryCategory,
    abstract: input.paper.abstract,
  });

  try {
    const result = await run(agent, userPrompt, { context, signal, maxTurns: 12 });
    if (!result.finalOutput) throw new Error('Summarizer finished without a final output.');
    return { ...result.finalOutput, mode, usage: captureUsage(model, result.state.usage) };
  } catch (err) {
    // Don't swallow user-driven cancellation.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;

    // Directory mode failed (max turns, provider error, etc.). Fall back to
    // abstract-only so the user still gets a usable summary. The cost is one
    // extra small call, which is cheap enough to be worth it.
    const fallbackAgent = new Agent({
      name: 'Summarizer',
      instructions: SUMMARY_SYSTEM_PROMPT_ABSTRACT_ONLY,
      model,
      outputType: SummaryOutputSchema,
    });

    const fallback = await run(fallbackAgent, userPrompt, { context, signal, maxTurns: 3 });
    if (!fallback.finalOutput) {
      const original = err instanceof Error ? err.message : String(err);
      throw new Error(`Directory mode failed (${original}) and abstract fallback also returned no output.`);
    }
    return {
      ...fallback.finalOutput,
      mode: 'abstract_only',
      usage: captureUsage(model, fallback.state.usage),
    };
  }
}

function chooseMode(input: SummarizerInput): SummarizeMode {
  if (!input.sourceType) return 'abstract_only';
  if (input.sourceType === 'PDF') return 'abstract_only';
  if (!fs.existsSync(input.paperRoot)) return 'abstract_only';

  const texFiles = listTexFiles(input.paperRoot);
  if (texFiles.length === 0) return 'abstract_only';

  if (texFiles.length === 1) {
    const stat = fs.statSync(texFiles[0]);
    if (stat.size <= EMBED_BYTE_LIMIT) return 'single_tex';
  }

  return 'directory';
}

function listTexFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) out.push(full);
    }
  }
  walk(root);
  return out;
}

function findSingleTex(root: string): string | null {
  const tex = listTexFiles(root);
  return tex.length === 1 ? tex[0] : null;
}
