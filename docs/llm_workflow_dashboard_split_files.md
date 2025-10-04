# LLM Workflow Dashboard — Split Files

This refactor splits the single-file React UI into modular pieces for easier maintenance and LLM-driven workflows. It preserves all functionality and demo data. A parent page coordinates tabs, uploads, filtering, and selection state; child components render lists, cards, and details; utilities centralize formatting and visual rules.

## Directory Structure

```
src/
  pages/
    PromptPipelineDashboard.jsx
  components/
    JobList.jsx
    JobCard.jsx
    JobDetail.jsx
  utils/
    time.js
    jobs.js
    ui.js
  data/
    demoData.js
```

---

## How these files work together

- **`pages/PromptPipelineDashboard.jsx`**: Top-level screen. Holds state for pipeline, jobs, active tab, selected job, and upload parsing. Renders tabs and either the list or the detail view.
- **`components/JobList.jsx`**: Receives filtered jobs and renders a responsive grid of `JobCard` components.
- **`components/JobCard.jsx`**: Small summary card of a job, including current task, progress, and elapsed time.
- **`components/JobDetail.jsx`**: In-page detail view for a job with a Tufte-style timeline and a JSON artifact viewer.
- **`utils/time.js`**: Duration and elapsed-time helpers.
- **`utils/jobs.js`**: Job-related helpers (e.g., count completed tasks).
- **`utils/ui.js`**: UI helpers for consistent status badges and color rules.
- **`data/demoData.js`**: Demo pipeline and job runs (same as the original inline sample).

> **LLM Workflow Notes**  
> - This separation makes it easy for LLM agents to operate on specific layers (e.g., update UI styles in `utils/ui.js` without touching business logic).  
> - The job schema (shape) is unchanged from the original; see inline JSDoc comments for quick reference.  
> - To wire to live data, replace `demoData.js` with your API/SSE source and update `PromptPipelineDashboard.jsx` to call `setJobs` with fresh statuses.

---

## Integration (shadcn/ui + lucide-react)
The UI still uses your existing shadcn components via `@/components/ui/...` and icons from `lucide-react`. If your alias for `@` differs, update imports accordingly.

---

## Files

### `src/utils/time.js`
```js
// src/utils/time.js
export const fmtDuration = (ms) => {
  if (ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
};

export const elapsedBetween = (start, end) => {
  if (!start) return 0;
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, e - s);
};
```

### `src/utils/jobs.js`
```js
// src/utils/jobs.js
export const countCompleted = (job) =>
  Object.values(job.tasks).filter((t) => t.state === "completed").length;
```

### `src/utils/ui.js`
```jsx
// src/utils/ui.js
import React from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, AlertTriangle, Circle } from "lucide-react";

export const statusBadge = (status) => {
  switch (status) {
    case "running":
      return (
        <Badge className="bg-blue-500 hover:bg-blue-600" aria-label="Running">
          Running
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-500 hover:bg-red-600" aria-label="Error">
          Error
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-500 hover:bg-green-600" aria-label="Completed">
          Completed
        </Badge>
      );
    default:
      return null;
  }
};

export const taskStatusIcon = (state) => {
  switch (state) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />;
    case "error":
      return <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
};

export const progressClasses = (status) => {
  switch (status) {
    case "running":
      return "bg-blue-50 [&>div]:bg-blue-500";
    case "error":
      return "bg-red-50 [&>div]:bg-red-500";
    case "completed":
      return "bg-green-50 [&>div]:bg-green-500";
    default:
      return "bg-gray-100 [&>div]:bg-gray-500";
  }
};

export const barColorForState = (state) => {
  switch (state) {
    case "running":
      return "bg-blue-500";
    case "error":
      return "bg-red-500";
    case "completed":
      return "bg-green-500";
    default:
      return "bg-gray-300";
  }
};
```

