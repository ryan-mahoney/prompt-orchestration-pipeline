import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import JobList from "../components/JobList";
import JobDetail from "../components/JobDetail";
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

  const errorCount = useMemo(
    () => jobs.filter((j) => j.status === "error").length,
    [jobs]
  );
  const currentCount = useMemo(
    () => jobs.filter((j) => j.status === "running").length,
    [jobs]
  );
  const completedCount = useMemo(
    () => jobs.filter((j) => j.status === "completed").length,
    [jobs]
  );

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
    const done = Object.values(job.tasks).filter(
      (t) => t.state === "completed"
    ).length;
    return Math.round((done / total) * 100);
  };

  const overallElapsed = (job) => {
    const start = new Date(job.createdAt).getTime();
    const latestEnd = Object.values(job.tasks)
      .map((t) => (t.endedAt ? new Date(t.endedAt).getTime() : undefined))
      .filter(Boolean)
      .reduce((acc, ts) => (ts && (!acc || ts > acc) ? ts : acc), undefined);
    const end =
      job.status === "completed" && latestEnd ? latestEnd : Date.now();
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
        if (!parsed?.name || !Array.isArray(parsed?.tasks))
          throw new Error("Invalid pipeline.json");
        nextPipeline = parsed;
      }

      const sName = Object.keys(textByName).find((n) => n.includes("seed"));
      if (sName) {
        const parsedSeed = JSON.parse(textByName[sName]);
        if (!parsedSeed?.name) throw new Error("Invalid seed.json");
        setSeedName(parsedSeed.name);
        seedLabel = parsedSeed.name;
      }

      const jName = Object.keys(textByName).find(
        (n) => n.includes("job") || n.includes("status")
      );
      if (jName) {
        const parsed = JSON.parse(textByName[jName]);
        if (!Array.isArray(parsed))
          throw new Error("Expected an array of jobs in job-status.json");
        nextJobs = parsed;
      }

      setPipeline(nextPipeline);
      setJobs(nextJobs);
      setUploadMsg(
        `Loaded ${nextJobs.length} jobs${pName ? " + pipeline" : ""}${seedLabel ? " + seed (" + seedLabel + ")" : ""}.`
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
            Prompt Pipeline:{" "}
            <span className="text-muted-foreground">
              {seedName ?? pipeline.name}
            </span>
          </h1>
          <div className="flex items-center gap-3">
            {uploading ? (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                aria-live="polite"
              >
                <span className="inline-block animate-spin">⏳</span> Parsing…
              </div>
            ) : (
              <Button
                onClick={onUploadClick}
                aria-label="Upload Seed"
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              >
                Upload Seed
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.currentTarget.files)}
            />
          </div>
        </div>
        {uploadMsg && (
          <div
            className="mx-auto max-w-6xl px-4 pb-3 text-sm text-muted-foreground"
            role="status"
          >
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
            onResume={(taskId) =>
              alert(
                "Resuming " +
                  (selectedJob?.pipelineId ?? "") +
                  " from " +
                  taskId
              )
            }
          />
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
            <TabsList aria-label="Job filters">
              <TabsTrigger value="current">
                Current Jobs{" "}
                {currentCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {currentCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="errors">
                Error Jobs{" "}
                {errorCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {errorCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed Jobs{" "}
                {completedCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {completedCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="mt-6 grid gap-4">
              <TabsContent value="current">
                <JobList
                  jobs={filteredJobs}
                  pipeline={pipeline}
                  onOpenJob={openJob}
                  totalProgressPct={totalProgressPct}
                  overallElapsed={overallElapsed}
                />
              </TabsContent>
              <TabsContent value="errors">
                <JobList
                  jobs={filteredJobs}
                  pipeline={pipeline}
                  onOpenJob={openJob}
                  totalProgressPct={totalProgressPct}
                  overallElapsed={overallElapsed}
                />
              </TabsContent>
              <TabsContent value="completed">
                <JobList
                  jobs={filteredJobs}
                  pipeline={pipeline}
                  onOpenJob={openJob}
                  totalProgressPct={totalProgressPct}
                  overallElapsed={overallElapsed}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </main>
    </div>
  );
}
