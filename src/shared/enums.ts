export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type PipelineStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type JobType = 'fetch' | 'download' | 'summarize' | 'profile' | 'score';
export type PipelineSteps = 'fetch' | 'download' | 'summarize' | 'profile' | 'score';
export type PaperInteraction = 'dismissed' | 'liked' | 'read' | 'unread';

export type PipelineTrigger = 'scheduled' | 'manual';

export type SourceType = 'PDF' | 'TEX' | 'TAR';
