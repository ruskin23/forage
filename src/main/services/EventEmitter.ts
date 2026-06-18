import { BrowserWindow } from "electron";
import { PaperStatus, PipelineRun, Job } from "@shared/types";
import { PaperStatusPayload, StepProgress, RunUpdatePayload, JobUpdatePayload } from "@shared/eventTypes";


export class EventEmitter {
  constructor(private win: BrowserWindow) { }

  paperStatus(paperStatus: PaperStatus, stepProgress: StepProgress) {
    const payload: PaperStatusPayload = { paperStatus, stepProgress };
    this.win.webContents.send('paper:status', payload);
  }

  runUpdate(run: PipelineRun) {
    const payload: RunUpdatePayload = { run };
    this.win.webContents.send('run:update', payload);
  }

  jobUpdate(job: Job) {
    const payload: JobUpdatePayload = { job };
    this.win.webContents.send('job:update', payload);
  }
}
