import { PaperStatus, PipelineRun, Job } from "@shared/types";

export interface StepProgress {
  success: number;
  failed: number;
  total: number;
}

export interface PaperStatusPayload {
  paperStatus: PaperStatus;
  stepProgress: StepProgress;
}

export interface RunUpdatePayload {
  run: PipelineRun;
}

export interface JobUpdatePayload {
  job: Job;
}
