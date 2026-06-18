import { ProfileVersion, LabeledPaper } from '@shared/types';

export interface BuildProfileSystemPromptArgs {
  profileCount: number;
  previousProfile: ProfileVersion | null;
}

export function buildProfileSystemPrompt(args: BuildProfileSystemPromptArgs): string {
  const calibrationNote = (() => {
    if (args.profileCount === 0) {
      return 'This is the user\'s first profile. Be conservative — prefer "low" and "medium" confidence levels and clearly mark tentative observations.';
    }
    if (args.profileCount <= 4) {
      return 'This is an early profile. Use moderate confidence where patterns are clear, but stay cautious.';
    }
    return 'The user has an established history. Use full confidence for well-supported patterns.';
  })();

  const incrementalNote = args.previousProfile
    ? `A previous profile is provided below. Build on it incrementally — confirm existing patterns, revise contradictions, add new patterns. Don't discard prior work without evidence.`
    : 'No previous profile exists. This will be the first.';

  return `You are a research preference analyst. Your task is to analyze a user's interactions with scientific papers (which they dismissed vs. kept) and build a preference profile.

Your analysis should cover:

1. **Profile Summary**: A concise paragraph describing the user's overall research interests and reading patterns.

2. **Interests**: What topics, methods, or research themes the user is drawn to. Each entry should describe a specific interest with evidence from their paper interactions.

3. **Dismissal Patterns**: What types of papers the user consistently dismisses. Look for patterns in topics, categories, or paper characteristics they avoid.

4. **Category Preferences**: How the user relates to different arXiv categories.

5. **Author Affinity**: Any patterns related to specific authors or research groups.

For each entry, assign a confidence level: high / medium / low.

Workflow (be efficient — you have a limited budget):
- The user prompt already lists every labeled paper with arxiv_id, title, category, and label. Often that is enough.
- You MAY call get_category_stats AT MOST ONCE to see dismiss/keep ratios.
- You MAY call get_paper_details for AT MOST 2-3 papers when titles alone don't tell you what's going on.
- After that, return the final structured profile object. DO NOT keep gathering data.

${calibrationNote}
${incrementalNote}

Return your final structured profile as soon as you have enough signal — even if you would prefer more data, finishing matters.`;
}

export function buildProfileUserPrompt(papers: LabeledPaper[], previousProfile: ProfileVersion | null): string {
  const dismissed = papers.filter((p) => p.label === 'dismissed').length;
  const kept = papers.filter((p) => p.label === 'liked').length;

  const tableRows = papers.map((p) =>
    `${p.arxivId} | ${p.title} | ${p.primaryCategory} | ${p.published ?? ''} | ${p.label}`
  ).join('\n');

  const sections = [
    `Analyze the following ${papers.length} papers (${dismissed} dismissed, ${kept} kept):`,
    '',
    'arxiv_id | title | category | date | label',
    tableRows,
  ];

  if (previousProfile) {
    sections.push(
      '',
      '---',
      '',
      'Previous profile (build on this incrementally):',
      JSON.stringify({
        profile_summary: previousProfile.profileSummary,
        interests: previousProfile.interests,
        dismissal_patterns: previousProfile.dismissalPatterns,
        category_preferences: previousProfile.categoryPreferences,
        author_affinity: previousProfile.authorAffinity,
      }, null, 2),
    );
  }

  return sections.join('\n');
}
