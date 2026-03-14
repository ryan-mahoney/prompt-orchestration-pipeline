import { Monitor } from "lucide-react";

import type { JobSummary, PipelineType } from "./types";
import { countCompleted } from "../../utils/jobs";
import { formatCurrency4, formatTokensCompact } from "../../utils/formatters";
import { getTaskFilesForTask } from "../../utils/task-files";
import TimerText from "./TimerText";
import { EmptyState } from "./onboarding";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Progress } from "./ui/Progress";

function getIntent(status: string): "gray" | "blue" | "green" | "red" | "amber" {
  if (status === "running") return "blue";
  if (status === "complete") return "green";
  if (status === "failed") return "red";
  return "amber";
}

function toMs(value?: string | number | null): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function JobTable({
  jobs,
  pipeline = null,
  onOpenJob,
  onUpload,
}: {
  jobs: JobSummary[];
  pipeline?: PipelineType | null;
  onOpenJob: (jobId: string) => void;
  onUpload?: () => void;
}) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<Monitor className="h-7 w-7" />}
        title="No pipelines yet"
        description="Upload a seed file to run your first pipeline."
        action={onUpload ? <Button onClick={onUpload}>Upload seed file</Button> : undefined}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 text-left text-sm font-medium text-gray-500">
          <tr>
            <th className="px-4 py-3">Job Name</th>
            <th className="px-4 py-3">Pipeline</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Current Task</th>
            <th className="px-4 py-3">Progress</th>
            <th className="px-4 py-3">Tasks</th>
            <th className="px-4 py-3">Cost</th>
            <th className="px-4 py-3">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {jobs.map((job) => {
            const validId = Boolean(job.id);
            const taskMap = Array.isArray(job.tasks) ? Object.fromEntries(job.tasks.map((task) => [task.name, task] as const)) : job.tasks;
            const currentTaskId =
              typeof job.current === "string" ? job.current : job.current?.taskName;
            const currentTask = currentTaskId ? taskMap[currentTaskId] : undefined;
            const totalCost = job.totalCost ?? job.costsSummary?.totalCost ?? 0;
            const totalTokens = job.totalTokens ?? job.costsSummary?.totalTokens ?? 0;
            const startMs = Object.values(taskMap).map((task) => toMs(task.startedAt)).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null;
            const endMs = Object.values(taskMap).map((task) => toMs(task.endedAt)).filter((value): value is number => value !== null).sort((a, b) => b - a)[0] ?? null;

            return (
              <tr
                key={job.jobId}
                className={validId ? "cursor-pointer transition hover:bg-gray-50" : "cursor-not-allowed opacity-60"}
                onClick={() => validId && onOpenJob(job.id)}
                tabIndex={validId ? 0 : -1}
                onKeyDown={(event) => {
                  if (validId && (event.key === "Enter" || event.key === " ")) onOpenJob(job.id);
                }}
              >
                <td className="px-4 py-4">
                  <div className="font-medium text-[#6d28d9]">{job.name}</div>
                  <div className="text-xs text-gray-500">{job.id}</div>
                </td>
                <td className="px-4 py-4 text-sm text-gray-700">{job.pipelineLabel ?? job.pipeline ?? pipeline?.name ?? "—"}</td>
                <td className="px-4 py-4">
                  <Badge intent={getIntent(job.status)}>{job.status}</Badge>
                </td>
                <td className="px-4 py-4 text-sm text-gray-700">{currentTask?.name ?? currentTaskId ?? "—"}</td>
                <td className="px-4 py-4">
                  <div className="flex min-w-[160px] items-center gap-3">
                    <Progress value={job.progress} variant={job.status === "failed" ? "error" : job.status === "complete" ? "completed" : job.status === "running" ? "running" : "pending"} className="flex-1" />
                    <span className="text-sm text-gray-600">{job.progress}%</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm text-gray-700">{countCompleted(job)} of {job.taskCount}</td>
                <td className="px-4 py-4">
                  <div className="text-sm text-gray-700">{totalCost > 0 ? formatCurrency4(totalCost) : "—"}</div>
                  {totalTokens > 0 ? <div className="text-xs text-gray-500">{formatTokensCompact(totalTokens)}</div> : null}
                </td>
                <td className="px-4 py-4 text-sm text-gray-700">
                  {startMs ? <TimerText startMs={startMs} endMs={endMs} granularity="second" /> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
