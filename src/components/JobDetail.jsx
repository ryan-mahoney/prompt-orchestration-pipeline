import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { ChevronLeft, X } from "lucide-react";
import { statusBadge } from "../utils/ui";
import { fmtDuration, elapsedBetween } from "../utils/time";
import ReactJson from "react18-json-view";
import "react18-json-view/src/style.css";
import DAGGrid from "./DAGGrid.jsx";
import { computeDagItems, computeActiveIndex } from "../utils/dag.js";

export default function JobDetail({ job, pipeline, onClose, onResume }) {
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const [resumeFrom, setResumeFrom] = useState(
    pipeline?.tasks?.[0]
      ? typeof pipeline.tasks[0] === "string"
        ? pipeline.tasks[0]
        : (pipeline.tasks[0].id ?? pipeline.tasks[0].name ?? "")
      : ""
  );

  useEffect(() => {
    setSelectedArtifact(null);
    setResumeFrom(
      pipeline?.tasks?.[0]
        ? typeof pipeline.tasks[0] === "string"
          ? pipeline.tasks[0]
          : (pipeline.tasks[0].id ?? pipeline.tasks[0].name ?? "")
        : ""
    );
  }, [job.pipelineId, pipeline?.tasks?.length]);

  // Normalize job.tasks into a lookup: id -> task object
  // Support both array-of-strings, array-of-objects, and an object map.
  const taskById = Array.isArray(job?.tasks)
    ? Object.fromEntries(
        (job.tasks || []).map((x) =>
          typeof x === "string"
            ? [x, { id: x, name: x, config: pipeline?.taskConfig?.[x] || {} }]
            : [x.id ?? x.name, x]
        )
      )
    : job?.tasks || {};

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

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section
          className="flex-1 min-w-[320px] overflow-y-auto"
          aria-label="Task timeline"
        >
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <DAGGrid items={dagItems} activeIndex={activeIndex} />
            </CardContent>
          </Card>
        </section>

        <Separator orientation="vertical" />

        <section className="flex-1 overflow-y-auto" aria-label="Outputs">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Outputs</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedArtifact ? (
                <div className="flex h-32 items-center justify-center rounded border border-dashed p-6 text-sm text-slate-500">
                  Select an artifact to preview its JSON here.
                </div>
              ) : (
                <Card>
                  <CardHeader className="flex-row items-center justify-between gap-2 py-3">
                    <CardTitle className="text-sm">
                      {selectedArtifact.filename}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedArtifact(null)}
                      aria-label="Close artifact"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="max-h-[62vh] overflow-auto p-2">
                    <ReactJson
                      src={selectedArtifact.content}
                      collapsed={2}
                      displayDataTypes={false}
                      enableClipboard={false}
                      name={false}
                    />
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
