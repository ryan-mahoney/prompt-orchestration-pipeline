import type {
  AggregationStats,
  APIJob,
  CanonicalJob,
  CostsSummary,
  FilterOptions,
  GroupedJobs,
  JobListStats,
  TransformOptions,
} from "../types";

const STATUS_PRIORITY: Record<string, number> = {
  running: 4,
  error: 3,
  pending: 2,
  complete: 1,
};

const ZERO_COSTS: CostsSummary = {
  totalTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCost: 0,
  totalInputCost: 0,
  totalOutputCost: 0,
};

function isValidJob(job: CanonicalJob): boolean {
  return Boolean(job.id && job.status && job.createdAt);
}

function getJobKey(job: CanonicalJob): string {
  return job.jobId || job.id;
}

function getCostsSummary(costs: Record<string, unknown>): CostsSummary {
  return {
    totalTokens: typeof costs["totalTokens"] === "number" ? costs["totalTokens"] : 0,
    totalInputTokens: typeof costs["totalInputTokens"] === "number" ? costs["totalInputTokens"] : 0,
    totalOutputTokens: typeof costs["totalOutputTokens"] === "number" ? costs["totalOutputTokens"] : 0,
    totalCost: typeof costs["totalCost"] === "number" ? costs["totalCost"] : 0,
    totalInputCost: typeof costs["totalInputCost"] === "number" ? costs["totalInputCost"] : 0,
    totalOutputCost: typeof costs["totalOutputCost"] === "number" ? costs["totalOutputCost"] : 0,
  };
}

export function getStatusPriority(status: string): number {
  return STATUS_PRIORITY[status] ?? 0;
}

export function sortJobs(jobs: CanonicalJob[]): CanonicalJob[] {
  return jobs
    .filter(isValidJob)
    .slice()
    .sort((left, right) => {
      const priority = getStatusPriority(right.status) - getStatusPriority(left.status);
      if (priority !== 0) return priority;
      const created = left.createdAt!.localeCompare(right.createdAt!);
      if (created !== 0) return created;
      return left.id.localeCompare(right.id);
    });
}

export function aggregateAndSortJobs(
  currentJobs: CanonicalJob[],
  completeJobs: CanonicalJob[],
): CanonicalJob[] {
  try {
    const jobs = new Map<string, CanonicalJob>();

    for (const job of completeJobs) jobs.set(getJobKey(job), job);
    for (const job of currentJobs) jobs.set(getJobKey(job), job);

    return sortJobs([...jobs.values()]);
  } catch {
    return [];
  }
}

export function groupJobsByStatus(jobs: CanonicalJob[]): GroupedJobs {
  const grouped: GroupedJobs = {
    running: [],
    error: [],
    pending: [],
    complete: [],
  };

  for (const job of jobs) {
    if (job.status in grouped) {
      grouped[job.status as keyof GroupedJobs].push(job);
    }
  }

  return grouped;
}

export function getJobListStats(jobs: CanonicalJob[] = []): JobListStats {
  const byStatus: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  let progress = 0;

  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    if (job.location) byLocation[job.location] = (byLocation[job.location] ?? 0) + 1;
    progress += job.progress;
  }

  return {
    total: jobs.length,
    byStatus,
    byLocation,
    averageProgress: jobs.length === 0 ? 0 : Math.floor(progress / jobs.length),
  };
}

export function filterJobs(
  jobs: CanonicalJob[],
  searchTerm = "",
  options: FilterOptions = {},
): CanonicalJob[] {
  const query = searchTerm.toLowerCase();
  return jobs.filter((job) => {
    if (options.status && job.status !== options.status) return false;
    if (options.location && job.location !== options.location) return false;
    if (query === "") return true;

    return job.title.toLowerCase().includes(query) || job.id.toLowerCase().includes(query);
  });
}

export function transformJobListForAPI(
  jobs: CanonicalJob[] = [],
  options: TransformOptions = {},
): APIJob[] {
  return jobs.map((job) => {
    const apiJob: APIJob = {
      jobId: job.jobId,
      title: job.title,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      location: job.location,
      tasks: job.tasks,
      files: job.files,
      current: job.current,
      currentStage: job.currentStage,
      costsSummary: getCostsSummary(job.costs),
    };

    if (options.includePipelineMetadata) {
      apiJob.pipeline = job.pipeline;
      apiJob.pipelineSlug = job.pipeline;
      apiJob.pipelineLabel = job.pipelineLabel;
      apiJob.pipelineConfig = job.pipelineConfig;
    }

    return apiJob;
  });
}

export function getAggregationStats(
  currentJobs: CanonicalJob[] = [],
  completeJobs: CanonicalJob[] = [],
  aggregatedJobs: CanonicalJob[] = [],
): AggregationStats {
  const totalInput = currentJobs.length + completeJobs.length;
  const duplicates = totalInput - aggregatedJobs.length;
  const statusDistribution: Record<string, number> = {};
  const locationDistribution: Record<string, number> = {};

  for (const job of aggregatedJobs) {
    statusDistribution[job.status] = (statusDistribution[job.status] ?? 0) + 1;
    if (job.location) {
      locationDistribution[job.location] = (locationDistribution[job.location] ?? 0) + 1;
    }
  }

  return {
    totalInput,
    totalOutput: aggregatedJobs.length,
    duplicates,
    efficiency: totalInput === 0 ? 0 : aggregatedJobs.length / totalInput,
    statusDistribution,
    locationDistribution,
  };
}
