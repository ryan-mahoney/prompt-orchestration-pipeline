// PromptPipelineDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";

// Radix UI primitives
import * as Tooltip from "@radix-ui/react-tooltip";

import {
  Box,
  Flex,
  Text,
  Heading,
  Badge as RadixBadge,
  Tabs,
  Card,
} from "@radix-ui/themes";

import { Progress } from "../components/ui/progress";
import { useJobListWithUpdates } from "../ui/client/hooks/useJobListWithUpdates";
import { adaptJobSummary } from "../ui/client/adapters/job-adapter";
import { demoJobs } from "../data/demoData";

// Referenced components — leave these alone
import JobTable from "../components/JobTable";
import JobDetail from "../components/JobDetail";
import UploadSeed from "../components/UploadSeed";

export default function PromptPipelineDashboard({ isConnected }) {
  const [pipeline, setPipeline] = useState(null);
  const {
    data: apiJobs,
    loading,
    error,
    connectionStatus,
  } = useJobListWithUpdates();
  const jobs = useMemo(() => {
    const src = Array.isArray(apiJobs) ? apiJobs : [];
    if (error) {
      // On error, render demo job list and show disconnected banner
      return demoJobs.map(adaptJobSummary);
    }
    return src.map(adaptJobSummary);
  }, [apiJobs, error]);
  const [seedName, setSeedName] = useState("content-generation");
  const [activeTab, setActiveTab] = useState("current");
  const [selectedJob, setSelectedJob] = useState(null);
  const [seedUploadSuccess, setSeedUploadSuccess] = useState(null);
  const [seedUploadTimer, setSeedUploadTimer] = useState(null);

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
    () => jobs.filter((j) => j.status === "complete").length,
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    switch (activeTab) {
      case "current":
        return jobs.filter((j) => j.status === "running");
      case "errors":
        return jobs.filter((j) => j.status === "error");
      case "complete":
        return jobs.filter((j) => j.status === "complete");
      default:
        return [];
    }
  }, [jobs, activeTab]);

  const totalProgressPct = (job) => {
    const total =
      pipeline?.tasks?.length ??
      (Array.isArray(job.tasks)
        ? job.tasks.length
        : Object.keys(job.tasks || {}).length);
    if (!total) return 0;
    const taskList = Array.isArray(job.tasks)
      ? job.tasks
      : Object.values(job.tasks || {});
    const done = taskList.filter(
      (t) => t.state === "done" || t.state === "completed"
    ).length;
    return Math.round((done / total) * 100);
  };

  const overallElapsed = (job) => {
    const start = new Date(job.createdAt).getTime();
    const taskList = Array.isArray(job.tasks)
      ? job.tasks
      : Object.values(job.tasks || {});
    const latestEnd = taskList
      .map((t) => (t.endedAt ? new Date(t.endedAt).getTime() : undefined))
      .filter(Boolean)
      .reduce((acc, ts) => (ts && (!acc || ts > acc) ? ts : acc), undefined);
    const end = job.status === "complete" && latestEnd ? latestEnd : Date.now();
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

  // Handle seed upload success
  const handleSeedUploadSuccess = ({ jobName }) => {
    // Clear any existing timer
    if (seedUploadTimer) {
      clearTimeout(seedUploadTimer);
    }

    // Set success message
    setSeedUploadSuccess(jobName);

    // Auto-clear after exactly 5000 ms
    const timer = setTimeout(() => {
      setSeedUploadSuccess(null);
      setSeedUploadTimer(null);
    }, 5000);

    setSeedUploadTimer(timer);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (seedUploadTimer) {
        clearTimeout(seedUploadTimer);
      }
    };
  }, [seedUploadTimer]);

  // Determine connection state - prop overrides any hook value; otherwise use hook's status
  const connectionState =
    isConnected !== undefined ? isConnected : connectionStatus === "connected";

  return (
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
            </Flex>
          </Flex>
        </Box>

        {/* Main Content */}
        <Box className="mx-auto max-w-6xl px-6 py-6">
          {/* Upload Seed File Section - Only show when no job is selected */}
          {!selectedJob && (
            <Card className="mb-6">
              <Flex direction="column" gap="3">
                <Heading size="4" weight="medium" className="text-gray-12">
                  Upload Seed File
                </Heading>

                {/* Success Message */}
                {seedUploadSuccess && (
                  <Box className="rounded-md bg-green-50 p-3 border border-green-200">
                    <Text size="2" className="text-green-800">
                      Job <strong>{seedUploadSuccess}</strong> created
                      successfully
                    </Text>
                  </Box>
                )}

                <UploadSeed
                  disabled={!connectionState}
                  onUploadSuccess={handleSeedUploadSuccess}
                />
              </Flex>
            </Card>
          )}

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
            <>
              {error && (
                <Box className="mb-4 rounded-md bg-yellow-50 p-3 border border-yellow-200">
                  <Text size="2" className="text-yellow-800">
                    Using demo data (live API unavailable)
                  </Text>
                </Box>
              )}
              <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                <Tabs.List aria-label="Job filters">
                  <Tabs.Trigger value="current">Current</Tabs.Trigger>
                  <Tabs.Trigger value="errors">Errors</Tabs.Trigger>
                  <Tabs.Trigger value="complete">Completed</Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="current">
                  <JobTable
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
                <Tabs.Content value="errors">
                  <JobTable
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
                <Tabs.Content value="complete">
                  <JobTable
                    jobs={filteredJobs}
                    pipeline={pipeline}
                    onOpenJob={openJob}
                    totalProgressPct={totalProgressPct}
                    overallElapsed={overallElapsed}
                  />
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
        </Box>
      </Box>
    </Tooltip.Provider>
  );
}
