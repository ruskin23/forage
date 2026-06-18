import { tool, RunContext } from '@openai/agents';
import { z } from 'zod';
import { ProfileRunContext } from '../shared/runContexts';

export const getCategoryStatsTool = tool({
  name: 'get_category_stats',
  description: 'Get quantitative dismiss/keep ratios per arXiv primary category across all labeled papers.',
  parameters: z.object({}),
  async execute(_input, runContext) {
    const ctx = runContext as RunContext<ProfileRunContext>;
    ctx.context.signal.throwIfAborted();

    const stats = await ctx.context.fetchCategoryStats();
    return {
      stats: stats.map((s) => ({
        category: s.category,
        total: s.total,
        dismissed: s.dismissed,
        kept: s.kept,
        dismiss_rate: s.dismissRate,
      })),
    };
  },
});
