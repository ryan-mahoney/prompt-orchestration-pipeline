/** Result of a successful job submission. */
export interface SubmitSuccessResult {
  success: true;
  jobId: string;
  jobName: string;
}

/** Result of a failed job submission. */
export interface SubmitFailureResult {
  success: false;
  message: string;
}

export type SubmitResult = SubmitSuccessResult | SubmitFailureResult;

/** Options for submitJobWithValidation. */
export interface SubmitJobOptions {
  dataDir: string;
  seedObject: unknown;
}

/** Job status record returned by getStatus. */
export interface JobStatusRecord {
  jobId: string;
  jobName: string;
  pipeline: string;
  state: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Orchestrator construction options. */
export interface OrchestratorOptions {
  autoStart: boolean;
}

/**
 * Validates and submits a job to the pipeline data directory.
 * Stub implementation — to be replaced when api module is fully migrated.
 */
export async function submitJobWithValidation(
  _opts: SubmitJobOptions
): Promise<SubmitResult> {
  throw new Error("submitJobWithValidation: not yet implemented");
}

/**
 * Pipeline orchestrator class for status/job management.
 * Stub implementation — to be replaced when api module is fully migrated.
 */
export class PipelineOrchestrator {
  constructor(_opts: OrchestratorOptions) {}

  async getStatus(_jobName: string): Promise<JobStatusRecord> {
    throw new Error("PipelineOrchestrator.getStatus: not yet implemented");
  }

  async listJobs(): Promise<JobStatusRecord[]> {
    throw new Error("PipelineOrchestrator.listJobs: not yet implemented");
  }
}