### `src/data/demoData.js`
```js
// src/data/demoData.js
export const demoPipeline = {
  name: "AI Content Generation",
  tasks: [
    { id: "ingest", name: "ingest", config: { model: "gpt-4o", temperature: 0.2, maxTokens: 2000 } },
    { id: "analysis", name: "analysis", config: { model: "gpt-4.1", temperature: 0.3, maxTokens: 3000 } },
    { id: "draft", name: "draft", config: { model: "gpt-4.1", temperature: 0.7, maxTokens: 4000 } },
    { id: "validate", name: "validate", config: { model: "gpt-4o", temperature: 0.0, maxTokens: 1500 } },
  ],
};

const now = Date.now();
const earlier = (mins) => new Date(now - mins * 60_000).toISOString();

export const demoJobs = [
  {
    pipelineId: "run-001",
    name: "Blog: Transit Reliability",
    createdAt: earlier(14),
    status: "running",
    current: "draft",
    tasks: {
      ingest: {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(14),
        endedAt: earlier(13),
        executionTime: 60_000,
        attempts: 1,
        artifacts: [
          { filename: "sources.json", content: { urls: ["https://example.com/a", "https://example.com/b"] } },
        ],
      },
      analysis: {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(13),
        endedAt: earlier(9),
        executionTime: 240_000,
        attempts: 1,
        artifacts: [
          { filename: "analysis.json", content: { themes: ["headways", "dwell"], gaps: ["APC"] } },
        ],
      },
      draft: {
        id: "draft",
        name: "draft",
        state: "running",
        startedAt: earlier(9),
        attempts: 1,
      },
      validate: {
        id: "validate",
        name: "validate",
        state: "pending",
        attempts: 0,
      },
    },
  },
  {
    pipelineId: "run-002",
    name: "Whitepaper: Structured Hiring",
    createdAt: earlier(35),
    status: "error",
    current: "analysis",
    tasks: {
      ingest: {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(35),
        endedAt: earlier(33),
        executionTime: 120_000,
        attempts: 1,
        artifacts: [
          { filename: "sources.json", content: { driveIds: ["1ab", "2cd"], notes: "ok" } },
        ],
      },
      analysis: {
        id: "analysis",
        name: "analysis",
        state: "error",
        startedAt: earlier(33),
        endedAt: earlier(30),
        executionTime: 180_000,
        attempts: 2,
        refinementAttempts: 1,
        artifacts: [
          { filename: "error.json", content: { message: "Rate limit", hint: "Resume with cached context" } },
        ],
      },
      draft: { id: "draft", name: "draft", state: "pending", attempts: 0 },
      validate: { id: "validate", name: "validate", state: "pending", attempts: 0 },
    },
  },
  {
    pipelineId: "run-003",
    name: "FAQ: Onboarding",
    createdAt: earlier(120),
    status: "completed",
    current: undefined,
    tasks: {
      ingest: {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(120),
        endedAt: earlier(118),
        executionTime: 120_000,
        attempts: 1,
      },
      analysis: {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(118),
        endedAt: earlier(110),
        executionTime: 480_000,
        attempts: 1,
      },
      draft: {
        id: "draft",
        name: "draft",
        state: "completed",
        startedAt: earlier(110),
        endedAt: earlier(100),
        executionTime: 600_000,
        attempts: 1,
        artifacts: [
          { filename: "draft.json", content: { sections: 7, readingTime: "6m" } },
        ],
      },
      validate: {
        id: "validate",
        name: "validate",
        state: "completed",
        startedAt: earlier(100),
        endedAt: earlier(95),
        executionTime: 300_000,
        attempts: 1,
        artifacts: [
          { filename: "validation.json", content: { score: 0.93, notes: "Strong" } },
        ],
      },
    },
  },
  {
    pipelineId: "run-004",
    name: "Case Study: Zero-Trust",
    createdAt: earlier(6),
    status: "running",
    current: "analysis",
    tasks: {
      ingest: {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(6),
        endedAt: earlier(5),
        executionTime: 60_000,
        attempts: 1,
      },
      analysis: {
        id: "analysis",
        name: "analysis",
        state: "running",
        startedAt: earlier(5),
        attempts: 1,
      },
      draft: { id: "draft", name: "draft", state: "pending", attempts: 0 },
      validate: { id: "validate", name: "validate", state: "pending", attempts: 0 },
    },
  },
  {
    pipelineId: "run-005",
    name: "Guide: Hiring Scorecards",
    createdAt: earlier(240),
    status: "completed",
    current: undefined,
    tasks: {
      ingest: {
        id: "ingest",
        name: "ingest",
        state: "completed",
        startedAt: earlier(240),
        endedAt: earlier(238),
        executionTime: 120_000,
        attempts: 1,
      },
      analysis: {
        id: "analysis",
        name: "analysis",
        state: "completed",
        startedAt: earlier(238),
        endedAt: earlier(232),
        executionTime: 360_000,
        attempts: 1,
      },
      draft: {
        id: "draft",
        name: "draft",
        state: "completed",
        startedAt: earlier(232),
        endedAt: earlier(220),
        executionTime: 720_000,
        attempts: 1,
      },
      validate: {
        id: "validate",
        name: "validate",
        state: "completed",
        startedAt: earlier(220),
        endedAt: earlier(215),
        executionTime: 300_000,
        attempts: 1,
        artifacts: [
          { filename: "validation.json", content: { score: 0.95, notes: "Excellent" } },
        ],
      },
    },
  },
];
```

