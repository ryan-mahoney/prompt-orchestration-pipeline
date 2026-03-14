import type { JobSummary, PipelineType } from "./types";
import { Badge } from "./ui/Badge";
import { Progress } from "./ui/Progress";
import { formatCurrency4 } from "../../utils/formatters";

export default function JobCard({
  job,
  pipeline,
  onClick,
  progressPct,
  overallElapsedMs,
}: {
  job: JobSummary;
  pipeline: PipelineType | null;
  onClick: () => void;
  progressPct: number;
  overallElapsedMs: number;
}) {
  return (
    <button type="button" className="rounded-md border border-gray-300 bg-white p-4 text-left" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{job.name}</div>
          <div className="text-sm text-gray-500">{job.pipelineLabel ?? pipeline?.name ?? job.pipeline ?? "—"}</div>
        </div>
        <Badge intent={job.status === "failed" ? "red" : job.status === "complete" ? "green" : job.status === "running" ? "blue" : "amber"}>{job.status}</Badge>
      </div>
      <div className="mt-4">
        <Progress value={progressPct} variant={job.status === "failed" ? "error" : job.status === "complete" ? "completed" : "running"} />
      </div>
      <div className="mt-3 text-sm text-gray-600">Cost: {formatCurrency4(job.totalCost ?? 0)} · Duration: {Math.max(0, Math.floor(overallElapsedMs / 1000))}s</div>
    </button>
  );
}
