import React, { useEffect, useState } from "react";
import { fmtDuration } from "../utils/duration.js";
import { taskDisplayDurationMs } from "../utils/duration.js";
import { useTicker } from "../ui/client/hooks/useTicker.js";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";
import { getTaskFilesForTask } from "../utils/task-files.js";

export default function JobDetail({ job, pipeline, onClose, onResume }) {
  const now = useTicker(1000);
  const [resumeFrom, setResumeFrom] = useState(
    pipeline?.tasks?.[0]
      ? typeof pipeline.tasks[0] === "string"
        ? pipeline.tasks[0]
        : (pipeline.tasks[0].id ?? pipeline.tasks[0].name ?? "")
      : ""
  );

  useEffect(() => {
    setResumeFrom(
      pipeline?.tasks?.[0]
        ? typeof pipeline.tasks[0] === "string"
          ? pipeline.tasks[0]
          : (pipeline.tasks[0].id ?? pipeline.tasks[0].name ?? "")
        : ""
    );
  }, [job.id, pipeline?.tasks?.length]);

  // job.tasks is expected to be an object keyed by task name; normalize from array if needed
  const taskById = React.useMemo(() => {
    const tasks = job?.tasks;
    if (!tasks) return {};
    if (Array.isArray(tasks)) {
      const map = {};
      for (const t of tasks) {
        const key = t?.name;
        if (key) map[key] = t;
      }
      return map;
    }
    return tasks; // already keyed object
  }, [job?.tasks]);

  // Compute pipeline tasks from pipeline or derive from job tasks
  const computedPipeline = React.useMemo(() => {
    if (pipeline?.tasks) {
      return pipeline;
    }

    // Derive pipeline tasks from job tasks object keys
    const jobTasks = job?.tasks;
    if (!jobTasks) return { tasks: [] };

    return { tasks: Object.keys(jobTasks) };
  }, [pipeline, job?.tasks]);

  // Compute DAG items and active index for visualization
  const dagItems = computeDagItems(job, computedPipeline).map((item) => {
    const task = taskById[item.id];
    const taskConfig = task?.config || {};

    // Build subtitle with useful metadata when available (Tufte-inspired inline tokens)
    const subtitleParts = [];
    if (taskConfig?.model) subtitleParts.push(taskConfig.model);
    if (taskConfig?.temperature != null)
      subtitleParts.push(`temp ${taskConfig.temperature}`);
    if (task?.attempts != null) subtitleParts.push(`${task.attempts} attempts`);
    if (task?.refinementAttempts != null)
      subtitleParts.push(`${task.refinementAttempts} refinements`);
    if (task?.startedAt) {
      const durationMs = taskDisplayDurationMs(task, now);
      if (durationMs > 0) subtitleParts.push(fmtDuration(durationMs));
    }

    // Include error message in body when task status is error
    const errorMsg = task?.error?.message;
    const body = item.status === "error" && errorMsg ? errorMsg : null;

    return {
      ...item,
      title:
        typeof item.id === "string"
          ? item.id
          : item.id?.name || item.id?.id || `Task ${item.id}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
      body,
    };
  });
  const activeIndex = computeActiveIndex(dagItems);

  const filesByTypeForItem = React.useCallback(
    (item) => {
      if (!item) return { artifacts: [], logs: [], tmp: [] };
      return getTaskFilesForTask(job, item.id ?? item.name ?? item);
    },
    [job]
  );

  return (
    <div className="flex h-full flex-col">
      <DAGGrid
        items={dagItems}
        activeIndex={activeIndex}
        jobId={job.id}
        filesByTypeForItem={filesByTypeForItem}
      />
    </div>
  );
}
