// PromptPipelineDashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// Radix UI primitives
import { Tabs } from "radix-ui";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Toast from "@radix-ui/react-toast";

import {
  Box,
  Flex,
  Text,
  Heading,
  Badge as RadixBadge,
} from "@radix-ui/themes";

import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";

// Referenced components — leave these alone
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
  const [toastOpen, setToastOpen] = useState(false);

  const fileRef = useRef(null);

  // ticker (for any time-based UI in child components)
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
    const total = pipeline?.tasks?.length ?? 0;
    if (!total) return 0;
    const done = Object.values(job.tasks || {}).filter(
      (t) => t.state === "completed"
    ).length;
    return Math.round((done / total) * 100);
  };

  const overallElapsed = (job) => {
    const start = new Date(job.createdAt).getTime();
    const latestEnd = Object.values(job.tasks || {})
      .map((t) => (t.endedAt ? new Date(t.endedAt).getTime() : undefined))
      .filter(Boolean)
      .reduce((acc, ts) => (ts && (!acc || ts > acc) ? ts : acc), undefined);
    const end =
      job.status === "completed" && latestEnd ? latestEnd : Date.now();
    return Math.max(0, end - start);
  };

  // Aggregate progress for currently running jobs (for a subtle top progress bar)
  const runningJobs = useMemo(
    () => jobs.filter((j) => j.status === "running"),
    [jobs]
  );
  const aggregateProgress = useMemo(() => {
    if (runningJobs.length === 0) return 0;
    const sum = runningJobs.reduce((acc, j) => acc + totalProgressPct(j), 0);
    return Math.round(sum / runningJobs.length);
  }, [runningJobs]);

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
      const msg = `Loaded ${nextJobs.length} jobs${pName ? " + pipeline" : ""}${
        seedLabel ? " + seed (" + seedLabel + ")" : ""
      }.`;
      setUploadMsg(msg);
      setToastOpen(true);
    } catch (e) {
      const msg = `Upload failed: ${e?.message ?? "Unknown error"}`;
      setUploadMsg(msg);
      setToastOpen(true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Toast.Provider swipeDirection="right">
      <Tooltip.Provider delayDuration={200}>
        <Box className="min-h-screen bg-gray-1">
          {/* Header */}
          <Box className="sticky top-0 z-20 border-b border-gray-300 bg-gray-1/80 backdrop-blur supports-[backdrop-filter]:bg-gray-1/60">
            <Flex
              align="center"
              justify="between"
              className="mx-auto max-w-6xl px-6 py-4"
              gap="4"
            >
              <Flex align="center" gap="3">
                <Heading size="5" weight="medium" className="text-gray-12">
                  Prompt Pipeline
                </Heading>
                {pipeline?.name && (
                  <RadixBadge variant="soft" color="gray">
                    {pipeline.name}
                  </RadixBadge>
                )}
              </Flex>

              <Flex align="center" gap="3">
                {/* Overall Progress Indicator */}
                {runningJobs.length > 0 && (
                  <Flex align="center" gap="2" className="text-gray-11">
                    <Text size="1" weight="medium">
                      Overall Progress
                    </Text>
                    <Progress value={aggregateProgress} className="w-20" />
                    <Text size="1" className="text-gray-9">
                      {aggregateProgress}%
                    </Text>
                  </Flex>
                )}

                {/* Upload Button */}
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Box className="relative">
                      <Button
                        onClick={onUploadClick}
                        aria-label="Upload seed/pipeline/jobs JSON"
                        disabled={uploading}
                        variant={uploading ? "secondary" : "default"}
                        size="sm"
                      >
                        {uploading ? (
                          <Flex align="center" gap="2">
                            <Box className="h-3 w-3 animate-spin rounded-full border border-gray-8 border-t-gray-11" />
                            <Text size="2">Parsing…</Text>
                          </Flex>
                        ) : (
                          <Flex align="center" gap="2">
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              aria-hidden="true"
                            >
                              <path
                                d="M12 3l4 4h-3v6h-2V7H8l4-4zM5 19h14v-2H5v2z"
                                fill="currentColor"
                              />
                            </svg>
                            <Text size="2">Upload JSON</Text>
                          </Flex>
                        )}
                      </Button>

                      <input
                        ref={fileRef}
                        type="file"
                        accept=".json"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFiles(e.currentTarget.files)}
                      />
                    </Box>
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    side="bottom"
                    align="end"
                    className="rounded-lg border border-gray-6 bg-gray-1 px-3 py-1.5 text-sm shadow-lg"
                  >
                    <Text size="1" className="text-gray-11">
                      Select your <strong>seed.json</strong>,{" "}
                      <strong>pipeline.json</strong>, and{" "}
                      <strong>job-status.json</strong>
                    </Text>
                    <Tooltip.Arrow className="fill-gray-1" />
                  </Tooltip.Content>
                </Tooltip.Root>
              </Flex>
            </Flex>
          </Box>

          {/* Main Content */}
          <Box className="mx-auto max-w-6xl px-6 py-6">
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
              <Tabs.Root
                value={activeTab}
                onValueChange={setActiveTab}
                color="mint"
              >
                <Tabs.List aria-label="Job filters" className="flex gap-6">
                  <Tabs.Trigger value="current" className="flex items-center">
                    Current
                  </Tabs.Trigger>
                  <Tabs.Trigger value="errors" className="flex items-center">
                    Errors
                  </Tabs.Trigger>
                  <Tabs.Trigger value="completed" className="flex items-center">
                    Completed
                  </Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="current">
                  <JobList
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
                <Tabs.Content value="errors">
                  <JobList
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
                <Tabs.Content value="completed">
                  <JobList
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
              </Tabs.Root>
            )}
          </Box>

          {/* Upload feedback as a Radix Toast */}
          <Toast.Root
            className="pointer-events-auto relative m-4 w-[360px] rounded-lg border border-gray-6 bg-gray-1 p-4 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out"
            open={toastOpen}
            onOpenChange={setToastOpen}
          >
            <Toast.Title className="text-sm font-semibold text-gray-12">
              Import
            </Toast.Title>
            <Toast.Description className="mt-1 text-sm text-gray-11">
              {uploadMsg}
            </Toast.Description>
            <Toast.Close
              className="absolute right-3 top-3 rounded p-1 text-gray-9 hover:bg-gray-4"
              aria-label="Close"
            >
              ✕
            </Toast.Close>
          </Toast.Root>
          <Toast.Viewport className="fixed bottom-0 right-0 flex max-h-screen w-[420px] flex-col gap-2 p-4 outline-none" />
        </Box>
      </Tooltip.Provider>
    </Toast.Provider>
  );
}
