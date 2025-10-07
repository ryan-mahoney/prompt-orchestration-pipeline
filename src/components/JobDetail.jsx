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

export default function JobDetail({ job, pipeline, onClose, onResume }) {
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const [resumeFrom, setResumeFrom] = useState(pipeline.tasks[0]?.id ?? "");

  useEffect(() => {
    setSelectedArtifact(null);
    setResumeFrom(pipeline.tasks[0]?.id ?? "");
  }, [job.pipelineId, pipeline.tasks]);

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
                  {pipeline.tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
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
              <CardTitle className="text-sm">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pipeline.tasks.map((t) => {
                const st = job.tasks[t.id];
                const state = st?.state ?? "pending";
                const execMs =
                  st?.executionTime ??
                  elapsedBetween(st?.startedAt, st?.endedAt);
                const attempts = st?.attempts ?? 0;
                const refine = st?.refinementAttempts ?? 0;

                const allExec = pipeline.tasks
                  .map((pt) => job.tasks[pt.id])
                  .map(
                    (jt) =>
                      jt?.executionTime ??
                      elapsedBetween(jt?.startedAt, jt?.endedAt) ??
                      0
                  );
                const maxExec = Math.max(1, ...allExec);
                const pct = Math.min(
                  100,
                  Math.round(((execMs ?? 0) / maxExec) * 100)
                );

                return (
                  <Card key={t.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="text-sm font-semibold">{t.name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        {state === "running" && <span>running</span>}
                        {state === "error" && <span>error</span>}
                        {execMs ? <span>{fmtDuration(execMs)}</span> : <span />}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">
                      attempts {attempts} · refinements {refine}
                    </div>
                    <Progress value={pct} variant={state} className="mb-2" />
                    <div className="text-xs text-slate-500">
                      {t.config.model} · temp {t.config.temperature}
                      {t.config.maxTokens != null
                        ? ` · maxTokens ${t.config.maxTokens}`
                        : ""}
                    </div>

                    {st?.artifacts && st.artifacts.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {st.artifacts.map((a) => (
                          <Button
                            key={a.filename}
                            variant="link"
                            size="sm"
                            className="px-0 text-slate-900 hover:text-slate-700"
                            onClick={() => setSelectedArtifact(a)}
                            aria-label={`Open artifact ${a.filename}`}
                          >
                            {a.filename}
                          </Button>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
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
