import { Agent, run } from '@openai/agents';
import { Sql } from '../db';
import {
  buildProfileSystemPrompt,
  buildProfileUserPrompt,
} from './prompts/profileBuilder';
import { getPaperDetailsTool } from './tools/getPaperDetails';
import { getCategoryStatsTool } from './tools/getCategoryStats';
import { ProfileOutputSchema } from './shared/outputSchemas';
import { ProfileRunContext } from './shared/runContexts';
import { captureUsage } from './shared/usage';
import { getModelForAgent } from './shared/config';
import {
  ProfileResult,
  AgentUsage,
  LabeledPaper,
  ProfileVersion,
  CategoryStat,
  Paper,
  ProfileEntry,
} from '@shared/types';

export interface ProfilerInput {
  papers: LabeledPaper[];
  previousProfile: ProfileVersion | null;
  profileCount: number;
  fetchPaperDetails: (arxivId: string) => Promise<Paper | null>;
  fetchCategoryStats: () => Promise<CategoryStat[]>;
}

export interface ProfilerOutput extends ProfileResult {
  usage: AgentUsage;
}

export async function runProfile(
  sql: Sql,
  input: ProfilerInput,
  signal: AbortSignal,
): Promise<ProfilerOutput> {
  const model = await getModelForAgent(sql, 'profile');
  const instructions = buildProfileSystemPrompt({
    profileCount: input.profileCount,
    previousProfile: input.previousProfile,
  });

  const agent = new Agent({
    name: 'ProfileBuilder',
    instructions,
    model,
    tools: [getPaperDetailsTool, getCategoryStatsTool],
    outputType: ProfileOutputSchema,
  });

  const userPrompt = buildProfileUserPrompt(input.papers, input.previousProfile);
  const context: ProfileRunContext = {
    fetchPaperDetails: input.fetchPaperDetails,
    fetchCategoryStats: input.fetchCategoryStats,
    signal,
  };

  try {
    const result = await run(agent, userPrompt, { context, signal, maxTurns: 12 });
    if (!result.finalOutput) throw new Error('ProfileBuilder finished without a final output.');
    return toOutput(result.finalOutput, captureUsage(model, result.state.usage));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;

    // Tools loop is the most common failure mode — model keeps gathering. Fall
    // back to a tool-less run so we always produce a profile from the labels.
    const fallbackAgent = new Agent({
      name: 'ProfileBuilder',
      instructions,
      model,
      outputType: ProfileOutputSchema,
    });

    const fallback = await run(fallbackAgent, userPrompt, { context, signal, maxTurns: 3 });
    if (!fallback.finalOutput) {
      const original = err instanceof Error ? err.message : String(err);
      throw new Error(`Profile run failed (${original}) and no-tools fallback also returned no output.`);
    }
    return toOutput(fallback.finalOutput, captureUsage(model, fallback.state.usage));
  }
}

function toOutput(
  finalOutput: { profile_summary: string; interests: ProfileEntryRaw[]; dismissal_patterns: ProfileEntryRaw[]; category_preferences: ProfileEntryRaw[]; author_affinity: ProfileEntryRaw[] },
  usage: AgentUsage,
): ProfilerOutput {
  return {
    profileSummary: finalOutput.profile_summary,
    interests: finalOutput.interests.map(toCamel),
    dismissalPatterns: finalOutput.dismissal_patterns.map(toCamel),
    categoryPreferences: finalOutput.category_preferences.map(toCamel),
    authorAffinity: finalOutput.author_affinity.map(toCamel),
    usage,
  };
}

interface ProfileEntryRaw {
  content: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_note: string;
}

function toCamel(entry: ProfileEntryRaw): ProfileEntry {
  return {
    content: entry.content,
    confidence: entry.confidence,
    evidenceNote: entry.evidence_note,
  };
}
