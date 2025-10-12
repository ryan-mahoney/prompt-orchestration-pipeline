import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { ChevronLeft } from "lucide-react";
import { statusBadge } from "../utils/ui";
import { fmtDuration, elapsedBetween } from "../utils/time";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";

export default function JobDetail({ job, pipeline, onClose, onResume }) {
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

  // Normalize job.tasks into a lookup: id -> task object
  // The job.tasks is already an object map from the job data structure
  const taskById = job?.tasks || {};

  // Compute DAG items and active index for visualization
  const dagItems = computeDagItems(job, pipeline).map((item) => {
    const task = taskById[item.id];
    const taskConfig = task?.config || {};

    // Build subtitle with useful metadata when available
    const subtitleParts = [];
    if (taskConfig?.model) subtitleParts.push(`model: ${taskConfig.model}`);
    if (taskConfig?.temperature != null)
      subtitleParts.push(`temp: ${taskConfig.temperature}`);
    if (task?.attempts != null)
      subtitleParts.push(`attempts: ${task.attempts}`);
    if (task?.refinementAttempts != null)
      subtitleParts.push(`refinements: ${task.refinementAttempts}`);
    if (task?.startedAt) {
      const execMs =
        task?.executionTime ?? elapsedBetween(task.startedAt, task.endedAt);
      if (execMs) subtitleParts.push(`time: ${fmtDuration(execMs)}`);
    }

    return {
      ...item,
      title:
        typeof item.id === "string"
          ? item.id
          : item.id?.name || item.id?.id || `Task ${item.id}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
    };
  });
  const activeIndex = computeActiveIndex(dagItems);

  // File mapping functions for DAGGrid slide-over
  const inputFilesForItem = (item) => {
    const task = taskById[item.id];
    if (!task?.artifacts) return [];

    // Map artifacts to input files (filter for common input patterns)
    return task.artifacts
      .filter(
        (file) =>
          typeof file === "string" &&
          (file.includes("input") ||
            file.includes("config") ||
            file.includes("schema"))
      )
      .map((file, index) => ({
        name: file,
        type: "input",
      }));
  };

  const outputFilesForItem = (item) => {
    const task = taskById[item.id];
    if (!task?.artifacts) return [];

    // Map artifacts to output files
    return task.artifacts.map((file, index) => ({
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
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Back to jobs"
              className="text-gray-600 hover:text-gray-900"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {job.name}
              </h1>
              <p className="text-sm text-gray-600 mt-1">ID: {job.pipelineId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(job.status)}
          </div>
        </div>
      </header>

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
