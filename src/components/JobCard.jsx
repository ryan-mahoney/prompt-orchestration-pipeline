import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { Clock, TimerReset, ChevronRight } from "lucide-react";
import { fmtDuration, taskDisplayDurationMs } from "../utils/duration";
import { countCompleted } from "../utils/jobs";
import { progressClasses, statusBadge } from "../utils/ui";
import { useTicker } from "../ui/client/hooks/useTicker";

export default function JobCard({
  job,
  pipeline,
  onClick,
  progressPct,
  overallElapsedMs,
}) {
  const now = useTicker(1000);
  const currentTask = job.current ? job.tasks[job.current] : undefined;
  const currentElapsedMs = currentTask
    ? taskDisplayDurationMs(currentTask, now)
    : 0;
  const totalCompleted = countCompleted(job);
  const hasValidId = Boolean(job.id);

  return (
    <Card
      role="button"
      tabIndex={hasValidId ? 0 : -1}
      aria-label={
        hasValidId
          ? `Open ${job.name}`
          : `${job.name} - No valid job ID, cannot open details`
      }
      onClick={() => hasValidId && onClick()}
      onKeyDown={(e) =>
        hasValidId && (e.key === "Enter" || e.key === " ") && onClick()
      }
      className={`group transition-colors rounded-xl border border-slate-200 ${
        hasValidId
          ? "cursor-pointer hover:bg-slate-100/40 hover:shadow-sm focus-visible:ring-2"
          : "cursor-not-allowed opacity-60"
      }`}
      title={
        hasValidId
          ? undefined
          : "This job cannot be opened because it lacks a valid ID"
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">{job.pipelineId}</div>
            <CardTitle className="text-lg font-semibold">{job.name}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(job.status)}
            <ChevronRight className="h-4 w-4 opacity-50 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="font-semibold">
            {currentTask
              ? currentTask.name
              : job.status === "completed"
                ? "—"
                : (job.current ?? "—")}
          </div>
          {currentTask && currentElapsedMs > 0 && (
            <div className="text-slate-500">
              {fmtDuration(currentElapsedMs)}
            </div>
          )}
        </div>

        <div className="mt-3">
          <Progress
            className={`h-2 ${progressClasses(job.status)}`}
            value={progressPct}
            aria-label={`Progress ${progressPct}%`}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between text-sm text-slate-500">
            <div>
              {totalCompleted} of {pipeline.tasks.length} tasks
            </div>
            <div className="flex items-center gap-1 text-right">
              <TimerReset className="h-4 w-4" /> {fmtDuration(overallElapsedMs)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