### `src/components/JobList.jsx`
```jsx
// src/components/JobList.jsx
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import JobCard from "./JobCard";

export default function JobList({ jobs, pipeline, onOpenJob, totalProgressPct, overallElapsed }) {
  if (jobs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-sm text-muted-foreground">No jobs to show here yet.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {jobs.map((job) => (
        <JobCard
          key={job.pipelineId}
          job={job}
          pipeline={pipeline}
          onClick={() => onOpenJob(job)}
          progressPct={totalProgressPct(job)}
          overallElapsedMs={overallElapsed(job)}
        />
      ))}
    </div>
  );
}
```

### `src/components/JobCard.jsx`
```jsx
// src/components/JobCard.jsx
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Clock, TimerReset, ChevronRight } from "lucide-react";
import { fmtDuration, elapsedBetween } from "../utils/time";
import { countCompleted } from "../utils/jobs";
import { progressClasses, statusBadge } from "../utils/ui";

export default function JobCard({ job, pipeline, onClick, progressPct, overallElapsedMs }) {
  const currentTask = job.current ? job.tasks[job.current] : undefined;
  const currentElapsed = currentTask ? elapsedBetween(currentTask.startedAt, currentTask.endedAt) : 0;
  const totalCompleted = countCompleted(job);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${job.name}`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className="group transition-colors cursor-pointer hover:bg-accent/40 hover:shadow-sm focus-visible:ring-2 rounded-xl border border-gray-200"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">{job.pipelineId}</div>
            <CardTitle className="text-lg font-semibold">{job.name}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(job.status)}
            <ChevronRight className="h-4 w-4 opacity-50 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="font-semibold">
            Current: {currentTask ? currentTask.name : job.status === "completed" ? "—" : job.current ?? "—"}
          </div>
          {currentTask && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" /> {fmtDuration(currentElapsed)}
            </div>
          )}
          {currentTask?.config && (
            <div className="text-muted-foreground">
              {currentTask.config.model} · temp {currentTask.config.temperature}
            </div>
          )}
        </div>

        <div className="mt-3">
          <Progress className={`h-2 ${progressClasses(job.status)}`} value={progressPct} aria-label={`Progress ${progressPct}%`} />
          <div className="mt-2 flex flex-wrap items-center justify-between text-sm text-muted-foreground">
            <div>
              {totalCompleted} of {pipeline.tasks.length} tasks complete
            </div>
            <div className="flex items-center gap-1">
              <TimerReset className="h-4 w-4" /> {fmtDuration(overallElapsedMs)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### `src/components/JobDetail.jsx`
```jsx
// src/components/JobDetail.jsx
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
```

### `src/pages/PromptPipelineDashboard.jsx`
```jsx
// src/pages/PromptPipelineDashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import JobList from "../components/JobList";
import JobDetail from "../components/JobDetail";
import { statusBadge } from "../utils/ui";
import { demoPipeline, demoJobs } from "../data/demoData";

export default function PromptPipelineDashboard() {
  const [pipeline, setPipeline] = useState(demoPipeline);
  const [jobs, setJobs] = useState(demoJobs);
  const [seedName, setSeedName] = useState("content-generation");
  const [activeTab, setActiveTab] = useState("current");
  const [selectedJob, setSelectedJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const fileRef = useRef(null);

  // ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const errorCount = useMemo(() => jobs.filter((j) => j.status === "error").length, [jobs]);
  const currentCount = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);
  const completedCount = useMemo(() => jobs.filter((j) => j.status === "completed").length, [jobs]);

  const filteredJobs = useMemo(() => {
    switch (activeTab) {
      case "current":
        return jobs.filter((j) => j.status === "running");
      case "errors":
        return jobs.filter((j) => j.status === "error");
      case "completed":
        return jobs.filter((j) => j.status === "completed");
      default:
        return [];
    }
  }, [jobs, activeTab]);

  const totalProgressPct = (job) => {
    const total = pipeline.tasks.length;
    const done = Object.values(job.tasks).filter((t) => t.state === "completed").length;
    return Math.round((done / total) * 100);
  };

  const overallElapsed = (job) => {
    const start = new Date(job.createdAt).getTime();
    const latestEnd = Object.values(job.tasks)
      .map((t) => (t.endedAt ? new Date(t.endedAt).getTime() : undefined))
      .filter(Boolean)
      .reduce((acc, ts) => (ts && (!acc || ts > acc) ? ts : acc), undefined);
    const end = job.status === "completed" && latestEnd ? latestEnd : Date.now();
    return Math.max(0, end - start);
  };

  const openJob = (job) => setSelectedJob(job);
  const onUploadClick = () => fileRef.current?.click();

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg(null);

    const textByName = {};
    for (const f of Array.from(files)) {
      const text = await f.text();
      textByName[f.name.toLowerCase()] = text;
    }

    try {
      let nextPipeline = pipeline;
      let nextJobs = jobs;
      let seedLabel = null;

      const pName = Object.keys(textByName).find((n) => n.includes("pipeline"));
      if (pName) {
        const parsed = JSON.parse(textByName[pName]);
        if (!parsed?.name || !Array.isArray(parsed?.tasks)) throw new Error("Invalid pipeline.json");
        nextPipeline = parsed;
      }

      const sName = Object.keys(textByName).find((n) => n.includes("seed"));
      if (sName) {
        const parsedSeed = JSON.parse(textByName[sName]);
        if (!parsedSeed?.name) throw new Error("Invalid seed.json");
        setSeedName(parsedSeed.name);
        seedLabel = parsedSeed.name;
      }

      const jName = Object.keys(textByName).find((n) => n.includes("job") || n.includes("status"));
      if (jName) {
        const parsed = JSON.parse(textByName[jName]);
        if (!Array.isArray(parsed)) throw new Error("Expected an array of jobs in job-status.json");
        nextJobs = parsed;
      }

      setPipeline(nextPipeline);
      setJobs(nextJobs);
      setUploadMsg(
        `Loaded ${nextJobs.length} jobs${pName ? " + pipeline" : ""}${
          seedLabel ? " + seed (" + seedLabel + ")" : ""
        }.`
      );
    } catch (e) {
      setUploadMsg(`Upload failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Prompt Pipeline: <span className="text-muted-foreground">{seedName ?? pipeline.name}</span>
          </h1>
          <div className="flex items-center gap-3">
            {uploading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <span className="inline-block animate-spin">⏳</span> Parsing…
              </div>
            ) : (
              <Button onClick={onUploadClick} aria-label="Upload Seed" className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                Upload Seed
              </Button>
            )}
            <input ref={fileRef} type="file" accept=".json" multiple className="hidden" onChange={(e) => handleFiles(e.currentTarget.files)} />
          </div>
        </div>
        {uploadMsg && (
          <div className="mx-auto max-w-6xl px-4 pb-3 text-sm text-muted-foreground" role="status">
            {uploadMsg}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {selectedJob ? (
          <JobDetail
            job={selectedJob}
            pipeline={pipeline}
            onClose={() => setSelectedJob(null)}
            onResume={(taskId) => alert("Resuming " + (selectedJob?.pipelineId ?? "") + " from " + taskId)}
          />
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
            <TabsList aria-label="Job filters">
              <TabsTrigger value="current">
                Current Jobs {currentCount > 0 && <Badge variant="secondary" className="ml-2">{currentCount}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="errors">
                Error Jobs {errorCount > 0 && <Badge variant="secondary" className="ml-2">{errorCount}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed Jobs {completedCount > 0 && <Badge variant="secondary" className="ml-2">{completedCount}</Badge>}
              </TabsTrigger>
            </TabsList>

            <div className="mt-6 grid gap-4">
              <TabsContent value="current">
                <JobList jobs={filteredJobs} pipeline={pipeline} onOpenJob={openJob} totalProgressPct={totalProgressPct} overallElapsed={overallElapsed} />
              </TabsContent>
              <TabsContent value="errors">
                <JobList jobs={filteredJobs} pipeline={pipeline} onOpenJob={openJob} totalProgressPct={totalProgressPct} overallElapsed={overallElapsed} />
              </TabsContent>
              <TabsContent value="completed">
                <JobList jobs={filteredJobs} pipeline={pipeline} onOpenJob={openJob} totalProgressPct={totalProgressPct} overallElapsed={overallElapsed} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </main>
    </div>
  );
}
```

---

## Wiring to a Live Orchestrator

Replace the demo data source with your runtime feed (API or SSE):

```jsx
// inside PromptPipelineDashboard.jsx
useEffect(() => {
  const sse = new EventSource("/api/orchestrator/stream");
  sse.onmessage = (e) => {
    const update = JSON.parse(e.data); // array of JobRun objects
    setJobs(update);
  };
  return () => sse.close();
}, []);
```

Or fetch on an interval:

```jsx
useEffect(() => {
  let cancelled = false;
  const tick = async () => {
    const res = await fetch("/api/orchestrator/jobs");
    const data = await res.json();
    if (!cancelled) setJobs(data);
  };
  tick();
  const id = setInterval(tick, 5000);
  return () => { cancelled = true; clearInterval(id); };
}, []);
```

---

## Data Contract (JobRun)

- `pipelineId: string`
- `name: string`
- `createdAt: ISO string`
- `status: "running" | "error" | "completed"`
- `current?: taskId`
- `tasks: Record<taskId, {
  id: string,
  name: string,
  state: "pending" | "running" | "completed" | "error",
  startedAt?: ISO,
  endedAt?: ISO,
  executionTime?: ms,
  attempts?: number,
  refinementAttempts?: number,
  artifacts?: { filename: string, content: unknown }[],
  config?: { model: string, temperature: number, maxTokens?: number },
}>`

This is unchanged from the original single-file implementation.

---

## Notes
- Keep `@/components/ui/*` imports aligned with your shadcn setup.
- All pieces are plain JS; no TypeScript types remain.
- You can further isolate visual styling rules in `utils/ui.js` for theming or brand-specific palettes.

