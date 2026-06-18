import { ProfileVersion, Paper, SummaryVersion } from '@shared/types';

export const SCORING_SYSTEM_PROMPT = `You are a scientific paper relevance scorer. Given a user's preference profile and a paper's metadata, assign a relevance score between 0.0 and 1.0.

Score guidelines:
- **0.8-1.0**: Highly relevant — directly matches core interests.
- **0.6-0.8**: Relevant — overlaps with interests but not a perfect match.
- **0.4-0.6**: Borderline — some relevance but touches on dismissed patterns.
- **0.2-0.4**: Low relevance — mostly outside interests.
- **0.0-0.2**: Not relevant — matches dismissal patterns.

Consider all aspects of the profile: interests, dismissal patterns, category preferences, and author affinity. Weight high-confidence entries more heavily.

Provide a brief reasoning (1-2 sentences) explaining the score.

Return your final answer as the structured score object.`;

export interface BuildScoreUserPromptArgs {
  profile: ProfileVersion;
  paper: Paper;
  summary: SummaryVersion | null;
}

export function buildScoreUserPrompt(args: BuildScoreUserPromptArgs): string {
  const profileJson = JSON.stringify({
    profile_summary: args.profile.profileSummary,
    interests: args.profile.interests,
    dismissal_patterns: args.profile.dismissalPatterns,
    category_preferences: args.profile.categoryPreferences,
    author_affinity: args.profile.authorAffinity,
  }, null, 2);

  const lines = [
    '## User Profile',
    profileJson,
    '',
    '## Paper',
    `Title: ${args.paper.title}`,
    `Authors: ${args.paper.authors.join(', ')}`,
    `Categories: ${args.paper.categories.join(', ')}`,
    `Primary Category: ${args.paper.primaryCategory}`,
    `Abstract: ${args.paper.abstract ?? '(not available)'}`,
  ];

  if (args.summary) {
    lines.push(`Description: ${args.summary.description}`);
  }

  return lines.join('\n');
}
