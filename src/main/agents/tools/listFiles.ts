import { tool, RunContext } from '@openai/agents';
import { z } from 'zod';
import fs from 'node:fs';
import { SummaryRunContext } from '../shared/runContexts';
import { resolvePaperRoot, safeJoin } from '../shared/storageSandbox';

export const listFilesTool = tool({
  name: 'list_files',
  description: 'List files and subdirectories at a path inside the paper source directory. Use "." for the root.',
  parameters: z.object({
    path: z.string().describe('Relative path within the paper source directory. Use "." for root.'),
  }),
  async execute({ path: relPath }, runContext) {
    const ctx = runContext as RunContext<SummaryRunContext>;
    ctx.context.signal.throwIfAborted();

    const root = resolvePaperRoot(ctx.context.fileContext.arxivId);
    const target = safeJoin(root, relPath);

    if (!fs.existsSync(target)) {
      return { error: `Path not found: ${relPath}` };
    }

    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return { error: `Not a directory: ${relPath}. Use read_file to read its contents.` };
    }

    const entries = fs.readdirSync(target, { withFileTypes: true });
    return {
      path: relPath,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ('dir' as const) : ('file' as const),
      })),
    };
  },
});
