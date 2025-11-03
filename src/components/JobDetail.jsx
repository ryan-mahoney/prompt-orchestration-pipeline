import React, { useEffect, useState } from "react";
import { fmtDuration } from "../utils/duration.js";
import { taskDisplayDurationMs } from "../utils/duration.js";
import { useTicker } from "../ui/client/hooks/useTicker.js";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";
import { getTaskFilesForTask } from "../utils/task-files.js";

// Instrumentation helper for JobDetail
const createJobDetailLogger = (jobId) => {
  const prefix = `[JobDetail:${jobId || "unknown"}]`;
  return {
    log: (message, data = null) => {
      console.log(`${prefix} ${message}`, data ? data : "");
    },
    warn: (message, data = null) => {
      console.warn(`${prefix} ${message}`, data ? data : "");
    },
    error: (message, data = null) => {
      console.error(`${prefix} ${message}`, data ? data : "");
    },
    group: (label) => console.group(`${prefix} ${label}`),
    groupEnd: () => console.groupEnd(),
    table: (data, title) => {
      console.log(`${prefix} ${title}:`);
      console.table(data);
    },
  };
};

export default function JobDetail({ job, pipeline, onClose, onResume }) {
  const logger = React.useMemo(() => createJobDetailLogger(job?.id), [job?.id]);

  // Log component render with data snapshot
  React.useEffect(() => {
    logger.group("Component Render");
    logger.log("Job data received:", job);
    logger.log("Pipeline data received:", pipeline);
    logger.log("Job tasks structure:", {
      hasTasks: !!job?.tasks,
      taskKeys: job?.tasks ? Object.keys(job.tasks) : [],
      taskType: Array.isArray(job?.tasks) ? "array" : typeof job?.tasks,
    });
    logger.groupEnd();
  }, [job, pipeline, logger]);
  const now = useTicker(60000);
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
    logger.group("Task Normalization");
    logger.log("Input tasks:", tasks);

    let result;
    if (!tasks) {
      logger.warn("No tasks found in job data");
      result = {};
    } else if (Array.isArray(tasks)) {
      logger.log("Normalizing array tasks to object");
      const map = {};
      for (const t of tasks) {
        const key = t?.name;
        if (key) {
          map[key] = t;
          logger.log(`Mapped task: ${key}`, t);
        } else {
          logger.warn("Task without name found in array", t);
        }
      }
      result = map;
    } else {
      logger.log("Tasks already in object format");
      result = tasks;
    }

    logger.log("Final taskById mapping:", result);
    logger.table(
      Object.keys(result).map((key) => ({
        taskId: key,
        hasState: !!result[key]?.state,
        state: result[key]?.state,
        hasStage: !!result[key]?.currentStage,
        stage: result[key]?.currentStage,
        hasError: !!result[key]?.error,
      })),
      "Task Mapping Summary"
    );
    logger.groupEnd();
    return result;
  }, [job?.tasks, logger]);

  // Compute pipeline tasks from pipeline or derive from job tasks
  const computedPipeline = React.useMemo(() => {
    logger.group("Pipeline Computation");
    logger.log("Input pipeline:", pipeline);

    let result;
    if (pipeline?.tasks) {
      logger.log("Using provided pipeline tasks");
      result = pipeline;
    } else {
      // Derive pipeline tasks from job tasks object keys
      const jobTasks = job?.tasks;
      logger.log("Deriving pipeline from job tasks:", jobTasks);

      if (!jobTasks) {
        logger.warn("No job tasks available for pipeline derivation");
        result = { tasks: [] };
      } else {
        const taskKeys = Array.isArray(jobTasks)
          ? jobTasks.map((t) => t?.name).filter(Boolean)
          : Object.keys(jobTasks);

        logger.log("Derived task keys:", taskKeys);
        result = { tasks: taskKeys };
      }
    }

    logger.log("Final computed pipeline:", result);
    logger.groupEnd();
    return result;
  }, [pipeline, job?.tasks, logger]);

  // Compute DAG items and active index for visualization
  const dagItems = React.useMemo(() => {
    logger.group("DAG Items Computation");
    logger.log("Computing DAG with job and pipeline:", {
      job,
      computedPipeline,
    });

    const rawDagItems = computeDagItems(job, computedPipeline);
    logger.log("Raw DAG items from computeDagItems:", rawDagItems);

    const processedItems = rawDagItems.map((item, index) => {
      logger.group(`Processing DAG Item ${index}: ${item.id}`);

      if (process.env.NODE_ENV !== "test") {
        console.debug("[JobDetail] computed DAG item", {
          id: item.id,
          status: item.status,
          stage: item.stage,
          jobHasTasks: !!job?.tasks,
          taskKeys: job?.tasks ? Object.keys(job.tasks) : null,
        });
      }

      const task = taskById[item.id];
      logger.log("Corresponding task from taskById:", task);

      const taskConfig = task?.config || {};
      logger.log("Task config:", taskConfig);

      // Build subtitle with useful metadata when available (Tufte-inspired inline tokens)
      const subtitleParts = [];
      if (taskConfig?.model) {
        subtitleParts.push(taskConfig.model);
        logger.log(`Added model to subtitle: ${taskConfig.model}`);
      }
      if (taskConfig?.temperature != null) {
        subtitleParts.push(`temp ${taskConfig.temperature}`);
        logger.log(`Added temperature to subtitle: ${taskConfig.temperature}`);
      }
      if (task?.attempts != null) {
        subtitleParts.push(`${task.attempts} attempts`);
        logger.log(`Added attempts to subtitle: ${task.attempts}`);
      }
      if (task?.refinementAttempts != null) {
        subtitleParts.push(`${task.refinementAttempts} refinements`);
        logger.log(
          `Added refinement attempts to subtitle: ${task.refinementAttempts}`
        );
      }
      if (task?.startedAt) {
        const durationMs = taskDisplayDurationMs(task, now);
        if (durationMs > 0) {
          subtitleParts.push(fmtDuration(durationMs));
          logger.log(`Added duration to subtitle: ${fmtDuration(durationMs)}`);
        }
      }

      // Include error message in body when task status is error
      const errorMsg = task?.error?.message;
      const body = item.status === "failed" && errorMsg ? errorMsg : null;
      if (body) {
        logger.log(`Added error body:`, errorMsg);
      }

      const resultItem = {
        ...item,
        title:
          typeof item.id === "string"
            ? item.id
            : item.id?.name || item.id?.id || `Task ${item.id}`,
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
        body,
      };

      logger.log("Final processed DAG item:", resultItem);
      logger.groupEnd();

      return resultItem;
    });

    logger.log("All processed DAG items:", processedItems);
    logger.table(
      processedItems.map((item, index) => ({
        index,
        id: item.id,
        title: item.title,
        status: item.status,
        stage: item.stage,
        hasSubtitle: !!item.subtitle,
        hasBody: !!item.body,
      })),
      "DAG Items Summary"
    );
    logger.groupEnd();

    return processedItems;
  }, [job, computedPipeline, taskById, now, logger]);

  const activeIndex = React.useMemo(() => {
    const index = computeActiveIndex(dagItems);
    logger.log(`Computed active index: ${index}`, {
      totalItems: dagItems.length,
      activeItem:
        index >= 0 && index < dagItems.length ? dagItems[index] : null,
    });
    return index;
  }, [dagItems, logger]);

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
