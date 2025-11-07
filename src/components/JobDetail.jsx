import React from "react";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";
import { getTaskFilesForTask } from "../utils/task-files.js";

// Local helpers for formatting costs and tokens
function formatCurrency4(x) {
  if (typeof x !== "number" || x === 0) return "$0.0000";
  const formatted = x.toFixed(4);
  // Trim trailing zeros and unnecessary decimal point
  return `$${formatted.replace(/\.?0+$/, "")}`;
}

function formatTokensCompact(n) {
  if (typeof n !== "number" || n === 0) return "0 tok";

  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M tokens`;
  } else if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
  }
  return `${n} tokens`;
}

export default function JobDetail({ job, pipeline }) {
  // job.tasks is expected to be an object keyed by task name; normalize from array if needed
  const taskById = React.useMemo(() => {
    const tasks = job?.tasks;

    let result;
    if (!tasks) {
      result = {};
    } else if (Array.isArray(tasks)) {
      const map = {};
      for (const t of tasks) {
        const key = t?.name;
        if (key) {
          map[key] = t;
        }
      }
      result = map;
    } else {
      result = tasks;
    }

    return result;
  }, [job?.tasks]);

  // Compute pipeline tasks from pipeline or derive from job tasks
  const computedPipeline = React.useMemo(() => {
    let result;
    if (pipeline?.tasks) {
      result = pipeline;
    } else {
      // Derive pipeline tasks from job tasks object keys
      const jobTasks = job?.tasks;

      if (!jobTasks) {
        result = { tasks: [] };
      } else {
        const taskKeys = Array.isArray(jobTasks)
          ? jobTasks.map((t) => t?.name).filter(Boolean)
          : Object.keys(jobTasks);

        result = { tasks: taskKeys };
      }
    }

    return result;
  }, [pipeline, job?.tasks]);

  // Compute DAG items and active index for visualization
  const dagItems = React.useMemo(() => {
    const rawDagItems = computeDagItems(job, computedPipeline);

    const processedItems = rawDagItems.map((item, index) => {
      const task = taskById[item.id];

      const taskConfig = task?.config || {};

      // Build subtitle with useful metadata when available (Tufte-inspired inline tokens)
      const subtitleParts = [];
      if (taskConfig?.model) {
        subtitleParts.push(taskConfig.model);
      }
      if (taskConfig?.temperature != null) {
        subtitleParts.push(`temp ${taskConfig.temperature}`);
      }
      if (task?.attempts != null) {
        subtitleParts.push(`${task.attempts} attempts`);
      }
      if (task?.refinementAttempts != null) {
        subtitleParts.push(`${task.refinementAttempts} refinements`);
      }

      // Prefer taskBreakdown totals for consistency with backend
      const taskBreakdown = job?.costs?.taskBreakdown?.[item.id]?.summary || {};
      if (taskBreakdown.totalTokens > 0) {
        subtitleParts.push(formatTokensCompact(taskBreakdown.totalTokens));
      }
      if (taskBreakdown.totalCost > 0) {
        subtitleParts.push(formatCurrency4(taskBreakdown.totalCost));
      }

      // Include error message in body when task status is error or failed
      const errorMsg = task?.error?.message;
      const body =
        (item.status === "failed" || item.status === "error") && errorMsg
          ? errorMsg
          : null;

      const resultItem = {
        ...item,
        title:
          typeof item.id === "string"
            ? item.id
            : item.id?.name || item.id?.id || `Task ${item.id}`,
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
        body,
        startedAt: task?.startedAt,
        endedAt: task?.endedAt,
      };

      return resultItem;
    });

    return processedItems;
  }, [job, computedPipeline, taskById]);

  const activeIndex = React.useMemo(() => {
    const index = computeActiveIndex(dagItems);

    return index;
  }, [dagItems]);

  const filesByTypeForItem = React.useCallback(
    (item) => {
      if (!item) return { artifacts: [], logs: [], tmp: [] };
      return getTaskFilesForTask(job, item.id ?? item.name ?? item);
    },
    [job]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Job Header */}

      <DAGGrid
        items={dagItems}
        activeIndex={activeIndex}
        jobId={job.id}
        filesByTypeForItem={filesByTypeForItem}
      />
    </div>
  );
}
