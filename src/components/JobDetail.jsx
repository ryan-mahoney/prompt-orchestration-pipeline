import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { ChevronLeft } from "lucide-react";
import { statusBadge } from "../utils/ui";
import { fmtDuration } from "../utils/duration.js";
import { normalizeState, taskDisplayDurationMs } from "../utils/duration.js";
import { useTicker } from "../ui/client/hooks/useTicker.js";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";

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
  }, [job.pipelineId, pipeline?.tasks?.length]);

  // job.tasks is expected to be an object keyed by task name
  const taskById = React.useMemo(() => {
    const tasks = job?.tasks;
    return tasks || {};
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

  // File mapping functions for DAGGrid slide-over
  const inputFilesForItem = (item) => {
    const task = taskById[item.id];

    // Prefer new files.* schema, fallback to legacy artifacts
    const allFiles = [];

    // Add files from new schema
    if (task?.files) {
      if (Array.isArray(task.files.tmp)) {
        allFiles.push(
          ...task.files.tmp.filter(
            (file) =>
              typeof file === "string" &&
              (file.includes("input") ||
                file.includes("config") ||
                file.includes("schema"))
          )
        );
      }
    }

    // Fallback to legacy artifacts
    if (task?.artifacts) {
      allFiles.push(
        ...task.artifacts.filter(
          (file) =>
            typeof file === "string" &&
            (file.includes("input") ||
              file.includes("config") ||
              file.includes("schema"))
        )
      );
    }

    return allFiles.map((file, index) => ({
      name: file,
      type: "input",
    }));
  };

  const outputFilesForItem = (item) => {
    const task = taskById[item.id];

    // Prefer new files.* schema, fallback to legacy artifacts
    const allFiles = [];

    // Add files from new schema
    if (task?.files) {
      if (Array.isArray(task.files.artifacts)) {
        allFiles.push(...task.files.artifacts);
      }
      if (Array.isArray(task.files.logs)) {
        allFiles.push(...task.files.logs);
      }
    }

    // Fallback to legacy artifacts
    if (task?.artifacts) {
      allFiles.push(...task.artifacts);
    }

    return allFiles.map((file, index) => ({
      name: typeof file === "string" ? file : file.name || `output-${index}`,
      type: "output",
    }));
  };

  const getFileContent = async (filename, item) => {
    const task = taskById[item.id];

    // Try to read from demo data files first (for demo environment)
    try {
      // Import fs dynamically to avoid issues in browser environment
      const fs = await import("node:fs");
      const path = await import("node:path");

      // Construct path to demo data file
      const demoDataPath = path.join(
        process.cwd(),
        "demo",
        "pipeline-data",
        "current",
        job.pipelineId,
        "tasks",
        item.id,
        filename
      );

      // Try to read the actual file
      const content = await fs.promises.readFile(demoDataPath, "utf8");
      return content;
    } catch (error) {
      // Fallback to demo data or placeholder
      const demoContents = {
        "input-data.json": JSON.stringify(
          {
            id: job.pipelineId,
            name: job.name,
            config: job.config || {},
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
        "schema.yaml": `# Pipeline schema for ${job.name}
type: object
properties:
  id:
    type: string
    description: Pipeline identifier
  name:
    type: string
    description: Pipeline name
  config:
    type: object
    description: Pipeline configuration
required:
  - id
  - name`,
        "output.json": JSON.stringify(
          {
            status: task?.state || "unknown",
            result: task?.result || {},
            metadata: {
              taskId: item.id,
              pipelineId: job.pipelineId,
              completedAt: task?.endedAt || new Date().toISOString(),
            },
          },
          null,
          2
        ),
      };

      return (
        demoContents[filename] ||
        `# Content of ${filename}\n\nFile content for ${filename} from task ${item.id} in pipeline ${job.name}.`
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <DAGGrid
        items={dagItems}
        activeIndex={activeIndex}
        inputFilesForItem={inputFilesForItem}
        outputFilesForItem={outputFilesForItem}
        getFileContent={getFileContent}
      />
    </div>
  );
}
