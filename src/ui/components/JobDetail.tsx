import { useMemo, useRef, useState } from "react";

import { decideGate } from "../client/api";
import type { GateDecisionAction } from "../client/types";
import { computeActiveIndex, computeDagItems } from "../../utils/dag";
import { formatCurrency4, formatTokensCompact } from "../../utils/formatters";
import { getTaskFilesForTask } from "../../utils/task-files";
import DAGGrid from "./DAGGrid";
import { normalizeTaskCollection, type JobDetail as JobDetailType, type PipelineType } from "./types";
import { Button } from "./ui/Button";

function getGateArtifactHref(jobId: string, taskId: string, filename: string): string {
  const params = new URLSearchParams({ type: "artifacts", filename });
  return `/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/file?${params.toString()}`;
}

export default function JobDetail({
  job,
  pipeline,
}: {
  job: JobDetailType;
  pipeline: PipelineType;
}) {
  const taskById = useMemo(() => normalizeTaskCollection(job.tasks), [job.tasks]);
  const prevDagItemsRef = useRef<ReturnType<typeof computeDagItems>>([]);
  const [gateSubmitting, setGateSubmitting] = useState<GateDecisionAction | null>(null);
  const [gateAlert, setGateAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const dagItems = useMemo(() => {
    const enriched = computeDagItems(job, pipeline).map((item) => {
      const task = taskById[item.id];
      const parts = [
        typeof task?.config?.["model"] === "string" ? String(task.config.model) : null,
        typeof task?.refinementAttempts === "number" ? `${task.refinementAttempts} refinements` : null,
      ];
      const breakdown = (job.costs?.taskBreakdown?.[item.id] as Record<string, unknown> | undefined)?.["summary"] as Record<string, unknown> | undefined;
      if (typeof breakdown?.["totalTokens"] === "number" && breakdown.totalTokens > 0) parts.push(formatTokensCompact(breakdown.totalTokens));
      if (typeof breakdown?.["totalCost"] === "number" && breakdown.totalCost > 0) parts.push(formatCurrency4(breakdown.totalCost));
      return {
        ...item,
        subtitle: parts.filter(Boolean).join(" · ") || null,
        body: item.body ?? task?.error?.message ?? null,
      };
    });

    const previous = prevDagItemsRef.current;
    const reused = enriched.map((item, index) => {
      const prior = previous[index];
      if (
        prior &&
        prior.id === item.id &&
        prior.status === item.status &&
        prior.stage === item.stage &&
        prior.title === item.title &&
        prior.subtitle === item.subtitle &&
        prior.body === item.body &&
        prior.restartCount === item.restartCount
      ) {
        return prior;
      }
      return item;
    });

    prevDagItemsRef.current = reused;
    return reused;
  }, [job, pipeline, taskById]);

  const activeIndex = useMemo(() => computeActiveIndex(dagItems), [dagItems]);
  const gate = job.gate ?? null;

  const submitGateDecision = (action: GateDecisionAction) => {
    const note = action === "reject" ? window.prompt("Reject note (optional)") : undefined;
    setGateSubmitting(action);
    setGateAlert(null);
    void decideGate(job.id, action, note?.trim() ? note.trim() : undefined)
      .then(() => {
        setGateAlert({ type: "success", message: action === "approve" ? "Gate approved." : "Gate rejected." });
      })
      .catch((error: unknown) => {
        setGateAlert({ type: "error", message: error instanceof Error ? error.message : "Gate decision failed." });
      })
      .finally(() => setGateSubmitting(null));
  };

  return (
    <div className="space-y-4">
      {gate ? (
        <section
          className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-yellow-900"
          aria-label="Gate awaiting decision"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Waiting for gate decision</div>
              <p className="mt-1 text-sm">{gate.message || "Review required before the run can continue."}</p>
              <div className="mt-2 text-xs text-yellow-800">After task: {gate.afterTask}</div>
              {gate.artifacts?.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {gate.artifacts.map((artifact) => (
                    <li key={artifact}>
                      <a
                        className="inline-flex min-h-8 items-center rounded-sm border border-yellow-300 bg-white px-2 text-xs font-medium text-yellow-900 hover:border-yellow-500"
                        href={getGateArtifactHref(job.id, gate.afterTask, artifact)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {artifact}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {gateAlert ? (
                <p className={`mt-3 text-sm ${gateAlert.type === "error" ? "text-red-700" : "text-green-700"}`} role="status">
                  {gateAlert.message}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                loading={gateSubmitting === "approve"}
                disabled={gateSubmitting !== null}
                onClick={() => submitGateDecision("approve")}
              >
                Approve gate
              </Button>
              <Button
                size="sm"
                variant="destructive"
                loading={gateSubmitting === "reject"}
                disabled={gateSubmitting !== null}
                onClick={() => submitGateDecision("reject")}
              >
                Reject gate
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      <DAGGrid
        items={dagItems}
        activeIndex={activeIndex}
        jobId={job.id}
        filesByTypeForItem={(index) => getTaskFilesForTask(job, dagItems[index]?.id ?? "")}
        taskById={taskById}
        pipelineTasks={pipeline.tasks.map((task) => task.name)}
        waitingTaskId={gate?.afterTask ?? null}
      />
    </div>
  );
}
