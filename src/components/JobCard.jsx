import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { Clock, TimerReset, ChevronRight } from "lucide-react";
import { fmtDuration, elapsedBetween } from "../utils/time";
import { countCompleted } from "../utils/jobs";
import { progressClasses, statusBadge } from "../utils/ui";

export default function JobCard({
  job,
  pipeline,
  onClick,
  progressPct,
  overallElapsedMs,
}) {
  const currentTask = job.current ? job.tasks[job.current] : undefined;
  const currentElapsed = currentTask
    ? elapsedBetween(currentTask.startedAt, currentTask.endedAt)
    : 0;
  const totalCompleted = countCompleted(job);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${job.name}`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className="group transition-colors cursor-pointer hover:bg-slate-100/40 hover:shadow-sm focus-visible:ring-2 rounded-xl border border-slate-200"
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
            Current:{" "}
            {currentTask
              ? currentTask.name
              : job.status === "completed"
                ? "—"
                : (job.current ?? "—")}
          </div>
          {currentTask && (
            <div className="flex items-center gap-1 text-slate-500">
              <Clock className="h-4 w-4" /> {fmtDuration(currentElapsed)}
            </div>
          )}
          {currentTask?.config && (
            <div className="text-slate-500">
              {currentTask.config.model} · temp {currentTask.config.temperature}
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
              {totalCompleted} of {pipeline.tasks.length} tasks complete
            </div>
            <div className="flex items-center gap-1">
              <TimerReset className="h-4 w-4" /> {fmtDuration(overallElapsedMs)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
