import { tool, RunContext } from '@openai/agents';
import { z } from 'zod';
import { ProfileRunContext } from '../shared/runContexts';

export const getPaperDetailsTool = tool({
  name: 'get_paper_details',
  description: 'Get full paper details including abstract and authors for a single paper by arxiv_id. Use selectively when investigating interesting cases — do NOT call for every paper.',
  parameters: z.object({
    arxiv_id: z.string().describe('arXiv ID (e.g. "2501.12345").'),
  }),
  async execute({ arxiv_id }, runContext) {
    const ctx = runContext as RunContext<ProfileRunContext>;
    ctx.context.signal.throwIfAborted();

    const paper = await ctx.context.fetchPaperDetails(arxiv_id);
    if (!paper) return { error: `Paper not found: ${arxiv_id}` };

    return {
      arxiv_id: paper.arxivId,
      title: paper.title,
      authors: paper.authors,
      categories: paper.categories,
      primary_category: paper.primaryCategory,
      published: paper.published,
      abstract: paper.abstract,
    };
  },
});
