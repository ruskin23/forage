import { tool, RunContext } from '@openai/agents';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { SummaryRunContext } from '../shared/runContexts';
import { resolvePaperRoot, safeJoin } from '../shared/storageSandbox';

const READABLE_EXTENSIONS = new Set([
  '.tex', '.txt', '.bib', '.bbl', '.cls', '.sty', '.md', '.bst',
]);
const MAX_CHARS = 50_000;

export const readFileTool = tool({
  name: 'read_file',
  description: 'Read a text file from the paper source directory. Supports .tex, .txt, .bib, .bbl, .cls, .sty, .md, .bst. Truncates at 50,000 chars.',
  parameters: z.object({
    path: z.string().describe('Relative path within the paper source directory.'),
  }),
  async execute({ path: relPath }, runContext) {
    const ctx = runContext as RunContext<SummaryRunContext>;
    ctx.context.signal.throwIfAborted();

    const root = resolvePaperRoot(ctx.context.fileContext.arxivId);
    const target = safeJoin(root, relPath);

    if (!fs.existsSync(target)) {
      return { error: `File not found: ${relPath}` };
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      return { error: `Path is a directory, not a file: ${relPath}. Use list_files instead.` };
    }

    const ext = path.extname(target).toLowerCase();
    if (!READABLE_EXTENSIONS.has(ext)) {
      return { error: `Unsupported file type: ${ext}. Only text files are readable.` };
    }

    const content = fs.readFileSync(target, 'utf-8');
    const truncated = content.length > MAX_CHARS;
    return {
      path: relPath,
      content: truncated ? content.slice(0, MAX_CHARS) : content,
      truncated,
      total_chars: content.length,
    };
  },
});
