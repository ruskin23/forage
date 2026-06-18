import { Usage } from '@openai/agents';
import { AgentUsage } from '@shared/types';

// Pull the run's aggregated usage off the SDK's internal `Usage` shape and
// stamp it with the model name. Per-agent run sites all need this.
export function captureUsage(model: string, usage: Usage): AgentUsage {
  return {
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
