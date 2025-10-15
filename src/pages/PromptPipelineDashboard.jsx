// PromptPipelineDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Box, Flex, Text, Heading, Tabs, Card } from "@radix-ui/themes";

import { Progress } from "../components/ui/progress";
import { useJobListWithUpdates } from "../ui/client/hooks/useJobListWithUpdates";
import { adaptJobSummary } from "../ui/client/adapters/job-adapter";
import { jobCumulativeDurationMs } from "../utils/duration";
import { useTicker } from "../ui/client/hooks/useTicker";

// Referenced components — leave these alone
import JobTable from "../components/JobTable";
import UploadSeed from "../components/UploadSeed";
import Layout from "../components/Layout.jsx";

export default function PromptPipelineDashboard({ isConnected }) {
  const navigate = useNavigate();
  const {
    data: apiJobs,
    loading,
    error,
    connectionStatus,
  } = useJobListWithUpdates();

  const jobs = useMemo(() => {
    const src = Array.isArray(apiJobs) ? apiJobs : [];

    // Do not fall back to in-memory demo data. On error, return an empty list so
    // the UI shows a neutral empty/error state rather than demo jobs.
    if (error) {
      return [];
    }

    return src.map(adaptJobSummary);
  }, [apiJobs, error]);
  const [activeTab, setActiveTab] = useState("current");
  const [seedUploadSuccess, setSeedUploadSuccess] = useState(null);
  const [seedUploadTimer, setSeedUploadTimer] = useState(null);

  // Shared ticker for live duration updates
  const now = useTicker(1000);

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
    const total = Array.isArray(job.tasks)
      ? job.tasks.length
      : Object.keys(job.tasks || {}).length;
    if (!total) return 0;
    const taskList = Array.isArray(job.tasks)
      ? job.tasks
      : Object.values(job.tasks || {});
    const done = taskList.filter(
      (t) => t.state === "done" || t.state === "completed"
    ).length;
    return Math.round((done / total) * 100);
  };

  const overallElapsed = (job) => jobCumulativeDurationMs(job, now);

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

  const openJob = (job) => {
    // Only navigate if job has a proper ID
    if (job.id) {
      navigate(`/pipeline/${job.id}`);
    } else {
      // Show console warning for jobs without valid ID
      console.warn(`Cannot open job "${job.name}" - no valid job ID available`);
      // TODO: Show user-facing toast or notification for better UX
    }
  };

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

  // Header actions for the Layout
  const headerActions = runningJobs.length > 0 && (
    <Flex align="center" gap="2" className="text-gray-11">
      <Text size="1" weight="medium">
        Overall Progress
      </Text>
      <Progress value={aggregateProgress} className="w-20" />
      <Text size="1" className="text-gray-9">
        {aggregateProgress}%
      </Text>
    </Flex>
  );

  return (
    <Layout title="Prompt Pipeline" actions={headerActions}>
      {/* Upload Seed File Section */}
      <Card className="mb-6">
        <Flex direction="column" gap="3">
          <Heading size="4" weight="medium" className="text-gray-12">
            Upload Seed File
          </Heading>

          {/* Success Message */}
          {seedUploadSuccess && (
            <Box className="rounded-md bg-green-50 p-3 border border-green-200">
              <Text size="2" className="text-green-800">
                Job <strong>{seedUploadSuccess}</strong> created successfully
              </Text>
            </Box>
          )}

          <UploadSeed onUploadSuccess={handleSeedUploadSuccess} />
        </Flex>
      </Card>

      {error && (
        <Box className="mb-4 rounded-md bg-yellow-50 p-3 border border-yellow-200">
          <Text size="2" className="text-yellow-800">
            Unable to load jobs from the server
          </Text>
        </Box>
      )}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List aria-label="Job filters">
          <Tabs.Trigger value="current">Current ({currentCount})</Tabs.Trigger>
          <Tabs.Trigger value="errors">Errors ({errorCount})</Tabs.Trigger>
          <Tabs.Trigger value="complete">
            Completed ({completedCount})
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="current">
          <JobTable
            jobs={filteredJobs}
            pipeline={null}
            onOpenJob={openJob}
            totalProgressPct={totalProgressPct}
            overallElapsed={overallElapsed}
            now={now}
          />
        </Tabs.Content>
        <Tabs.Content value="errors">
          <JobTable
            jobs={filteredJobs}
            pipeline={null}
            onOpenJob={openJob}
            totalProgressPct={totalProgressPct}
            overallElapsed={overallElapsed}
            now={now}
          />
        </Tabs.Content>
        <Tabs.Content value="complete">
          <JobTable
            jobs={filteredJobs}
            pipeline={null}
            onOpenJob={openJob}
            totalProgressPct={totalProgressPct}
            overallElapsed={overallElapsed}
            now={now}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Layout>
  );
}
