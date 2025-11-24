// PromptPipelineDashboard.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Box, Flex, Text, Tabs } from "@radix-ui/themes";

import { Progress } from "../components/ui/progress";
import { useJobListWithUpdates } from "../ui/client/hooks/useJobListWithUpdates";
import { adaptJobSummary } from "../ui/client/adapters/job-adapter";
import { stopJob } from "../ui/client/api.js";

// Referenced components — leave these alone
import JobTable from "../components/JobTable";
import Layout from "../components/Layout.jsx";
import StopJobModal from "../components/ui/StopJobModal.jsx";

export default function PromptPipelineDashboard(_isConnected) {
  const navigate = useNavigate();
  const hookResult = useJobListWithUpdates();
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [isStopping, setIsStopping] = useState(false);

  if (
    /* eslint-disable-next-line no-undef */
    process.env.NODE_ENV === "test" &&
    (hookResult === undefined ||
      hookResult === null ||
      typeof hookResult !== "object" ||
      Array.isArray(hookResult))
  ) {
    console.error(
      "[PromptPipelineDashboard] useJobListWithUpdates returned unexpected value",
      {
        hookResultType: typeof hookResult,
        hookResultKeys:
          hookResult && typeof hookResult === "object"
            ? Object.keys(hookResult)
            : null,
        isMockFunction: Boolean(useJobListWithUpdates?.mock),
        stack: new Error().stack,
      }
    );
  }

  const { data: apiJobs, error } = hookResult;

  const jobs = useMemo(() => {
    const src = Array.isArray(apiJobs) ? apiJobs : [];

    // Do not fall back to in-memory demo data. On error, return an empty list so
    // UI shows a neutral empty/error state rather than demo jobs.
    if (error) {
      return [];
    }

    return src.map(adaptJobSummary);
  }, [apiJobs, error]);
  const [activeTab, setActiveTab] = useState("current");

  // Shared ticker for live duration updates - removed useTicker

  const errorCount = useMemo(
    () => jobs.filter((j) => j.displayCategory === "errors").length,
    [jobs]
  );
  const currentCount = useMemo(
    () => jobs.filter((j) => j.displayCategory === "current").length,
    [jobs]
  );
  const completedCount = useMemo(
    () => jobs.filter((j) => j.displayCategory === "complete").length,
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    switch (activeTab) {
      case "current":
        return jobs.filter((j) => j.displayCategory === "current");
      case "errors":
        return jobs.filter((j) => j.displayCategory === "errors");
      case "complete":
        return jobs.filter((j) => j.displayCategory === "complete");
      default:
        return [];
    }
  }, [jobs, activeTab]);

  // overallElapsed function removed - JobTable now uses LiveText for duration calculations

  // Aggregate progress for currently running jobs (for a subtle top progress bar)
  const runningJobs = useMemo(
    () => jobs.filter((j) => j.displayCategory === "current"),
    [jobs]
  );
  const aggregateProgress = useMemo(() => {
    if (runningJobs.length === 0) return 0;
    const sum = runningJobs.reduce((acc, j) => acc + (j.progress || 0), 0);
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

  const handleStopJob = async (jobId) => {
    setIsStopping(true);
    try {
      await stopJob(jobId);
      setIsStopModalOpen(false);
      setSelectedJobId(null);
    } catch (error) {
      console.warn("Failed to stop job:", error);
    } finally {
      setIsStopping(false);
    }
  };

  const openStopModal = (jobId = null) => {
    setSelectedJobId(jobId);
    setIsStopModalOpen(true);
  };

  const closeStopModal = () => {
    setIsStopModalOpen(false);
    setSelectedJobId(null);
  };

  // Header actions for Layout
  const headerActions = runningJobs.length > 0 && (
    <Flex align="center" gap="2" className="text-gray-11">
      <Text size="1" weight="medium">
        Overall Progress
      </Text>
      <Progress value={aggregateProgress} className="w-20" />
      <Text size="1" className="text-gray-9">
        {aggregateProgress}%
      </Text>
      <button
        onClick={() =>
          openStopModal(runningJobs.length === 1 ? runningJobs[0].id : null)
        }
        className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
      >
        {runningJobs.length === 1 ? "Stop" : "Stop…"}
      </button>
    </Flex>
  );

  return (
    <Layout title="Prompt Pipeline" actions={headerActions}>
      {error && (
        <Box className="mb-4 rounded-md bg-yellow-50 p-3 border border-yellow-200">
          <Text size="2" className="text-yellow-800">
            Unable to load jobs from the server
          </Text>
        </Box>
      )}
      <Tabs.Root
        value={activeTab}
        onValueChange={setActiveTab}
        className="mt-4"
      >
        <Tabs.List aria-label="Job filters">
          <Tabs.Trigger value="current">Current ({currentCount})</Tabs.Trigger>
          <Tabs.Trigger value="errors">Errors ({errorCount})</Tabs.Trigger>
          <Tabs.Trigger value="complete">
            Completed ({completedCount})
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="current">
          <JobTable jobs={filteredJobs} pipeline={null} onOpenJob={openJob} />
        </Tabs.Content>
        <Tabs.Content value="errors">
          <JobTable jobs={filteredJobs} pipeline={null} onOpenJob={openJob} />
        </Tabs.Content>
        <Tabs.Content value="complete">
          <JobTable jobs={filteredJobs} pipeline={null} onOpenJob={openJob} />
        </Tabs.Content>
      </Tabs.Root>

      <StopJobModal
        isOpen={isStopModalOpen}
        onClose={closeStopModal}
        onConfirm={handleStopJob}
        runningJobs={runningJobs}
        defaultJobId={selectedJobId}
        isSubmitting={isStopping}
      />
    </Layout>
  );
}
