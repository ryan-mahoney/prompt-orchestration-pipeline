import type { ReactNode } from "react";

export type TaskState = "pending" | "running" | "done" | "failed";
export type DisplayCategory = "current" | "errors" | "complete";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface CostsSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalInputCost: number;
  totalOutputCost: number;
}

export interface TaskError {
  message: string;
  stack?: string;
}

export interface TaskFiles {
  artifacts: string[];
  logs: string[];
  tmp: string[];
}

export interface TaskStateObject {
  name: string;
  state: TaskState;
  stage?: string | null;
  startedAt?: string | number | null;
  endedAt?: string | number | null;
  config?: Record<string, unknown>;
  error?: TaskError | null;
  refinementAttempts?: number | null;
  currentStage?: string;
  failedStage?: string;
  files?: TaskFiles;
  artifacts?: string[];
  tokenUsage?: Record<string, unknown>;
  attempts?: number;
  restartCount?: number;
  executionTimeMs?: number;
}

export type TaskCollection = Record<string, TaskStateObject> | TaskStateObject[];

export interface JobSummary {
  id: string;
  jobId: string;
  name: string;
  status: string;
  progress: number;
  taskCount: number;
  doneCount: number;
  location: string;
  tasks: TaskCollection;
  current: string | { taskName: string; stage?: string } | null;
  currentStage?: string;
  createdAt?: string;
  updatedAt?: string;
  pipeline?: string;
  pipelineLabel?: string;
  costsSummary?: CostsSummary;
  totalCost?: number;
  totalTokens?: number;
  displayCategory: DisplayCategory;
}

export function normalizeTaskCollection(
  tasks: TaskCollection,
): Record<string, TaskStateObject> {
  if (Array.isArray(tasks)) {
    return Object.fromEntries(tasks.map((task) => [task.name, task] as const));
  }

  return tasks;
}

export interface JobDetail {
  id: string;
  name: string;
  status: string;
  tasks: TaskCollection;
  pipeline: { tasks: string[] };
  costs?: {
    summary: CostsSummary;
    taskBreakdown: Record<string, unknown>;
  };
  totalCost?: number;
  totalTokens?: number;
  current: string | { taskName: string; stage?: string } | null;
  pipelineLabel?: string;
}

export interface DagItem {
  id: string;
  status: TaskState;
  stage: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  startedAt: string | number;
  endedAt: string | number | null;
  restartCount?: number;
}

export interface PipelineTask {
  name: string;
  [key: string]: unknown;
}

export interface PipelineType {
  name: string;
  slug: string;
  description: string;
  tasks: PipelineTask[];
}

export interface Artifact {
  fileName: string;
  stage: string;
  required?: boolean;
}

export interface Stage {
  name: string;
  order?: number;
  isAsync?: boolean;
}

export interface AnalysisModel {
  provider: string;
  method: string;
  stage: string;
}

export interface TaskAnalysis {
  artifacts: {
    reads: Artifact[];
    writes: Artifact[];
  };
  stages: Stage[];
  models: AnalysisModel[];
  analyzedAt: string;
}

export interface TaskProposal {
  filename: string;
  taskName: string;
  code: string;
  proposalBlock: string;
  created: boolean;
  error: string | null;
  path: string | null;
}

export interface ConnectorLine {
  d: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LayoutProps {
  children: ReactNode;
  title?: string;
  pageTitle?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  subheader?: ReactNode;
  backTo?: string;
  maxWidth?: string;
}

export type BadgeIntent = "gray" | "blue" | "green" | "red" | "amber";
export type ButtonVariant = "solid" | "soft" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";
export type ProgressVariant = "default" | "running" | "error" | "completed" | "pending";
export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

export interface ToastContextValue {
  addToast(type: ToastType, message: string): void;
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

export interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  headerClassName?: string;
  contentClassName?: string;
  showHeaderBorder?: boolean;
  children: ReactNode;
}

export interface RestartConfirmation {
  singleTask: boolean;
  continueAfter?: boolean;
}

export type AnalysisStatus = "idle" | "connecting" | "running" | "complete" | "error";
export type FilePaneType = "artifacts" | "logs" | "tmp";

export interface UploadResult {
  jobName: string;
}
