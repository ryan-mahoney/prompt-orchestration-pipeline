import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, X } from "lucide-react";
import { statusBadge, barColorForState } from "../utils/ui";
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
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-2">
        <div className="flex items-start justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Back to jobs">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h2 className="text-xl font-semibold">{job.name}</h2>
              <p className="text-xs text-muted-foreground">ID: {job.pipelineId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">{statusBadge(job.status)}</div>
        </div>
      </div>

      {job.status === "error" && (
        <div className="mb-2 px-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Resume from:</span>
            <Select value={resumeFrom} onValueChange={setResumeFrom}>
              <SelectTrigger className="w-[220px]" aria-label="Resume from stage">
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
            <Button onClick={() => onResume(resumeFrom)} aria-label={`Resume from ${resumeFrom}`}>
              Resume from {resumeFrom}
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="w-[44%] min-w-[300px] overflow-y-auto px-4" aria-label="Task timeline">
          <h3 className="mb-2 text-sm font-semibold tracking-tight">Timeline</h3>
          <ol className="relative ml-2 border-l border-muted-foreground/20">
            {pipeline.tasks.map((t) => {
              const st = job.tasks[t.id];
              const state = st?.state ?? "pending";
              const execMs = st?.executionTime ?? elapsedBetween(st?.startedAt, st?.endedAt);
              const attempts = st?.attempts ?? 0;
              const refine = st?.refinementAttempts ?? 0;

              const barColorClass = barColorForState(state);

              const allExec = pipeline.tasks
                .map((pt) => job.tasks[pt.id])
                .map((jt) => jt?.executionTime ?? elapsedBetween(jt?.startedAt, jt?.endedAt) ?? 0);
              const maxExec = Math.max(1, ...allExec);
              const pct = Math.min(100, Math.round(((execMs ?? 0) / maxExec) * 100));

              return (
                <li key={t.id} className="relative pl-4 pb-4">
                  <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border border-muted-foreground/40 bg-background" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {state === "running" && <span>running</span>}
                      {state === "error" && <span>error</span>}
                      {execMs ? <span>{fmtDuration(execMs)}</span> : <span />}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">attempts {attempts} · refinements {refine}</div>
                  <div className="mt-2 h-[4px] w-full rounded-full bg-gray-100">
                    <div className={`h-[4px] rounded-full ${barColorClass}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t.config.model} · temp {t.config.temperature}
                    {t.config.maxTokens != null ? ` · maxTokens ${t.config.maxTokens}` : ""}
                  </div>

                  {st?.artifacts && st.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {st.artifacts.map((a) => (
                        <Button
                          key={a.filename}
                          variant="link"
                          size="sm"
                          className="px-0 text-blue-600 hover:text-blue-700"
                          onClick={() => setSelectedArtifact(a)}
                          aria-label={`Open artifact ${a.filename}`}
                        >
                          {a.filename}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <Separator orientation="vertical" className="mx-1" />

        <section className="flex-1 overflow-y-auto px-4" aria-label="Outputs">
          <h3 className="mb-2 text-sm font-semibold tracking-tight">Outputs</h3>
          {!selectedArtifact ? (
            <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
              Select an artifact to preview its JSON here.
            </div>
          ) : (
            <div className="rounded border">
              <div className="flex items-center justify-between gap-2 border-b p-2">
                <div className="text-sm font-semibold">{selectedArtifact.filename}</div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedArtifact(null)} aria-label="Close artifact">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-[62vh] overflow-auto p-2">
                <ReactJson src={selectedArtifact.content} collapsed={2} displayDataTypes={false} enableClipboard={false} name={false} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
