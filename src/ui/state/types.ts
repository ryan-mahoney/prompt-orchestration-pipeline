export type ChangeType = "created" | "modified" | "deleted";

export interface ChangeEntry {
  path: string;
  type: ChangeType;
  timestamp: string;
}

export interface ChangeTrackerState {
  updatedAt: string;
  changeCount: number;
  recentChanges: ChangeEntry[];
  watchedPaths: string[];
}

export interface NormalizedJob {
  jobId: string | null;
  status: string | null;
  title: string | null;
  updatedAt: string | null;
}

export interface SnapshotJob {
  jobId: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string;
}

export interface SnapshotMeta {
  version: string;
  lastUpdated: string;
}

export interface StateSnapshot {
  jobs: NormalizedJob[];
  meta: SnapshotMeta;
}

export interface FilesystemSnapshot {
  jobs: SnapshotJob[];
  meta: SnapshotMeta;
}

export interface ComposeSnapshotOptions {
  jobs?: unknown[];
  meta?: unknown;
  transformJob?: (job: unknown) => NormalizedJob;
}

export interface SnapshotDeps {
  listAllJobs?: () => { current: string[]; complete: string[] } | Promise<{ current: string[]; complete: string[] }>;
  readJob?: (id: string, location: string) => Promise<JobReadResult>;
  transformMultipleJobs?: (results: JobReadResult[]) => CanonicalJob[];
  now?: () => Date;
  paths?: Record<string, string>;
}

export interface WatcherOptions {
  baseDir: string;
  debounceMs?: number;
}

export type WatcherOnChange = (changes: ChangeEntry[]) => void | Promise<void>;

export interface WatcherHandle {
  ready: Promise<void>;
  close: () => Promise<void>;
}

export type JobChangeCategory = "status" | "task" | "seed";
export type JobLocation = "current" | "complete" | "pending" | "rejected";

export interface JobChange {
  jobId: string;
  category: JobChangeCategory;
  filePath: string;
}

export interface LockState {
  pipelineSlug: string;
  startedAt: Date;
}

export type AcquireResult = { acquired: true } | { acquired: false; heldBy: string };

export interface ChatMessage {
  role: string;
  content: string;
}

export interface SchemaContext {
  fileName: string;
  schema: Record<string, unknown>;
  sample: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface SSEWriter {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

export interface SSEStreamResult {
  response: Response;
  writer: SSEWriter;
}

export interface ComputedStatus {
  status: string;
  progress: number;
}

export interface CanonicalTask {
  state: string;
  name: string;
  files: { artifacts: string[]; logs: string[]; tmp: string[] };
  startedAt?: string | null;
  endedAt?: string | null;
  attempts?: number;
  restartCount?: number;
  executionTimeMs?: number;
  refinementAttempts?: number;
  stageLogPath?: string;
  errorContext?: unknown;
  currentStage?: string;
  failedStage?: string;
  artifacts?: unknown;
  error?: { message: string; [key: string]: unknown } | null;
}

export interface CanonicalJob {
  id: string;
  jobId: string;
  name: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string | null;
  tasks: Record<string, CanonicalTask>;
  files: Record<string, unknown>;
  costs: Record<string, unknown>;
  pipeline?: string;
  pipelineLabel?: string;
  pipelineConfig?: Record<string, unknown>;
  current?: unknown;
  currentStage?: unknown;
  warnings?: string[];
}

export interface JobReadResult {
  ok: boolean;
  data?: unknown;
  jobId: string;
  location: string;
  code?: string;
  message?: string;
}

export interface TransformationStats {
  totalRead: number;
  successfulReads: number;
  successfulTransforms: number;
  failedTransforms: number;
  transformationRate: number;
  statusDistribution: Record<string, number>;
}

export interface JobListStats {
  total: number;
  byStatus: Record<string, number>;
  byLocation: Record<string, number>;
  averageProgress: number;
}

export interface GroupedJobs {
  running: CanonicalJob[];
  error: CanonicalJob[];
  pending: CanonicalJob[];
  complete: CanonicalJob[];
}

export interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

export interface APIJob {
  jobId: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string | null;
  updatedAt: string | null;
  location: string | null;
  tasks: Record<string, unknown>;
  files?: Record<string, unknown>;
  current?: unknown;
  currentStage?: unknown;
  costsSummary: CostsSummary;
  pipelineSlug?: string;
  pipeline?: string;
  pipelineLabel?: string;
  pipelineConfig?: Record<string, unknown>;
}

export interface AggregationStats {
  totalInput: number;
  totalOutput: number;
  duplicates: number;
  efficiency: number;
  statusDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
}

export interface FilterOptions {
  status?: string;
  location?: string;
}

export interface TransformOptions {
  includePipelineMetadata?: boolean;
}
