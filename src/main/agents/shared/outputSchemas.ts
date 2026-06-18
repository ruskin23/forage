import { z } from 'zod';

// Summarizer output. Loose markdown body + a one-line description.
export const SummaryOutputSchema = z.object({
  description: z.string().describe('1-2 sentence summary of the paper\'s main contribution.'),
  summary: z.string().describe('Detailed markdown summary covering motivation, methods, results, significance.'),
});
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

const ProfileEntrySchema = z.object({
  content: z.string().describe('A specific observation or pattern.'),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence_note: z.string().describe('Brief note on what observations support this entry.'),
});

export const ProfileOutputSchema = z.object({
  profile_summary: z.string().describe('Concise paragraph describing overall research interests and reading patterns.'),
  interests: z.array(ProfileEntrySchema).describe('Topics, methods, or themes the user is drawn to.'),
  dismissal_patterns: z.array(ProfileEntrySchema).describe('Types of papers the user consistently dismisses.'),
  category_preferences: z.array(ProfileEntrySchema).describe('How the user relates to different arXiv categories.'),
  author_affinity: z.array(ProfileEntrySchema).describe('Patterns related to specific authors or research groups.'),
});
export type ProfileOutput = z.infer<typeof ProfileOutputSchema>;

export const ScoreOutputSchema = z.object({
  score: z.number().min(0).max(1).describe('Relevance score between 0.0 and 1.0.'),
  reasoning: z.string().describe('1-2 sentence explanation of the score.'),
});
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;
