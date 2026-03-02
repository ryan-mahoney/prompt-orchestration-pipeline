export type ApiErrorCode =
  | "job_running"
  | "job_not_found"
  | "conflict"
  | "spawn_failed"
  | "unknown_error"
  | "network_error"
  | "dependencies_not_satisfied"
  | "unsupported_lifecycle"
  | "task_not_found"
  | "task_not_pending";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  status?: number;
}

export interface ApiOkResponse {
  ok: true;
  message?: string;
}

export interface RestartJobOptions {
  fromTask?: string;
  singleTask?: boolean;
  continueAfter?: boolean;
  options?: {
    clearTokenUsage?: boolean;
    [key: string]: unknown;
  };
}

export type SseEventType =
  | "state"
  | "job:updated"
  | "job:created"
  | "job:removed"
  | "heartbeat"
  | "message"
  | "status:changed"
  | "seed:uploaded"
  | "state:change"
  | "state:summary"
  | "task:updated";

export interface BootstrapOptions {
  stateUrl?: string;
  sseUrl?: string;
  applySnapshot?: (snapshot: unknown) => void | Promise<void>;
  onSseEvent?: (type: string, data: unknown) => void;
}

export interface SseFetchHandle {
  cancel: () => void;
}

export type SseEventCallback = (eventName: string, parsedData: unknown) => void;
export type SseErrorCallback = (errorData: unknown) => void;

export interface ParsedSseEvent {
  type: string;
  data: unknown;
}

export type TimeStoreListener = () => void;
export type TimeStoreUnsubscribe = () => void;

export type ConnectionStatus = "connected" | "disconnected" | "error";

export interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

export interface TaskFiles {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

export interface NormalizedTask {
  name: string;
  state: string;
  startedAt: string | null;
  endedAt: string | null;
  attempts?: number;
  executionTimeMs?: number;
  currentStage?: string;
  failedStage?: string;
  files: TaskFiles;
  artifacts?: string[];
  tokenUsage?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface CurrentTaskInfo {
  taskName: string;
  stage?: string;
}

export interface NormalizedJobSummary {
  id: string;
  jobId: string;
  name: string;
  status: string;
  progress: number;
  taskCount: number;
  doneCount: number;
  location: string;
  tasks: Record<string, NormalizedTask>;
  current?: CurrentTaskInfo | null;
  currentStage?: string;
  createdAt?: string;
  updatedAt?: string;
  pipeline?: string;
  pipelineLabel?: string;
  pipelineConfig?: Record<string, unknown>;
  costsSummary?: CostsSummary;
  totalCost?: number;
  totalTokens?: number;
  displayCategory: string;
  __warnings?: string[];
}

export interface TaskCostBreakdown {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface NormalizedJobDetail extends NormalizedJobSummary {
  costs?: Record<string, TaskCostBreakdown>;
}

export interface UseJobListResult {
  loading: boolean;
  data: NormalizedJobSummary[] | null;
  error: ApiError | null;
  refetch: () => void;
}

export interface UseJobListWithUpdatesResult extends UseJobListResult {
  connectionStatus: ConnectionStatus;
}

export interface UseJobDetailWithUpdatesResult {
  data: NormalizedJobDetail | null;
  loading: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  isRefreshing: boolean;
  isTransitioning: boolean;
  isHydrated: boolean;
}

export type AnalysisStatus = "idle" | "connecting" | "running" | "complete" | "error";

export interface AnalysisProgressState {
  status: AnalysisStatus;
  pipelineSlug: string | null;
  totalTasks: number;
  completedTasks: number;
  totalArtifacts: number;
  completedArtifacts: number;
  currentTask: string | null;
  currentArtifact: string | null;
  error: string | null;
}

export interface UseAnalysisProgressResult extends AnalysisProgressState {
  startAnalysis: (pipelineSlug: string) => void;
  reset: () => void;
}

export interface AllowedActions {
  start: boolean;
  restart: boolean;
}

export interface SseJobEvent {
  type: SseEventType;
  data: Record<string, unknown>;
}

export type AnalysisSseEventType =
  | "started"
  | "task:start"
  | "artifact:start"
  | "artifact:complete"
  | "task:complete"
  | "complete"
  | "error";
