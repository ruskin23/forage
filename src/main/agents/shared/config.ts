import OpenAI from 'openai';
import {
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from '@openai/agents';
import { Sql } from '../../db';
import { getSetting } from '../../db/queries/settings';

// Model setting keys per the agents skill conventions.
export const MODEL_KEYS = {
  summary: 'model.summary',
  profile: 'model.profile',
  score: 'model.score',
} as const;

export type AgentName = keyof typeof MODEL_KEYS;

// Cheap, proven defaults via OpenRouter. All three support tools + structured output.
const DEFAULT_MODELS: Record<AgentName, string> = {
  summary: 'openai/gpt-4o-mini',
  profile: 'openai/gpt-4o-mini',
  score: 'openai/gpt-4o-mini',
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let initialized = false;

export function initOpenRouter(): void {
  if (initialized) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to .env in the project root.');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/ruskin/forage',
      'X-Title': 'Forage',
    },
  });

  setDefaultOpenAIClient(client);
  // OpenRouter speaks the chat completions API, not the OpenAI Responses API.
  setOpenAIAPI('chat_completions');
  // Tracing posts to OpenAI's tracing endpoint with an OpenAI key — disable it
  // since we're routing through OpenRouter and have no tracing key.
  setTracingDisabled(true);

  initialized = true;
}

// Resolve the model for a given agent: settings override, otherwise env override,
// otherwise the cheap default. Read at call time per skill conventions.
export async function getModelForAgent(sql: Sql, agent: AgentName): Promise<string> {
  const fromSettings = await getSetting(sql, MODEL_KEYS[agent]);
  if (fromSettings) return fromSettings;

  const envKey = `OPENROUTER_MODEL_${agent.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;

  return DEFAULT_MODELS[agent];
}
