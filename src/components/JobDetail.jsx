import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
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
      // Construct path to demo data file
      const demoDataPath = `demo/pipeline-data/current/${job.pipelineId}/tasks/${item.id}/${filename}`;

      // In a real implementation, this would fetch from the server
      // For now, we'll return a placeholder that indicates the file would be read
      return `# File: ${filename}\n# Task: ${item.id}\n# Pipeline: ${job.pipelineId}\n\nThis file would be read from: ${demoDataPath}\n\nIn a real implementation, this content would be fetched from the server or file system.`;
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
      <Card className="sticky top-0 z-10 rounded-none border-b-0 shadow-sm">
        <CardHeader className="flex-row items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Back to jobs"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <CardTitle className="text-xl">{job.name}</CardTitle>
              <p className="text-xs text-slate-500">ID: {job.pipelineId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(job.status)}
          </div>
        </CardHeader>
      </Card>

      {job.status === "error" && (
        <Card className="mx-4 my-2">
          <CardContent className="p-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold whitespace-nowrap">
                Resume from:
              </span>
              <Select value={resumeFrom} onValueChange={setResumeFrom}>
                <SelectTrigger
                  className="w-[220px]"
                  aria-label="Resume from stage"
                >
                  <SelectValue placeholder="Select task" />
                </SelectTrigger>
                <SelectContent>
                  {(pipeline?.tasks ?? []).map((t) => {
                    const id = typeof t === "string" ? t : (t.id ?? t.name);
                    const label = typeof t === "string" ? t : (t.name ?? id);
                    return (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                onClick={() => onResume(resumeFrom)}
                aria-label={`Resume from ${resumeFrom}`}
              >
                Resume from {resumeFrom}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 p-4">
        <section
          className="h-full overflow-y-auto"
          aria-label="Pipeline visualization"
        >
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <DAGGrid
                items={dagItems}
                activeIndex={activeIndex}
                inputFilesForItem={inputFilesForItem}
                outputFilesForItem={outputFilesForItem}
                getFileContent={getFileContent}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
