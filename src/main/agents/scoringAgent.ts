import { Agent, run } from '@openai/agents';
import { Sql } from '../db';
import { SCORING_SYSTEM_PROMPT, buildScoreUserPrompt } from './prompts/scoring';
import { ScoreOutputSchema } from './shared/outputSchemas';
import { ScoreRunContext } from './shared/runContexts';
import { captureUsage } from './shared/usage';
import { getModelForAgent } from './shared/config';
import {
  Paper,
  ProfileVersion,
  SummaryVersion,
  ScoreResult,
  AgentUsage,
} from '@shared/types';

export interface ScorerInput {
  paper: Paper;
  summary: SummaryVersion | null;
  profile: ProfileVersion;
}

export interface ScorerOutput extends ScoreResult {
  usage: AgentUsage;
}

export async function runScore(
  sql: Sql,
  input: ScorerInput,
  signal: AbortSignal,
): Promise<ScorerOutput> {
  const model = await getModelForAgent(sql, 'score');

  const agent = new Agent({
    name: 'Scorer',
    instructions: SCORING_SYSTEM_PROMPT,
    model,
    outputType: ScoreOutputSchema,
  });

  const userPrompt = buildScoreUserPrompt({
    profile: input.profile,
    paper: input.paper,
    summary: input.summary,
  });

  const context: ScoreRunContext = {};

  const result = await run(agent, userPrompt, { context, signal, maxTurns: 3 });
  if (!result.finalOutput) throw new Error('Scorer finished without a final output.');

  return {
    score: clamp01(result.finalOutput.score),
    reasoning: result.finalOutput.reasoning,
    usage: captureUsage(model, result.state.usage),
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
