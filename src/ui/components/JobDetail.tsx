import { useMemo, useRef } from "react";

import { computeActiveIndex, computeDagItems } from "../../utils/dag";
import { formatCurrency4, formatTokensCompact } from "../../utils/formatters";
import { getTaskFilesForTask } from "../../utils/task-files";
import DAGGrid from "./DAGGrid";
import { normalizeTaskCollection, type JobDetail as JobDetailType, type PipelineType } from "./types";

export default function JobDetail({
  job,
  pipeline,
}: {
  job: JobDetailType;
  pipeline: PipelineType;
}) {
  const taskById = useMemo(() => normalizeTaskCollection(job.tasks), [job.tasks]);
  const prevDagItemsRef = useRef<ReturnType<typeof computeDagItems>>([]);

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
        prior.body === item.body
      ) {
        return prior;
      }
      return item;
    });

    prevDagItemsRef.current = reused;
    return reused;
  }, [job, pipeline, taskById]);

  const activeIndex = useMemo(() => computeActiveIndex(dagItems), [dagItems]);

  return (
    <DAGGrid
      items={dagItems}
      activeIndex={activeIndex}
      jobId={job.id}
      filesByTypeForItem={(index) => getTaskFilesForTask(job, dagItems[index]?.id ?? "")}
      taskById={taskById}
      pipelineTasks={pipeline.tasks.map((task) => task.name)}
    />
  );
}
